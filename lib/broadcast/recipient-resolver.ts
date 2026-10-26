import { SupabaseClient } from "@supabase/supabase-js";
import { evaluateEventPaymentStatus } from "@/lib/admin/check-in-rules";
import { fetchAllRows, fetchInBatches } from "@/lib/supabase/batch";

export interface GeneralRecipient {
  normalizedEmail: string;
  originalEmail: string;
  name: string;
  sources: Array<"event" | "team_member" | "accommodation">;
  details: {
    eventIds?: string[];
    teamNames?: string[];
    accommodationIds?: string[];
  };
  isValidEmail: boolean;
}

export interface CertificateEligibleItem {
  participantEventId: string;
  memberId?: string | null;
  participantId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  isValidEmail: boolean;
  eventId: string;
  eventName: string;
  isTeam: boolean;
  teamName?: string | null;
  teamContactEmail?: string | null;
  isTeamLeader?: boolean;
  mainCheckedIn: boolean;
  mainCheckedInAt: string | null;
  eventCheckedIn: boolean;
  paymentStatus: string | null;
  paymentAmount: number | null;
  isFree: boolean;
  isPaymentComplete: boolean;
  certificateEligible: boolean;
  ineligibilityReason?: string | null;
  issueSourceKey: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmailAddress(email?: string | null): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  return trimmed.length > 5 && EMAIL_REGEX.test(trimmed);
}

/**
 * Resolves all deduplicated recipients for general broadcast email campaigns.
 */
export async function resolveGeneralBroadcastRecipients(
  supabaseAdmin: SupabaseClient
): Promise<GeneralRecipient[]> {
  const recipientMap = new Map<string, GeneralRecipient>();

  function addRecipient(
    email: string | null | undefined,
    name: string | null | undefined,
    source: "event" | "team_member" | "accommodation",
    detailId?: string
  ) {
    if (!email || !email.trim()) return;
    const normalized = email.trim().toLowerCase();
    const cleanName = (name || "").trim() || "Participant";
    const valid = isValidEmailAddress(normalized);

    const existing = recipientMap.get(normalized);
    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      if (source === "event" && detailId) {
        existing.details.eventIds = Array.from(new Set([...(existing.details.eventIds || []), detailId]));
      } else if (source === "team_member" && detailId) {
        existing.details.teamNames = Array.from(new Set([...(existing.details.teamNames || []), detailId]));
      } else if (source === "accommodation" && detailId) {
        existing.details.accommodationIds = Array.from(new Set([...(existing.details.accommodationIds || []), detailId]));
      }
      if (existing.name === "Participant" && cleanName !== "Participant") {
        existing.name = cleanName;
      }
    } else {
      recipientMap.set(normalized, {
        normalizedEmail: normalized,
        originalEmail: email.trim(),
        name: cleanName,
        sources: [source],
        details: {
          eventIds: source === "event" && detailId ? [detailId] : [],
          teamNames: source === "team_member" && detailId ? [detailId] : [],
          accommodationIds: source === "accommodation" && detailId ? [detailId] : [],
        },
        isValidEmail: valid,
      });
    }
  }

  // 1. Active Event registrants (paginated to overcome 1000 limit)
  const { data: eventRegistrations, error: eventErr } = await fetchAllRows(async (from, to) => {
    return supabaseAdmin
      .from("participant_events")
      .select(`
        id,
        team_name,
        is_archived,
        participants (
          id,
          name,
          email
        )
      `)
      .eq("is_archived", false)
      .range(from, to);
  });

  if (eventErr) {
    console.error("[RECIPIENT RESOLVER] Error loading event registrants:", eventErr);
    throw new Error(`Failed to resolve active event registrants: ${eventErr.message || JSON.stringify(eventErr)}`);
  }

  if (eventRegistrations) {
    for (const pe of eventRegistrations) {
      const p = pe.participants as any;
      if (p?.email) {
        addRecipient(p.email, p.name, "event", pe.id);
      }
    }
  }

  // 2. Team members from participant_event_members (paginated)
  const { data: teamMembers, error: memberErr } = await fetchAllRows(async (from, to) => {
    return supabaseAdmin
      .from("participant_event_members")
      .select(`
        id,
        name,
        email,
        participant_event_id,
        participant_events (
          id,
          is_archived,
          team_name
        )
      `)
      .range(from, to);
  });

  if (memberErr) {
    console.error("[RECIPIENT RESOLVER] Error loading team members:", memberErr);
    throw new Error(`Failed to resolve team members: ${memberErr.message || JSON.stringify(memberErr)}`);
  }

  if (teamMembers) {
    for (const m of teamMembers) {
      const parentPe = m.participant_events as any;
      if (parentPe && parentPe.is_archived === true) continue;
      if (m.email) {
        addRecipient(m.email, m.name, "team_member", parentPe?.team_name || "Team");
      }
    }
  }

  // 3. Accommodation participants (including accommodation-only, paginated)
  const { data: accommodations, error: accErr } = await fetchAllRows(async (from, to) => {
    return supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id,
        status,
        participants (
          id,
          name,
          email
        )
      `)
      .neq("status", "cancelled")
      .range(from, to);
  });

  if (accErr) {
    console.error("[RECIPIENT RESOLVER] Error loading accommodations:", accErr);
    throw new Error(`Failed to resolve accommodation participants: ${accErr.message || JSON.stringify(accErr)}`);
  }

  if (accommodations) {
    for (const acc of accommodations) {
      const p = acc.participants as any;
      if (p?.email) {
        addRecipient(p.email, p.name, "accommodation", acc.id);
      }
    }
  }

  return Array.from(recipientMap.values());
}

/**
 * Resolves all participation certificate candidates and evaluates eligibility authoritatively.
 */
export async function resolveCertificateCandidates(
  supabaseAdmin: SupabaseClient,
  options?: { eventId?: string; participantEventId?: string }
): Promise<CertificateEligibleItem[]> {
  const { data: peRows, error: peErr } = await fetchAllRows(async (from, to) => {
    let query = supabaseAdmin
      .from("participant_events")
      .select(`
        id,
        payment_status,
        payment_amount,
        registration_status,
        main_checked_in,
        main_checked_in_at,
        checked_in,
        checked_in_at,
        team_name,
        event_id,
        participant_id,
        is_archived,
        events (
          id,
          name,
          payment_type,
          registration_fee
        ),
        participants (
          id,
          name,
          email
        )
      `)
      .eq("is_archived", false);

    if (options?.eventId) {
      query = query.eq("event_id", options.eventId);
    }
    if (options?.participantEventId) {
      query = query.eq("id", options.participantEventId);
    }

    return query.range(from, to);
  });

  if (peErr || !peRows) {
    console.error("[CERTIFICATE RESOLVER] Error loading registrations:", peErr);
    throw new Error(`Failed to load certificate registrations: ${peErr?.message || JSON.stringify(peErr)}`);
  }

  // Fetch all team members for these registrations in URL-safe batches
  const peIds = peRows.map((r) => r.id);
  const membersByPeId = new Map<string, any[]>();

  if (peIds.length > 0) {
    const { data: members, error: memErr } = await fetchInBatches(
      peIds,
      async (chunk) => {
        return supabaseAdmin
          .from("participant_event_members")
          .select("id, participant_event_id, participant_id, name, email, is_team_leader")
          .in("participant_event_id", chunk);
      },
      80,
      5
    );

    if (memErr) {
      console.error("[CERTIFICATE RESOLVER] Error loading team members:", memErr);
      throw new Error(`Failed to load certificate team members: ${memErr.message || JSON.stringify(memErr)}`);
    }

    if (members) {
      for (const m of members) {
        const list = membersByPeId.get(m.participant_event_id) || [];
        list.push(m);
        membersByPeId.set(m.participant_event_id, list);
      }
    }
  }

  const results: CertificateEligibleItem[] = [];

  for (const pe of peRows) {
    const event = pe.events as any;
    const participant = pe.participants as any;
    const members = membersByPeId.get(pe.id) || [];
    const isTeam = members.length > 0;

    // Authoritative payment evaluation
    const paymentDecision = evaluateEventPaymentStatus({
      registrationFee: event?.registration_fee,
      paymentType: event?.payment_type,
      paymentAmount: pe.payment_amount,
      paymentStatus: pe.payment_status,
      registrationStatus: pe.registration_status,
    });

    const isMainCheckedIn = pe.main_checked_in === true && !!pe.main_checked_in_at;
    const isEligible = isMainCheckedIn && paymentDecision.isPaymentComplete;

    let ineligibilityReason: string | null = null;
    if (!isMainCheckedIn) {
      ineligibilityReason = pe.checked_in
        ? "Only arena-level check-in recorded. Main registration desk check-in is mandatory."
        : "Main registration desk check-in required.";
    } else if (!paymentDecision.isPaymentComplete) {
      ineligibilityReason = paymentDecision.rejectionReason || "Payment not settled.";
    }

    // Resolve team contact email (prefer team leader, else parent participant email)
    const teamLeader = members.find((m) => m.is_team_leader);
    const teamContactEmail = teamLeader?.email || participant?.email || null;

    if (isTeam) {
      // Create an individual item for each member
      for (const m of members) {
        const memberEmail = m.email || null;
        results.push({
          participantEventId: pe.id,
          memberId: m.id,
          participantId: m.participant_id || null,
          recipientName: m.name || "Team Member",
          recipientEmail: memberEmail,
          isValidEmail: isValidEmailAddress(memberEmail),
          eventId: event?.id || pe.event_id,
          eventName: event?.name || "Event",
          isTeam: true,
          teamName: pe.team_name || "Team",
          teamContactEmail,
          isTeamLeader: !!m.is_team_leader,
          mainCheckedIn: isMainCheckedIn,
          mainCheckedInAt: pe.main_checked_in_at,
          eventCheckedIn: !!pe.checked_in,
          paymentStatus: pe.payment_status,
          paymentAmount: pe.payment_amount,
          isFree: paymentDecision.isFree,
          isPaymentComplete: paymentDecision.isPaymentComplete,
          certificateEligible: isEligible,
          ineligibilityReason,
          issueSourceKey: `member:${pe.id}:${m.id}`,
        });
      }
    } else {
      // Solo registration
      const soloEmail = participant?.email || null;
      results.push({
        participantEventId: pe.id,
        memberId: null,
        participantId: pe.participant_id,
        recipientName: participant?.name || "Participant",
        recipientEmail: soloEmail,
        isValidEmail: isValidEmailAddress(soloEmail),
        eventId: event?.id || pe.event_id,
        eventName: event?.name || "Event",
        isTeam: false,
        teamName: null,
        teamContactEmail: null,
        isTeamLeader: false,
        mainCheckedIn: isMainCheckedIn,
        mainCheckedInAt: pe.main_checked_in_at,
        eventCheckedIn: !!pe.checked_in,
        paymentStatus: pe.payment_status,
        paymentAmount: pe.payment_amount,
        isFree: paymentDecision.isFree,
        isPaymentComplete: paymentDecision.isPaymentComplete,
        certificateEligible: isEligible,
        ineligibilityReason,
        issueSourceKey: `solo:${pe.id}`,
      });
    }
  }

  return results;
}

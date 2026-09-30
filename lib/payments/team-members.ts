import { ReceiptTeamMember } from "../generate-receipt-pdf";

export type RawTeamMemberRow = {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_team_leader?: boolean | null;
  participant_event_id?: string;
  participants?:
    | { participant_id?: string; college?: string }
    | { participant_id?: string; college?: string }[]
    | null;
};

export type PayerProfile = {
  participant_id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  college?: string | null;
};

export interface ResolveReceiptTeamMembersParams {
  isAnyTeamEvent: boolean;
  teamMemberRows: RawTeamMemberRow[];
  payer?: PayerProfile | null;
}

/**
 * Resolves, deduplicates, and formats team members for payment receipts and resume views.
 *
 * Rules:
 * 1. For individual-only orders (isAnyTeamEvent === false), never invent or return team members.
 * 2. Deduplicates members across events strictly by participantId (not name or email).
 * 3. Preserves Team Head designation if a member is a leader in any team event.
 * 4. Preserves distinct participants who happen to share the same name or email.
 * 5. If no team leader is present in a team event, safely uses the payer fallback.
 * 6. Sorts Team Head first.
 */
export function resolveReceiptTeamMembers({
  isAnyTeamEvent,
  teamMemberRows,
  payer,
}: ResolveReceiptTeamMembersParams): ReceiptTeamMember[] {
  // Rule 1: Individual-only orders have no team members and never invent a Team Head.
  if (!isAnyTeamEvent) {
    return [];
  }

  const payerPid = payer?.participant_id ? String(payer.participant_id).trim() : "";

  const mapped: ReceiptTeamMember[] = teamMemberRows
    .map((row) => {
      const pData = Array.isArray(row.participants)
        ? row.participants[0]
        : row.participants;
      const memberPid = String(pData?.participant_id || "").trim();
      const isLeader = row.is_team_leader === true;

      return {
        participantId: memberPid,
        name: String(row.name || (isLeader ? payer?.name || "Team Head" : "Team Member")).trim(),
        college: pData?.college || payer?.college || null,
        email: row.email || null,
        phone: row.phone || null,
        isTeamLeader: isLeader,
        role: isLeader ? "Team Head" : "Team Member",
      };
    })
    .filter((m) => Boolean(m.participantId));

  // Rule 2 & 4: Deduplicate by stable participantId across events (preserves distinct people with same name/email)
  const memberMap = new Map<string, ReceiptTeamMember>();
  for (const member of mapped) {
    const existing = memberMap.get(member.participantId);
    if (!existing) {
      memberMap.set(member.participantId, { ...member });
    } else {
      // Rule 3: If marked as team leader in ANY team event, preserve Team Head status
      if (member.isTeamLeader && !existing.isTeamLeader) {
        existing.isTeamLeader = true;
        existing.role = "Team Head";
      }
      // Merge missing fields if available
      if (!existing.email && member.email) existing.email = member.email;
      if (!existing.phone && member.phone) existing.phone = member.phone;
      if (!existing.college && member.college) existing.college = member.college;
      if (!existing.name && member.name) existing.name = member.name;
    }
  }

  let deduplicatedMembers = Array.from(memberMap.values());

  // Rule 5: Ensure Team Head is present and at the top for team registrations
  const hasLeader = deduplicatedMembers.some((m) => m.isTeamLeader);
  if (!hasLeader && payer && payerPid) {
    const payerInMembers = deduplicatedMembers.find(
      (m) => m.participantId === payerPid
    );
    if (payerInMembers) {
      payerInMembers.isTeamLeader = true;
      payerInMembers.role = "Team Head";
    } else {
      deduplicatedMembers.unshift({
        participantId: payer.participant_id,
        name: payer.name || "Team Head",
        email: payer.email || null,
        phone: payer.phone || null,
        college: payer.college || null,
        isTeamLeader: true,
        role: "Team Head",
      });
    }
  }

  // Rule 6: Sort Team Head first
  deduplicatedMembers.sort((a, b) => (b.isTeamLeader ? 1 : 0) - (a.isTeamLeader ? 1 : 0));

  return deduplicatedMembers;
}

import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  sendCampaignEmail,
  chunkAttachments,
  EmailAttachment,
} from "@/lib/email/campaign-service";
import {
  generateParticipationCertificatePdf,
  TEMPLATE_VERSION,
  EXPECTED_TEMPLATE_HASH,
} from "@/lib/certificates/generator";
import {
  isHybridDevelopmentModeActive,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
  isSyntheticTestEmail,
  HYBRID_READONLY_ERROR,
  PREVIEW_READONLY_ERROR,
  PRODUCTION_READONLY_ERROR,
  resolveCampaignCreatorIdentity,
} from "./supabase-admin";

export interface CreateGeneralCampaignParams {
  title: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  selectedEmails: string[];
  adminId: string;
  adminEmail?: string;
  targetFilters?: Record<string, any>;
}

export interface CreateCertificateCampaignParams {
  title: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  selectedItemKeys: string[]; // list of issueSourceKey e.g. "solo:<pe_id>" or "member:<pe_id>:<mem_id>"
  sendIndividual: boolean;
  sendTeamBackup: boolean;
  adminId: string;
  adminEmail?: string;
  targetFilters?: Record<string, any>;
}

export interface ProcessBatchResult {
  processedCount: number;
  successCount: number;
  failureCount: number;
  details: Array<{ deliveryId: string; recipient: string; success: boolean; error?: string }>;
}

export function generateCertificateNumber(sourceKey: string): string {
  const hash = crypto.createHash("sha256").update(sourceKey).digest("hex").substring(0, 10).toUpperCase();
  return `SAV26-CERT-${hash}`;
}

export function generateDeliveryIdempotencyKey(
  campaignId: string,
  recipientEmail: string,
  channel: string,
  partNumber = 1
): string {
  return `idemp_${campaignId}_${recipientEmail}_${channel}_p${partNumber}`;
}

/**
 * Bounded batch size for bulk delivery and attachment insertions into PostgREST / PostgreSQL.
 * Keeps single-statement payload size around 1.5-2.0 MB and statement execution time under 100ms,
 * preventing PostgreSQL "canceling statement due to statement timeout" (error code 57014)
 * when enqueuing thousands of broadcast recipients with large HTML/text payloads.
 */
export const BROADCAST_DELIVERY_INSERT_CHUNK_SIZE = 100;

export interface CampaignCreationOptions {
  chunkSize?: number;
}

/**
 * Creates a general email broadcast campaign and enqueues deliveries.
 */
export async function createGeneralBroadcastCampaign(
  supabaseAdmin: SupabaseClient,
  params: CreateGeneralCampaignParams,
  options?: CampaignCreationOptions
): Promise<{ campaignId: string; totalDeliveries: number }> {
  if (isPreviewDeployment()) {
    throw new Error(PREVIEW_READONLY_ERROR);
  }
  if (isProductionReadOnlyEnabled()) {
    throw new Error(PRODUCTION_READONLY_ERROR);
  }

  const cleanEmails = Array.from(
    new Set(params.selectedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
  );

  if (cleanEmails.length === 0) {
    throw new Error("No valid recipient emails provided for general broadcast.");
  }

  const { effectiveCreatedBy, targetFilters } = await resolveCampaignCreatorIdentity(
    supabaseAdmin,
    params.adminId,
    params.adminEmail,
    params.targetFilters
  );

  // 1. Create campaign row
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from("broadcast_campaigns")
    .insert({
      title: params.title.trim(),
      subject: params.subject.trim(),
      body_html: params.bodyHtml,
      body_text: params.bodyText || params.bodyHtml.replace(/<[^>]+>/g, " ").trim(),
      campaign_type: "general",
      status: "queued",
      target_filters: targetFilters,
      total_recipients: cleanEmails.length,
      total_deliveries: cleanEmails.length,
      created_by: effectiveCreatedBy,
    })
    .select("id")
    .single();

  if (campErr || !campaign) {
    throw new Error(`Failed to create broadcast campaign: ${campErr?.message}`);
  }

  // 2. Insert delivery rows
  const deliveries = cleanEmails.map((email) => ({
    campaign_id: campaign.id,
    recipient_email: email,
    channel: "general",
    part_number: 1,
    total_parts: 1,
    subject: params.subject.trim(),
    body_html: params.bodyHtml,
    body_text: params.bodyText || params.bodyHtml.replace(/<[^>]+>/g, " ").trim(),
    status: "queued",
    idempotency_key: generateDeliveryIdempotencyKey(campaign.id, email, "general"),
  }));

  // Insert delivery rows in bounded chunks to avoid PostgreSQL statement timeouts
  const chunkSize =
    options?.chunkSize && options.chunkSize > 0
      ? options.chunkSize
      : BROADCAST_DELIVERY_INSERT_CHUNK_SIZE;

  for (let i = 0; i < deliveries.length; i += chunkSize) {
    const chunk = deliveries.slice(i, i + chunkSize);
    const { error: delErr } = await supabaseAdmin.from("broadcast_deliveries").insert(chunk);
    if (delErr) {
      try {
        const { error: delCampErr } = await supabaseAdmin
          .from("broadcast_campaigns")
          .delete()
          .eq("id", campaign.id);
        if (delCampErr) {
          console.error("[CAMPAIGN CLEANUP ERROR]:", delCampErr);
          await supabaseAdmin
            .from("broadcast_campaigns")
            .update({ status: "failed" })
            .eq("id", campaign.id);
        }
      } catch (cleanupErr) {
        console.error("[CAMPAIGN CLEANUP EXCEPTION]:", cleanupErr);
      }
      throw new Error(`Failed to enqueue broadcast deliveries: ${delErr.message}`);
    }
  }

  return { campaignId: campaign.id, totalDeliveries: cleanEmails.length };
}

/**
 * Creates a certificate campaign, records immutable certificate snapshots, and enqueues individual and/or team backup deliveries.
 * Guaranteed atomic / safely recoverable: campaign header is created first with creator identity validation,
 * and any subsequent failure automatically rolls back both the campaign and any newly created certificates.
 */
export async function createCertificateCampaign(
  supabaseAdmin: SupabaseClient,
  params: CreateCertificateCampaignParams,
  eligibleCandidates: any[],
  options?: CampaignCreationOptions
): Promise<{ campaignId: string; totalDeliveries: number; totalCertificates: number }> {
  if (isPreviewDeployment()) {
    throw new Error(PREVIEW_READONLY_ERROR);
  }
  if (isProductionReadOnlyEnabled()) {
    throw new Error(PRODUCTION_READONLY_ERROR);
  }

  const selectedKeySet = new Set(params.selectedItemKeys);
  const selectedCandidates = (eligibleCandidates || []).filter(
    (c) => selectedKeySet.has(c.issueSourceKey) && c.certificateEligible
  );

  if (selectedCandidates.length === 0) {
    throw new Error("No eligible certificate items selected.");
  }

  const { effectiveCreatedBy, targetFilters } = await resolveCampaignCreatorIdentity(
    supabaseAdmin,
    params.adminId,
    params.adminEmail,
    params.targetFilters
  );

  let campaignId: string | null = null;
  const newlyCreatedCertIds: string[] = [];

  try {
    // 1. Create campaign header in draft status FIRST so creator FK and header constraints are validated
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .insert({
        title: params.title.trim(),
        subject: params.subject.trim(),
        body_html: params.bodyHtml,
        body_text: params.bodyText || params.bodyHtml.replace(/<[^>]+>/g, " ").trim(),
        campaign_type: "certificate",
        status: "draft",
        target_filters: targetFilters,
        total_recipients: selectedCandidates.length,
        total_deliveries: 0,
        created_by: effectiveCreatedBy,
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      throw new Error(`Failed to create certificate campaign: ${campErr?.message}`);
    }
    const createdCampaignId = campaign.id;
    campaignId = createdCampaignId;

    // 2. Create or retrieve participation_certificates records
    const certificateRecords: any[] = [];
    for (const c of selectedCandidates) {
      const certNumber = generateCertificateNumber(c.issueSourceKey);

      const { data: existingCert } = await supabaseAdmin
        .from("participation_certificates")
        .select("id, certificate_number")
        .eq("issue_source_key", c.issueSourceKey)
        .maybeSingle();

      if (existingCert) {
        certificateRecords.push({ ...c, certificateId: existingCert.id, certificateNumber: existingCert.certificate_number });
      } else {
        // In hybrid mode or for synthetic fixtures, the referenced registration rows may exist only in hosted Supabase.
        // We verify if the target row exists in the campaign database before setting relational foreign keys.
        // The schema's original_* columns permanently preserve the authoritative immutable UUIDs.
        let fkParticipantEventId: string | null = null;
        let fkParticipantEventMemberId: string | null = null;
        let fkParticipantId: string | null = null;
        let fkEventId: string | null = null;

        if (c.participantEventId) {
          const { data: peExists } = await supabaseAdmin
            .from("participant_events")
            .select("id")
            .eq("id", c.participantEventId)
            .maybeSingle();
          if (peExists) fkParticipantEventId = peExists.id;
        }

        if (c.memberId) {
          const { data: memExists } = await supabaseAdmin
            .from("participant_event_members")
            .select("id")
            .eq("id", c.memberId)
            .maybeSingle();
          if (memExists) fkParticipantEventMemberId = memExists.id;
        }

        if (c.participantId) {
          const { data: pExists } = await supabaseAdmin
            .from("participants")
            .select("id")
            .eq("id", c.participantId)
            .maybeSingle();
          if (pExists) fkParticipantId = pExists.id;
        }

        if (c.eventId) {
          const { data: evExists } = await supabaseAdmin
            .from("events")
            .select("id")
            .eq("id", c.eventId)
            .maybeSingle();
          if (evExists) fkEventId = evExists.id;
        }

        const { data: newCert, error: insErr } = await supabaseAdmin
          .from("participation_certificates")
          .insert({
            certificate_number: certNumber,
            issue_source_key: c.issueSourceKey,
            original_participant_event_id: c.participantEventId,
            original_member_row_id: c.memberId || null,
            original_participant_id: c.participantId || null,
            participant_event_id: fkParticipantEventId,
            participant_event_member_id: fkParticipantEventMemberId,
            participant_id: fkParticipantId,
            event_id: fkEventId,
            recipient_name: c.recipientName,
            recipient_email: c.recipientEmail || null,
            event_name: c.eventName,
            team_name: c.teamName || null,
            template_version: TEMPLATE_VERSION,
            template_hash: EXPECTED_TEMPLATE_HASH,
          })
          .select("id, certificate_number")
          .single();

        if (insErr || !newCert) {
          throw new Error(`Failed to issue certificate record for ${c.recipientName}: ${insErr?.message}`);
        }
        newlyCreatedCertIds.push(newCert.id);
        certificateRecords.push({ ...c, certificateId: newCert.id, certificateNumber: newCert.certificate_number });
      }
    }

    // 3. Build delivery rows and attachments
    const deliveryRows: any[] = [];
    const attachmentLinks: any[] = [];

    // Individual Deliveries (if enabled)
    if (params.sendIndividual) {
      const byEmail = new Map<string, any[]>();
      for (const cert of certificateRecords) {
        if (cert.recipientEmail && cert.isValidEmail) {
          const norm = cert.recipientEmail.trim().toLowerCase();
          const list = byEmail.get(norm) || [];
          list.push(cert);
          byEmail.set(norm, list);
        }
      }

      for (const [normEmail, certs] of byEmail.entries()) {
        const deliveryId = crypto.randomUUID();
        const recipientName = certs[0]?.recipientName || "Participant";
        const idempKey = generateDeliveryIdempotencyKey(createdCampaignId, normEmail, "individual");

        deliveryRows.push({
          id: deliveryId,
          campaign_id: createdCampaignId,
          recipient_email: normEmail,
          recipient_name: recipientName,
          channel: "individual",
          part_number: 1,
          total_parts: 1,
          subject: params.subject.trim(),
          body_html: params.bodyHtml,
          body_text: params.bodyText || params.bodyHtml.replace(/<[^>]+>/g, " ").trim(),
          status: "queued",
          idempotency_key: idempKey,
        });

        for (const cert of certs) {
          attachmentLinks.push({
            delivery_id: deliveryId,
            certificate_id: cert.certificateId,
            filename: `Saviskar_Certificate_${cert.eventName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
            size_bytes: 433000,
          });
        }
      }
    }

    // Team Backup Deliveries (if enabled)
    if (params.sendTeamBackup) {
      const teamsMap = new Map<string, any[]>();
      for (const cert of certificateRecords) {
        if (cert.isTeam && cert.teamContactEmail) {
          const teamKey = `${cert.participantEventId}_${cert.teamContactEmail.trim().toLowerCase()}`;
          const list = teamsMap.get(teamKey) || [];
          list.push(cert);
          teamsMap.set(teamKey, list);
        }
      }

      for (const [_, teamCerts] of teamsMap.entries()) {
        const contactEmail = teamCerts[0].teamContactEmail.trim().toLowerCase();
        const teamName = teamCerts[0].teamName || "Team";
        const chunkSize = 35;
        const totalParts = Math.ceil(teamCerts.length / chunkSize);

        for (let partIdx = 0; partIdx < totalParts; partIdx++) {
          const partNumber = partIdx + 1;
          const partCerts = teamCerts.slice(partIdx * chunkSize, (partIdx + 1) * chunkSize);
          const deliveryId = crypto.randomUUID();
          const idempKey = generateDeliveryIdempotencyKey(
            createdCampaignId,
            contactEmail,
            "team_backup",
            partNumber
          );

          const partSubject =
            totalParts > 1
              ? `${params.subject.trim()} [Part ${partNumber} of ${totalParts}] - ${teamName}`
              : `${params.subject.trim()} - ${teamName}`;

          deliveryRows.push({
            id: deliveryId,
            campaign_id: createdCampaignId,
            recipient_email: contactEmail,
            recipient_name: `${teamName} Leader`,
            channel: "team_backup",
            part_number: partNumber,
            total_parts: totalParts,
            subject: partSubject,
            body_html: params.bodyHtml,
            body_text: params.bodyText || params.bodyHtml.replace(/<[^>]+>/g, " ").trim(),
            status: "queued",
            idempotency_key: idempKey,
          });

          for (const cert of partCerts) {
            attachmentLinks.push({
              delivery_id: deliveryId,
              certificate_id: cert.certificateId,
              filename: `Saviskar_Certificate_${cert.recipientName.replace(/[^a-zA-Z0-9]/g, "_")}_${cert.eventName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
              size_bytes: 433000,
            });
          }
        }
      }
    }

    if (deliveryRows.length === 0) {
      throw new Error("No deliveries could be formed (both individual and team options produced 0 recipients with valid emails).");
    }

    // 4. Insert delivery rows and attachment manifests in bounded chunks
    const chunkSize =
      options?.chunkSize && options.chunkSize > 0
        ? options.chunkSize
        : BROADCAST_DELIVERY_INSERT_CHUNK_SIZE;

    for (let i = 0; i < deliveryRows.length; i += chunkSize) {
      const chunk = deliveryRows.slice(i, i + chunkSize);
      const { error: insDelErr } = await supabaseAdmin.from("broadcast_deliveries").insert(chunk);
      if (insDelErr) {
        throw new Error(`Failed to enqueue certificate deliveries: ${insDelErr.message}`);
      }
    }

    if (attachmentLinks.length > 0) {
      for (let i = 0; i < attachmentLinks.length; i += chunkSize) {
        const chunk = attachmentLinks.slice(i, i + chunkSize);
        const { error: insAttErr } = await supabaseAdmin.from("broadcast_delivery_attachments").insert(chunk);
        if (insAttErr) {
          throw new Error(`Failed to link certificate attachments: ${insAttErr.message}`);
        }
      }
    }

    // 5. Finalize campaign to queued status and update delivery count
    const { error: updCampErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .update({
        status: "queued",
        total_deliveries: deliveryRows.length,
      })
      .eq("id", createdCampaignId);

    if (updCampErr) {
      throw new Error(`Failed to finalize certificate campaign: ${updCampErr.message}`);
    }

    return {
      campaignId: createdCampaignId,
      totalDeliveries: deliveryRows.length,
      totalCertificates: certificateRecords.length,
    };
  } catch (err) {
    // Compensating rollback:
    // 1. Delete campaign (cascades deliveries and attachments via foreign key ON DELETE CASCADE)
    if (campaignId) {
      try {
        const { error: delCampErr } = await supabaseAdmin
          .from("broadcast_campaigns")
          .delete()
          .eq("id", campaignId);
        if (delCampErr) {
          console.error("[CAMPAIGN ROLLBACK - CAMPAIGN]:", delCampErr);
          await supabaseAdmin
            .from("broadcast_campaigns")
            .update({ status: "failed" })
            .eq("id", campaignId);
        }
      } catch (delCampErr) {
        console.error("[CAMPAIGN ROLLBACK - CAMPAIGN]:", delCampErr);
      }
    }

    // 2. Delete newly created certificates from this attempt so no orphaned certificates remain
    if (newlyCreatedCertIds.length > 0) {
      try {
        await supabaseAdmin.from("participation_certificates").delete().in("id", newlyCreatedCertIds);
      } catch (delCertErr) {
        console.error("[CAMPAIGN ROLLBACK - CERTIFICATES]:", delCertErr);
      }
    }

    throw err;
  }
}

export interface ProcessBatchOptions {
  batchSize?: number;
  workerId?: string;
  leaseSeconds?: number;
  campaignId?: string;
}

/**
 * Worker function to claim and process the next bounded batch of deliveries atomically.
 * Supports optional campaignId scoping to ensure batch execution is strictly isolated to a specific campaign.
 */
export async function processNextBroadcastBatch(
  supabaseAdmin: SupabaseClient,
  batchSizeOrOptions: number | ProcessBatchOptions = 10,
  workerIdArg?: string,
  leaseSecondsArg = 300,
  campaignIdArg?: string
): Promise<ProcessBatchResult> {
  const isOptions = typeof batchSizeOrOptions === "object" && batchSizeOrOptions !== null;
  const batchSize = isOptions ? batchSizeOrOptions.batchSize ?? 10 : batchSizeOrOptions;
  const workerId = isOptions
    ? batchSizeOrOptions.workerId ?? `worker_${process.pid}_${Math.random().toString(36).substring(7)}`
    : workerIdArg ?? `worker_${process.pid}_${Math.random().toString(36).substring(7)}`;
  const leaseSeconds = isOptions ? batchSizeOrOptions.leaseSeconds ?? 300 : leaseSecondsArg;
  const campaignId = isOptions ? batchSizeOrOptions.campaignId : campaignIdArg;

  // Fail-closed guard: Batch worker processing is strictly forbidden in preview or read-only mode
  if (isPreviewDeployment()) {
    throw new Error(PREVIEW_READONLY_ERROR);
  }
  if (isProductionReadOnlyEnabled()) {
    throw new Error(PRODUCTION_READONLY_ERROR);
  }

  // 1. Atomic claim via RPC (FOR UPDATE SKIP LOCKED)
  const rpcParams: Record<string, any> = {
    p_batch_size: batchSize,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  };
  if (campaignId) {
    rpcParams.p_campaign_id = campaignId;
  }

  const { data: claimedDeliveries, error: claimErr } = await supabaseAdmin.rpc(
    "claim_broadcast_deliveries",
    rpcParams
  );

  if (claimErr) {
    console.error("[CAMPAIGN WORKER] Claim error:", claimErr);
    const error = new Error(
      claimErr.message || "Failed to claim broadcast deliveries from queue"
    );
    (error as any).code = claimErr.code;
    throw error;
  }

  if (!claimedDeliveries || claimedDeliveries.length === 0) {
    return { processedCount: 0, successCount: 0, failureCount: 0, details: [] };
  }

  const details: Array<{ deliveryId: string; recipient: string; success: boolean; error?: string }> = [];
  let successCount = 0;
  let failureCount = 0;

  for (const delivery of claimedDeliveries) {
    try {
      // 1. Crash recovery: If provider_message_id is ALREADY set, the provider already accepted it!
      // Do not re-dispatch; reconcile status to 'sent' directly.
      if (delivery.provider_message_id) {
        await supabaseAdmin
          .from("broadcast_deliveries")
          .update({
            status: "sent",
            sent_at: delivery.sent_at || new Date().toISOString(),
            error_message: null,
            error_code: null,
          })
          .eq("id", delivery.id);

        try {
          await supabaseAdmin.rpc("increment_campaign_sent_count", {
            p_campaign_id: delivery.campaign_id,
          });
        } catch {
          // ignore
        }

        successCount++;
        details.push({
          deliveryId: delivery.id,
          recipient: delivery.recipient_email,
          success: true,
        });
        continue;
      }

      // 2. Crash recovery & idempotency window guard:
      // If delivery is a retry/crash recovery (attempts > 1) and was created > 24 hours ago,
      // the provider's idempotency window has lapsed. Do not blindly re-dispatch.
      const deliveryAgeMs = Date.now() - new Date(delivery.created_at).getTime();
      const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

      if (delivery.attempts > 1 && deliveryAgeMs > IDEMPOTENCY_WINDOW_MS) {
        await supabaseAdmin
          .from("broadcast_deliveries")
          .update({
            status: "manual_review",
            error_message:
              "Delivery retry exceeded the 24-hour provider idempotency window. Held for manual review to prevent duplicate dispatch.",
            error_code: "EXPIRED_IDEMPOTENCY_WINDOW",
          })
          .eq("id", delivery.id);

        failureCount++;
        details.push({
          deliveryId: delivery.id,
          recipient: delivery.recipient_email,
          success: false,
          error: "Expired 24-hour idempotency window",
        });
        continue;
      }

      // 3. Hybrid development mode security guard: Refuse batch dispatch for non-synthetic addresses
      if (isHybridDevelopmentModeActive() && !isSyntheticTestEmail(delivery.recipient_email)) {
        await supabaseAdmin
          .from("broadcast_deliveries")
          .update({
            status: "failed",
            error_message: HYBRID_READONLY_ERROR,
            error_code: "HYBRID_READONLY_PROTECTION",
          })
          .eq("id", delivery.id);

        failureCount++;
        details.push({
          deliveryId: delivery.id,
          recipient: delivery.recipient_email,
          success: false,
          error: HYBRID_READONLY_ERROR,
        });
        continue;
      }

      let attachments: EmailAttachment[] = [];

      // If delivery has attachments (certificates), generate them
      if (delivery.channel === "individual" || delivery.channel === "team_backup") {
        const { data: attRows } = await supabaseAdmin
          .from("broadcast_delivery_attachments")
          .select(`
            filename,
            participation_certificates (
              recipient_name,
              event_name,
              certificate_number
            )
          `)
          .eq("delivery_id", delivery.id);

        if (attRows && attRows.length > 0) {
          for (const row of attRows) {
            const cert = (row as any).participation_certificates;
            if (cert) {
              const { pdfBytes } = await generateParticipationCertificatePdf({
                recipientName: cert.recipient_name,
                eventName: cert.event_name,
                certificateNumber: cert.certificate_number,
              });

              attachments.push({
                filename: row.filename,
                content: Buffer.from(pdfBytes),
              });
            }
          }
        }
      }

      // Dispatch email with original idempotency key
      const sendResult = await sendCampaignEmail({
        to: delivery.recipient_email,
        subject: delivery.subject,
        html: delivery.body_html,
        text: delivery.body_text,
        attachments: attachments.length > 0 ? attachments : undefined,
        idempotencyKey: delivery.idempotency_key,
      });

      if (sendResult.success) {
        await supabaseAdmin
          .from("broadcast_deliveries")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: sendResult.messageId || null,
            error_message: null,
            error_code: null,
          })
          .eq("id", delivery.id);

        // Update campaign counters
        try {
          await supabaseAdmin.rpc("increment_campaign_sent_count", {
            p_campaign_id: delivery.campaign_id,
          });
        } catch {
          // Fallback if helper RPC not defined: direct SQL handled elsewhere
        }

        successCount++;
        details.push({ deliveryId: delivery.id, recipient: delivery.recipient_email, success: true });
      } else {
        const status = sendResult.isRetryable ? "failed" : "manual_review";
        await supabaseAdmin
          .from("broadcast_deliveries")
          .update({
            status,
            error_message: sendResult.error || "Delivery failed",
            error_code: sendResult.errorCode || "SEND_ERROR",
          })
          .eq("id", delivery.id);

        failureCount++;
        details.push({
          deliveryId: delivery.id,
          recipient: delivery.recipient_email,
          success: false,
          error: sendResult.error,
        });
      }
    } catch (err: any) {
      console.error(`[CAMPAIGN WORKER] Exception for delivery ${delivery.id}:`, err);
      await supabaseAdmin
        .from("broadcast_deliveries")
        .update({
          status: "failed",
          error_message: err?.message || String(err),
          error_code: "PROCESSING_EXCEPTION",
        })
        .eq("id", delivery.id);

      failureCount++;
      details.push({
        deliveryId: delivery.id,
        recipient: delivery.recipient_email,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return {
    processedCount: claimedDeliveries.length,
    successCount,
    failureCount,
    details,
  };
}

/**
 * Authoritatively calculates progress counters and updates campaign status
 * strictly adhering to database constraints: 'draft', 'queued', 'processing', 'completed', 'paused', 'cancelled', 'failed'.
 */
export async function updateCampaignProgressAndStatus(
  supabaseAdmin: SupabaseClient,
  campaignId: string
): Promise<{ status: "draft" | "queued" | "processing" | "completed" | "paused" | "cancelled" | "failed"; sentCount: number; failedCount: number; remainingCount: number }> {
  // Query exact database counts per status group using database aggregation ({ count: 'exact', head: true })
  const [sentRes, failedRes, queuedRes, sendingRes, totalRes] = await Promise.all([
    supabaseAdmin
      .from("broadcast_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["sent", "delivered"]),
    supabaseAdmin
      .from("broadcast_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["failed", "manual_review"]),
    supabaseAdmin
      .from("broadcast_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued"),
    supabaseAdmin
      .from("broadcast_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sending"),
    supabaseAdmin
      .from("broadcast_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId),
  ]);

  const queryError =
    sentRes.error ||
    failedRes.error ||
    queuedRes.error ||
    sendingRes.error ||
    totalRes.error;

  if (queryError) {
    console.error(`[CAMPAIGN WORKER] Error querying exact delivery counts for campaign ${campaignId}:`, queryError);
    throw queryError;
  }

  if (
    sentRes.count === null ||
    sentRes.count === undefined ||
    failedRes.count === null ||
    failedRes.count === undefined ||
    queuedRes.count === null ||
    queuedRes.count === undefined ||
    sendingRes.count === null ||
    sendingRes.count === undefined ||
    totalRes.count === null ||
    totalRes.count === undefined
  ) {
    const nullErr = new Error(`Database returned null count for campaign ${campaignId}`);
    console.error(`[CAMPAIGN WORKER] Null count error for campaign ${campaignId}:`, nullErr);
    throw nullErr;
  }

  const sentCount = sentRes.count;
  const failedCount = failedRes.count;
  const queuedCount = queuedRes.count;
  const sendingCount = sendingRes.count;
  const remainingCount = queuedCount + sendingCount;
  const total = totalRes.count;

  let newStatus: "draft" | "queued" | "processing" | "completed" | "paused" | "cancelled" | "failed";

  if (total === 0) {
    newStatus = "queued";
  } else if (remainingCount > 0) {
    // If any deliveries are still queued or sending, campaign is actively processing
    newStatus = "processing";
  } else {
    // All deliveries finished (none queued or sending)
    newStatus = (sentCount === total || sentCount > 0) ? "completed" : "failed";
  }

  const updatePayload: Record<string, any> = {
    status: newStatus,
    sent_count: sentCount,
    failed_count: failedCount,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "completed" || newStatus === "failed") {
    updatePayload.completed_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabaseAdmin
    .from("broadcast_campaigns")
    .update(updatePayload)
    .eq("id", campaignId);

  if (updateErr) {
    console.error(`[CAMPAIGN WORKER] Error updating campaign ${campaignId} status to ${newStatus}:`, updateErr);
    throw updateErr;
  }

  return { status: newStatus, sentCount, failedCount, remainingCount };
}

// ============================================================================
// Worker Concurrency Lease & Queue Orchestration
// ============================================================================

export function isBroadcastEmergencyStopActive(): boolean {
  return (
    process.env.SAVISKAR_BROADCAST_EMERGENCY_STOP === "true" ||
    process.env.NEXT_PUBLIC_BROADCAST_EMERGENCY_STOP === "true"
  );
}

// In-memory lease store as fallback for unit-testing/mock environments
const memoryLeases = new Map<string, { ownerToken: string; expiresAt: number }>();

export function acquireMemoryLease(lockKey: string, ownerToken: string, leaseDurationMs: number): boolean {
  const now = Date.now();
  const existing = memoryLeases.get(lockKey);
  if (existing && existing.expiresAt > now) {
    if (existing.ownerToken === ownerToken) {
      existing.expiresAt = now + leaseDurationMs;
      return true;
    }
    return false;
  }
  memoryLeases.set(lockKey, { ownerToken, expiresAt: now + leaseDurationMs });
  return true;
}

export function releaseMemoryLease(lockKey: string, ownerToken: string): boolean {
  const existing = memoryLeases.get(lockKey);
  if (!existing) return false;
  if (existing.ownerToken === ownerToken) {
    memoryLeases.delete(lockKey);
    return true;
  }
  return false;
}

export function clearAllMemoryLeases(): void {
  memoryLeases.clear();
}

/**
 * Acquires a database-backed worker lease with an expiry and ownership token.
 * Prevents overlapping cron/scheduler executions across connection-pooled environments.
 */
export async function acquireBroadcastWorkerLease(
  supabaseAdmin: SupabaseClient,
  lockKey = "global_queue_worker",
  ownerToken = crypto.randomUUID(),
  leaseSeconds = 45
): Promise<{ acquired: boolean; ownerToken: string }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("acquire_broadcast_worker_lease", {
      p_lock_key: lockKey,
      p_owner_token: ownerToken,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      // In mock/test environments without the RPC applied, fallback to memory lease
      return { acquired: acquireMemoryLease(lockKey, ownerToken, leaseSeconds * 1000), ownerToken };
    }
    return { acquired: Boolean(data), ownerToken };
  } catch {
    return { acquired: acquireMemoryLease(lockKey, ownerToken, leaseSeconds * 1000), ownerToken };
  }
}

/**
 * Releases a database-backed worker lease only if the ownerToken matches.
 * Protects against releasing a newer owner's lease after a stale lease has expired.
 */
export async function releaseBroadcastWorkerLease(
  supabaseAdmin: SupabaseClient,
  lockKey = "global_queue_worker",
  ownerToken: string
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("release_broadcast_worker_lease", {
      p_lock_key: lockKey,
      p_owner_token: ownerToken,
    });
    if (error) {
      return releaseMemoryLease(lockKey, ownerToken);
    }
    return Boolean(data);
  } catch {
    return releaseMemoryLease(lockKey, ownerToken);
  }
}

export interface ProcessActiveQueueOptions {
  timeBudgetMs?: number; // default 20000 ms (20 seconds)
  batchSize?: number; // default 10
  workerId?: string;
  leaseSeconds?: number;
  concurrencyLockKey?: string;
  throttleMs?: number; // default 100 ms
}

export interface ActiveQueueSummary {
  success: boolean;
  status: "completed" | "idle" | "budget_exhausted" | "locked" | "emergency_stopped";
  batchesExecuted: number;
  totalClaimed: number;
  totalSent: number;
  totalFailed: number;
  durationMs: number;
  activeCampaignsProcessed: string[];
  message?: string;
}

/**
 * Main automatic queue orchestrator. Discovers active campaigns ('queued' or 'processing'),
 * acquires a global database-backed concurrency lease, processes batches within a time budget,
 * throttles Resend calls conservatively, and safely reconciles counters and releases locks.
 */
export async function processActiveBroadcastQueue(
  supabaseAdmin: SupabaseClient,
  options: ProcessActiveQueueOptions = {}
): Promise<ActiveQueueSummary> {
  // Fail-closed environment guards
  if (isPreviewDeployment()) {
    throw new Error(PREVIEW_READONLY_ERROR);
  }
  if (isProductionReadOnlyEnabled()) {
    throw new Error(PRODUCTION_READONLY_ERROR);
  }

  // Emergency stop check
  if (isBroadcastEmergencyStopActive()) {
    return {
      success: true,
      status: "emergency_stopped",
      batchesExecuted: 0,
      totalClaimed: 0,
      totalSent: 0,
      totalFailed: 0,
      durationMs: 0,
      activeCampaignsProcessed: [],
      message: "Queue processing halted by emergency stop (SAVISKAR_BROADCAST_EMERGENCY_STOP=true).",
    };
  }

  const timeBudgetMs = Math.max(5000, Math.min(options.timeBudgetMs ?? 20000, 25000));
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 25));
  const throttleMs = options.throttleMs ?? 100;
  const lockKey = options.concurrencyLockKey || "global_queue_worker";
  const workerId = options.workerId || `auto_worker_${process.pid}_${Math.random().toString(36).substring(7)}`;
  const ownerToken = crypto.randomUUID();

  // Lease duration must be comfortably larger than the execution budget
  const leaseSeconds = Math.ceil(timeBudgetMs / 1000) + 15;

  const { acquired } = await acquireBroadcastWorkerLease(
    supabaseAdmin,
    lockKey,
    ownerToken,
    leaseSeconds
  );

  if (!acquired) {
    return {
      success: true,
      status: "locked",
      batchesExecuted: 0,
      totalClaimed: 0,
      totalSent: 0,
      totalFailed: 0,
      durationMs: 0,
      activeCampaignsProcessed: [],
      message: "Skipped: another worker lease is currently active.",
    };
  }

  const startTime = Date.now();
  const reserveBufferMs = 3000; // Leave 3s buffer to finalize counters & release lock safely
  let batchesExecuted = 0;
  let totalClaimed = 0;
  let totalSent = 0;
  let totalFailed = 0;
  const activeCampaignsProcessed: string[] = [];
  let budgetExhausted = false;

  try {
    // 1. Discover all active campaigns eligible for dispatch
    const { data: activeCampaigns, error: campErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .select("id, status, title")
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true });

    if (campErr) {
      console.error("[AUTO WORKER] Error discovering active campaigns:", campErr);
      throw campErr;
    }

    if (!activeCampaigns || activeCampaigns.length === 0) {
      return {
        success: true,
        status: "idle",
        batchesExecuted: 0,
        totalClaimed: 0,
        totalSent: 0,
        totalFailed: 0,
        durationMs: Date.now() - startTime,
        activeCampaignsProcessed: [],
        message: "Queue idle: no active campaigns in queued or processing status.",
      };
    }

    // 2. Process deliveries across active campaigns
    for (const campaign of activeCampaigns) {
      if (Date.now() - startTime >= timeBudgetMs - reserveBufferMs) {
        budgetExhausted = true;
        break;
      }
      if (isBroadcastEmergencyStopActive()) {
        break;
      }

      let campaignHasMore = true;
      while (campaignHasMore) {
        if (Date.now() - startTime >= timeBudgetMs - reserveBufferMs) {
          budgetExhausted = true;
          break;
        }
        if (isBroadcastEmergencyStopActive()) {
          break;
        }

        const batchResult = await processNextBroadcastBatch(supabaseAdmin, {
          batchSize,
          campaignId: campaign.id,
          workerId,
        });

        if (batchResult.processedCount === 0) {
          campaignHasMore = false;
          break;
        }

        batchesExecuted++;
        totalClaimed += batchResult.processedCount;
        totalSent += batchResult.successCount;
        totalFailed += batchResult.failureCount;

        if (!activeCampaignsProcessed.includes(campaign.id)) {
          activeCampaignsProcessed.push(campaign.id);
        }

        // Reconcile status and counters using exact aggregations
        await updateCampaignProgressAndStatus(supabaseAdmin, campaign.id);

        if (throttleMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, throttleMs));
        }
      }
    }

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      status: budgetExhausted ? "budget_exhausted" : totalClaimed > 0 ? "completed" : "idle",
      batchesExecuted,
      totalClaimed,
      totalSent,
      totalFailed,
      durationMs,
      activeCampaignsProcessed,
      message: budgetExhausted
        ? `Execution budget reached (${durationMs}ms). Processed ${totalClaimed} deliveries in ${batchesExecuted} batches.`
        : `Processed ${totalClaimed} deliveries in ${batchesExecuted} batches.`,
    };
  } finally {
    // 3. Always release the worker lease safely
    try {
      await releaseBroadcastWorkerLease(supabaseAdmin, lockKey, ownerToken);
    } catch (relErr) {
      console.error("[AUTO WORKER] Error releasing lease:", relErr);
    }
  }
}

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
  isSyntheticTestEmail,
  HYBRID_READONLY_ERROR,
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
 * Creates a general email broadcast campaign and enqueues deliveries.
 */
export async function createGeneralBroadcastCampaign(
  supabaseAdmin: SupabaseClient,
  params: CreateGeneralCampaignParams
): Promise<{ campaignId: string; totalDeliveries: number }> {
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

  const { error: delErr } = await supabaseAdmin.from("broadcast_deliveries").insert(deliveries);
  if (delErr) {
    await supabaseAdmin.from("broadcast_campaigns").delete().eq("id", campaign.id);
    throw new Error(`Failed to enqueue broadcast deliveries: ${delErr.message}`);
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
  eligibleCandidates: any[]
): Promise<{ campaignId: string; totalDeliveries: number; totalCertificates: number }> {
  const selectedKeySet = new Set(params.selectedItemKeys);
  const selectedCandidates = eligibleCandidates.filter(
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

    // 4. Insert delivery rows and attachment manifests
    const { error: insDelErr } = await supabaseAdmin.from("broadcast_deliveries").insert(deliveryRows);
    if (insDelErr) {
      throw new Error(`Failed to enqueue certificate deliveries: ${insDelErr.message}`);
    }

    if (attachmentLinks.length > 0) {
      const { error: insAttErr } = await supabaseAdmin.from("broadcast_delivery_attachments").insert(attachmentLinks);
      if (insAttErr) {
        throw new Error(`Failed to link certificate attachments: ${insAttErr.message}`);
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
        await supabaseAdmin.from("broadcast_campaigns").delete().eq("id", campaignId);
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
    return { processedCount: 0, successCount: 0, failureCount: 0, details: [] };
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
  // Query all delivery statuses for this campaign
  const { data: deliveries, error: delErr } = await supabaseAdmin
    .from("broadcast_deliveries")
    .select("status")
    .eq("campaign_id", campaignId);

  if (delErr) {
    console.error(`[CAMPAIGN WORKER] Error querying deliveries for campaign ${campaignId}:`, delErr);
    throw delErr;
  }

  const allDeliveries = deliveries || [];
  const total = allDeliveries.length;
  const sentCount = allDeliveries.filter((d) => d.status === "sent" || d.status === "delivered").length;
  const failedCount = allDeliveries.filter((d) => d.status === "failed" || d.status === "manual_review").length;
  const remainingCount = allDeliveries.filter((d) => d.status === "queued" || d.status === "sending").length;

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

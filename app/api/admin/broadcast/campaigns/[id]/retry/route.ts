import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getBroadcastSupabaseAdmin,
  isHybridDevelopmentModeActive,
  isSyntheticTestEmail,
  HYBRID_READONLY_ERROR,
} from "@/lib/broadcast/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireMasterAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      { status: auth.status }
    );
  }

  const { id } = await context.params;
  try {
    const body = await request.json();
    const deliveryIds = Array.isArray(body?.deliveryIds)
      ? body.deliveryIds
      : body?.deliveryId
      ? [body.deliveryId]
      : [];
    const action = body?.action || "retry_failed";

    if (deliveryIds.length === 0) {
      return NextResponse.json(
        { error: "At least one deliveryId must be specified." },
        { status: 400 }
      );
    }

    const supabaseAdmin = getBroadcastSupabaseAdmin();

    if (isHybridDevelopmentModeActive()) {
      const { data: targetDeliveries } = await supabaseAdmin
        .from("broadcast_deliveries")
        .select("recipient_email")
        .in("id", deliveryIds);

      if (targetDeliveries && targetDeliveries.some((d) => !isSyntheticTestEmail(d.recipient_email))) {
        return NextResponse.json(
          { error: HYBRID_READONLY_ERROR },
          { status: 400 }
        );
      }
    }

    if (action === "retry_failed") {
      // Reset status to queued for failed deliveries
      const { data: updated, error } = await supabaseAdmin
        .from("broadcast_deliveries")
        .update({
          status: "queued",
          error_message: null,
          error_code: null,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("campaign_id", id)
        .in("id", deliveryIds)
        .in("status", ["failed", "manual_review"])
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Ensure campaign is set back to processing / queued
      const { error: updateCampErr } = await supabaseAdmin
        .from("broadcast_campaigns")
        .update({ status: "processing" })
        .eq("id", id);
      if (updateCampErr) {
        return NextResponse.json({ error: updateCampErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: "retry_failed",
        requeuedCount: updated?.length || 0,
      });
    }

    if (action === "resend_explicit") {
      // Authorize explicit resend: duplicate delivery rows with fresh idempotency keys
      const { data: existingDeliveries, error: fetchErr } = await supabaseAdmin
        .from("broadcast_deliveries")
        .select(`
          recipient_email,
          recipient_name,
          channel,
          part_number,
          total_parts,
          subject,
          body_html,
          body_text,
          broadcast_delivery_attachments (
            certificate_id,
            filename,
            size_bytes
          )
        `)
        .eq("campaign_id", id)
        .in("id", deliveryIds);

      if (fetchErr || !existingDeliveries) {
        return NextResponse.json(
          { error: fetchErr?.message || "Failed to load existing deliveries" },
          { status: 500 }
        );
      }

      if (existingDeliveries.length === 0) {
        return NextResponse.json(
          { error: "No matching deliveries found to resend." },
          { status: 404 }
        );
      }

      const newDeliveries: any[] = [];
      const newAttachments: any[] = [];

      for (const d of existingDeliveries) {
        const newDeliveryId = crypto.randomUUID();
        const newIdempKey = `resend_${id}_${d.recipient_email}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        newDeliveries.push({
          id: newDeliveryId,
          campaign_id: id,
          recipient_email: d.recipient_email,
          recipient_name: d.recipient_name,
          channel: d.channel,
          part_number: d.part_number,
          total_parts: d.total_parts,
          subject: d.subject,
          body_html: d.body_html,
          body_text: d.body_text,
          status: "queued",
          idempotency_key: newIdempKey,
        });

        const atts = (d as any).broadcast_delivery_attachments;
        if (atts && Array.isArray(atts)) {
          for (const att of atts) {
            newAttachments.push({
              delivery_id: newDeliveryId,
              certificate_id: att.certificate_id,
              filename: att.filename,
              size_bytes: att.size_bytes,
            });
          }
        }
      }

      if (newDeliveries.length > 0) {
        const createdDeliveryIds = newDeliveries.map((d) => d.id);

        // 1. Insert new delivery rows with error handling
        const { error: insertDelErr } = await supabaseAdmin
          .from("broadcast_deliveries")
          .insert(newDeliveries);

        if (insertDelErr) {
          console.error("[RESEND EXPLICIT DELIVERIES INSERT ERROR]:", insertDelErr);
          return NextResponse.json(
            { error: insertDelErr.message || "Failed to insert resend deliveries" },
            { status: 500 }
          );
        }

        // 2. Insert attachments if applicable with rollback compensation
        if (newAttachments.length > 0) {
          const { error: insertAttErr } = await supabaseAdmin
            .from("broadcast_delivery_attachments")
            .insert(newAttachments);

          if (insertAttErr) {
            console.error("[RESEND EXPLICIT ATTACHMENTS INSERT ERROR]:", insertAttErr);
            // Safe compensation: delete newly created deliveries to prevent attachment-free resends
            try {
              await supabaseAdmin
                .from("broadcast_deliveries")
                .delete()
                .in("id", createdDeliveryIds);
            } catch (compErr) {
              console.error("[RESEND COMPENSATION ERROR]:", compErr);
            }
            return NextResponse.json(
              { error: insertAttErr.message || "Failed to insert attachments for resend deliveries" },
              { status: 500 }
            );
          }
        }

        // 3. Query current campaign totals with error handling
        const { data: campaign, error: campFetchErr } = await supabaseAdmin
          .from("broadcast_campaigns")
          .select("total_deliveries")
          .eq("id", id)
          .single();

        if (campFetchErr || !campaign) {
          console.error("[RESEND CAMPAIGN TOTALS FETCH ERROR]:", campFetchErr);
          // Safe compensation: rollback newly created deliveries
          try {
            await supabaseAdmin
              .from("broadcast_deliveries")
              .delete()
              .in("id", createdDeliveryIds);
          } catch (compErr) {
            console.error("[RESEND COMPENSATION ERROR]:", compErr);
          }
          return NextResponse.json(
            { error: campFetchErr?.message || "Failed to query campaign totals" },
            { status: 500 }
          );
        }

        // 4. Update campaign counter and status with error handling
        const { error: updateCampErr2 } = await supabaseAdmin
          .from("broadcast_campaigns")
          .update({
            total_deliveries: (campaign.total_deliveries || 0) + newDeliveries.length,
            status: "processing",
          })
          .eq("id", id);

        if (updateCampErr2) {
          console.error("[RESEND CAMPAIGN COUNTER UPDATE ERROR]:", updateCampErr2);
          // Safe compensation: rollback newly created deliveries
          try {
            await supabaseAdmin
              .from("broadcast_deliveries")
              .delete()
              .in("id", createdDeliveryIds);
          } catch (compErr) {
            console.error("[RESEND COMPENSATION ERROR]:", compErr);
          }
          return NextResponse.json(
            { error: updateCampErr2.message || "Failed to update campaign delivery counters" },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({
        success: true,
        action: "resend_explicit",
        createdCount: newDeliveries.length,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Retry failed" }, { status: 500 });
  }
}

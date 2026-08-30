const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function main() {
  console.log("=== COMPREHENSIVE DB AUDIT ===");

  // 1. Payments
  const { data: payments, error: payErr } = await supabase
    .from("payments")
    .select("id, participant_id, participant_event_id, amount, status, gateway_payment_id");
  console.log("Payments in DB:", payments?.length, payments);

  // 2. Payment Order Items
  const { data: pois, error: poiErr } = await supabase
    .from("payment_order_items")
    .select("id, payment_order_id, participant_event_id, event_id, amount");
  console.log("Payment Order Items in DB:", pois?.length, pois);

  // 3. Team Members
  const { data: members, error: memErr } = await supabase
    .from("participant_event_members")
    .select("id, participant_event_id, name, email, is_team_leader, participant_id");
  console.log("Participant Event Members in DB:", members?.length, members);

  // 4. Audit Logs
  const { data: logs, error: logErr } = await supabase
    .from("admin_audit_logs")
    .select("id, action_type, target_id, details, created_at");
  console.log("Admin Audit Logs in DB:", logs?.length);
}

main().catch(console.error);

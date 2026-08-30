const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== CHECKING PRODUCTION DB STATE ===");

  // 1. Events
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, name, category, registration_type, registration_fee, payment_type, payment_unit, active, registration_open");
  
  if (evErr) console.error("Events error:", evErr);
  else console.log("Events in DB:", events);

  // 2. Participants
  const { data: participants, error: pErr } = await supabase
    .from("participants")
    .select("id, participant_id, name, email, college, phone");
  
  if (pErr) console.error("Participants error:", pErr);
  else console.log("Participants count:", participants?.length, participants);

  // 3. Participant Events
  const { data: pes, error: peErr } = await supabase
    .from("participant_events")
    .select("id, participant_id, event_id, registration_status, payment_status, payment_amount, is_archived");
  
  if (peErr) console.error("Participant Events error:", peErr);
  else console.log("Participant Events count:", pes?.length, pes);

  // 4. Payment Orders
  const { data: orders, error: oErr } = await supabase
    .from("payment_orders")
    .select("id, order_reference, amount, currency, status, gateway, gateway_order_id, payer_participant_id");
  
  if (oErr) console.error("Payment Orders error:", oErr);
  else console.log("Payment Orders count:", orders?.length, orders);
}

main().catch(console.error);

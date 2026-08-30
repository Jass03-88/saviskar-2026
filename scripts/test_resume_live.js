const { createHmac, randomBytes, timingSafeEqual } = require("crypto");
require("dotenv").config({ path: ".env.local" });

function base64UrlEncode(input) {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createToken(params, secret, expiresInMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const exp = now + expiresInMs;
  const nonce = randomBytes(16).toString("hex");

  const payload = {
    paymentOrderId: params.paymentOrderId,
    participantId: params.participantId,
    payerParticipantUuid: params.payerParticipantUuid,
    iat: now,
    exp,
    nonce,
  };

  const payloadString = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadString);

  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

async function testLiveSecurity() {
  console.log("=== RUNNING LIVE SECURITY INVARIANT CHECKS ===");

  const secret = process.env.PAYMENT_RESUME_TOKEN_SECRET || process.env.SUPABASE_SECRET_KEY;
  const validToken = createToken(
    {
      paymentOrderId: "4d5a82bf-48eb-4c23-bdeb-ef18721b59cd",
      participantId: "SVK26-FFE51470",
      payerParticipantUuid: "9ab32acb-c39a-49a1-9e30-b1e7b23fed18",
    },
    secret
  );

  // 1. Parameter tampering: client passes amount=1
  const tamperUrl = `https://saviskar-2026.vercel.app/api/payments/resume?token=${encodeURIComponent(validToken)}&amount=1&paymentOrderId=fake`;
  const res1 = await fetch(tamperUrl);
  const json1 = await res1.json();
  console.log("1. Parameter Tampering (amount=1 query param):", { status: res1.status, amountReturned: json1.amount });

  // 2. Tampered signature
  const tamperedToken = validToken.slice(0, -4) + "XXXX";
  const res2 = await fetch(`https://saviskar-2026.vercel.app/api/payments/resume?token=${encodeURIComponent(tamperedToken)}`);
  const json2 = await res2.json();
  console.log("2. Tampered Signature Token:", { status: res2.status, body: json2 });

  // 3. Expired token
  const expiredToken = createToken(
    {
      paymentOrderId: "4d5a82bf-48eb-4c23-bdeb-ef18721b59cd",
      participantId: "SVK26-FFE51470",
      payerParticipantUuid: "9ab32acb-c39a-49a1-9e30-b1e7b23fed18",
    },
    secret,
    -60000
  );
  const res3 = await fetch(`https://saviskar-2026.vercel.app/api/payments/resume?token=${encodeURIComponent(expiredToken)}`);
  const json3 = await res3.json();
  console.log("3. Expired Token:", { status: res3.status, body: json3 });

  // 4. Cross-participant mismatch (valid token for participant A, but payload claims participant B uuid)
  const crossToken = createToken(
    {
      paymentOrderId: "4d5a82bf-48eb-4c23-bdeb-ef18721b59cd",
      participantId: "SVK26-FFE51470",
      payerParticipantUuid: "5d44e44d-3d0a-49ec-bf63-61622f780d6f", // other user
    },
    secret
  );
  const res4 = await fetch(`https://saviskar-2026.vercel.app/api/payments/resume?token=${encodeURIComponent(crossToken)}`);
  const json4 = await res4.json();
  console.log("4. Cross-Participant Payer Mismatch:", { status: res4.status, body: json4 });
}

testLiveSecurity().catch(console.error);

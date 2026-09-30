# Saviskar 2026 — Production Operations & Deployment Runbook

**System:** Saviskar 2026 (*Aevorian Reverie*)  
**Architecture:** Next.js 16.3.4 (App Router), React 19.2.4, Supabase (PostgreSQL 15+), Resend, PayU, Tailwind CSS v4, Three.js  
**Target Horizon:** October 27–28, 2026 (Traffic surge: 35,000+ university attendees, 100+ concurrent scanners)

---

## 1. Environment Variables Specification

All environment variables are strictly categorized by security classification. **Never** expose `CRITICAL_SECRET` variables in client-side bundles or `NEXT_PUBLIC_` prefixes.

| Variable Name | Scope | Classification | Default / Example | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (Client + Server) | `PUBLIC` | `https://xyzcompany.supabase.co` | Supabase API URL endpoint. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (Client + Server) | `PUBLIC` | `eyJhbGci...` | Supabase anon key with RLS enforcement. |
| `SUPABASE_SECRET_KEY` | Server Only | `CRITICAL_SECRET` | `sbp_...` / `eyJ...` | Supabase Service Role Key for elevated backend RPCs & admin actions. |
| `PayU_KEY_ID` | Public / Server | `PUBLIC` | `rzp_live_...` | PayU public key ID initialized in frontend checkout. |
| `PayU_KEY_SECRET` | Server Only | `CRITICAL_SECRET` | `secret_...` | PayU API secret key for HMAC signature verification and order creation. |
| `PayU_WEBHOOK_SECRET` | Server Only | `CRITICAL_SECRET` | `whsec_...` | PayU webhook signature verification secret for `/api/payments/webhook`. |
| `RESEND_API_KEY` | Server Only | `CRITICAL_SECRET` | `re_...` | Resend API key for transactional emails and delegate passes. |
| `RESEND_FROM_EMAIL` | Server Only | `INTERNAL_CONFIG` | `Saviskar 2026 <noreply@saviskar.co.in>` | Production verified sender address. |
| `PRIMARY_ADMIN_USER_ID` | Server Only | `CRITICAL_SECRET` | `usr_...` / UUID | Root super-admin Supabase Auth UID with initial access permissions. |
| `NEXT_PUBLIC_SITE_URL` | Public | `INTERNAL_CONFIG` | `https://saviskar.co.in` | Canonical URL used for absolute links and QR pass verification URLs. |
| `NEXT_PUBLIC_SENTRY_DSN` | Public / Server | `PUBLIC` | `https://...ingest.sentry.io/...` | Optional Sentry DSN for client and server error reporting. |
| `NODE_ENV` | Build & Runtime | `INTERNAL_CONFIG` | `production` | Enables React production optimizations and strict HSTS headers. |

---

## 2. Supabase Migration Checklist

Before directing traffic to the production cluster, execute migrations in exact sequential order:

1. **Verify Connection & Extensions:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

2. **Run Baseline Schema:**
   Apply `supabase/schema.sql`. Ensure tables exist:
   - `events`
   - `participants`
   - `participant_events`
   - `payment_orders`
   - `payment_order_items`
   - `payments`
   - `admin_users`
   - `admin_audit_logs`

3. **Apply Registration OTP Migration:**
   Apply `supabase/migrations/20260919060000_create_registration_otps.sql`:
   - Creates `registration_otps` table.
   - Enforces SHA-256 hashed OTP storage (`otp_hash`).
   - Restricts RLS: `REVOKE ALL ON registration_otps FROM anon, authenticated;`.

4. **Verify RLS & Function Permissions:**
   Ensure `register_participant_events` function execution is revoked from `anon`:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.register_participant_events FROM anon;
   GRANT EXECUTE ON FUNCTION public.register_participant_events TO service_role;
   ```

---

## 3. Resend Sender Domain Configuration (DNS)

To prevent festival confirmation emails and entry QR passes from landing in attendee spam folders or bouncing, configure the domain DNS at your registrar:

1. **DKIM Record (TXT):**
   - Host: `resend._domainkey.saviskar.co.in`
   - Value: Provided by Resend dashboard
2. **SPF Record (TXT):**
   - Host: `saviskar.co.in`
   - Value: `v=spf1 include:amazonses.com ~all`
3. **DMARC Record (TXT):**
   - Host: `_dmarc.saviskar.co.in`
   - Value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@saviskar.co.in`
4. **MX Record (Optional for Return-Path):**
   - Host: `bounces.saviskar.co.in`
   - Value: `feedback-smtp.us-east-1.amazonses.com` (Priority 10)

*Verification:* Confirm status reads **Verified** in Resend dashboard before launch.

---

## 4. PayU Webhook Configuration

The webhook serves as the secondary verification system if an attendee closes their browser before `/api/payments/verify` completes.

1. Navigate to **PayU Dashboard > Settings > Webhooks > Add New Webhook**.
2. **Webhook URL:** `https://saviskar.co.in/api/payments/webhook`
3. **Secret:** Generate a 32-character high-entropy secret and store in `PayU_WEBHOOK_SECRET`.
4. **Active Events:**
   - `payment.captured`
   - `payment.failed`
5. **Idempotency Guarantee:**
   The webhook handler in `app/api/payments/webhook/route.ts` employs atomic database status checks and calls `ensurePaymentConfirmationSent()` only once per order.

---

## 5. System Health Check & Telemetry

### Health Probe
- **Endpoint:** `GET /api/health`
- **Response Format:**
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-09-20T16:50:00.000Z",
    "latencyMs": 42,
    "checks": {
      "database": "healthy",
      "environment": {
        "supabase": true,
        "PayU": true,
        "resend": true,
        "primaryAdmin": true
      }
    }
  }
  ```
- **Uptime Monitoring:** Configure external ping (e.g. BetterStack, UptimeRobot) every 60 seconds targeting `/api/health`. Alert if HTTP status != 200.

### Error Ingestion (Sentry)
- Provide `NEXT_PUBLIC_SENTRY_DSN` in Vercel environment variables.
- Handlers in `app/global-error.tsx`, `app/error.tsx`, and `/api/payments/*` automatically pipe unhandled exceptions with release tracking and contextual tags.

---

## 6. Festival Peak Traffic Runbook (October 27–28)

During the October 27–28 peak load, expect sudden bursts of registrations, payment callbacks, and gate scanner pings.

### 1. Supabase Connection Management
- Use Supabase Connection Pooler (`Transaction mode` on port `6543`) for high-concurrency serverless instances.
- Verify maximum pool connections are configured to at least 80% of database instance compute allocation.

### 2. Rate Limiting Protection
- Distributed IP-based and user-based sliding window rate limits are active in `lib/rate-limit.ts`.
- Max 20 registration requests per minute per IP.
- In case of DDoS, activate Cloudflare "Under Attack" mode on `saviskar.co.in`.

### 3. On-Ground Gate Check-In (Scanner Stations)
- Check-in scanner at `/admin/scanner` uses `html5-qrcode` and enforces:
  1. `requireAdmin()` session authentication.
  2. Immediate duplicate pass rejection (`409 Already Checked In`).
  3. Strict payment verification (`402 Payment Pending`).
  4. Audio-visual feedback: low-latency green chime for valid tickets, loud red buzzer for duplicate/unpaid.

### 4. Emergency Fallback: Unpaid / Stuck Registrations
- Direct attendees who encountered network drops during payment to:
  `https://saviskar.co.in/payment/resume`
- Delegates enter their registered email to retrieve all pending orders and resume checkout seamlessly without re-filling forms.

---

## 7. Emergency Rollback Procedure

If a critical flaw is detected during live operations:

1. **Instant Vercel Instant Rollback:**
   - In Vercel Dashboard > Deployments > locate prior stable deployment (`88a4db2` or designated tag).
   - Click `...` > `Instant Rollback`.
   - Traffic diverts immediately within 2 seconds globally.

2. **Database State Preservation:**
   - All migrations and schema structures are backward-compatible.
   - Do NOT run destructive `DROP TABLE` or `DROP COLUMN` during a rollback.

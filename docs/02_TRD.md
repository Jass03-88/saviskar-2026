# Saviskar 2026 — Technical Requirements Document (TRD)

---

## 1. Technology Stack

| Component | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.11 |
| Language | TypeScript | 5.x |
| Runtime | Node.js | 18+ |
| Styling | Tailwind CSS | v4 |
| Database | Supabase / PostgreSQL | Supabase hosted |
| Auth | Supabase Auth | Email/password + TOTP MFA |
| Payment | Razorpay (via abstraction) | REST API v1 |
| Email | Resend SDK | ^6.18.0 |
| PDF | pdf-lib | ^1.17.1 |
| QR Code | qrcode (Node) | ^1.5.4 |
| Animations | GSAP, Motion, OGL | Various |
| Icons | Lucide React | ^0.518.0 |
| Deployment | Vercel | Production |
| Package Manager | npm | — |

---

## 2. Project Structure

```
saviskar-2026/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout (Geist font)
│   ├── globals.css                   # Global styles
│   ├── page.tsx                      # Public landing page
│   ├── register/page.tsx             # Registration form page
│   ├── admin/                        # Admin panel pages
│   │   ├── layout.tsx                # Admin layout
│   │   ├── page.tsx                  # Dashboard (registrations)
│   │   ├── events/                   # Event management
│   │   │   └── [eventID]/registrations/  # Per-event registrations
│   │   ├── admins/                   # Admin management
│   │   ├── logs/                     # Audit logs
│   │   ├── scanner/                  # QR scanner
│   │   ├── login/                    # Login page
│   │   │   └── mfa/                  # TOTP MFA verification
│   │   ├── invite/                   # Invitation landing
│   │   └── reset-password/           # Password reset
│   └── api/                          # API routes
│       ├── register/route.ts         # POST — registration
│       ├── participants/[participantId]/route.ts  # GET — public lookup
│       ├── payments/
│       │   ├── create/route.ts       # POST — create gateway order
│       │   ├── verify/route.ts       # POST — verify payment
│       │   ├── recover/route.ts      # POST — recover abandoned payment
│       │   └── webhook/route.ts      # POST — Razorpay webhook
│       └── admin/
│           ├── registrations/route.ts  # GET/PATCH/DELETE/POST
│           ├── events/route.ts       # GET/POST/PATCH/DELETE
│           ├── admins/route.ts       # GET/POST/DELETE
│           ├── check-in/route.ts     # POST — check-in/check-out
│           └── logs/route.ts         # GET — audit logs
├── components/                       # React components
│   ├── home/                         # Landing page sections
│   ├── registration/                 # RegistrationForm component
│   ├── starnight/                    # Star Night reveal page
│   ├── schedule/                     # Schedule timeline
│   ├── ui/                           # Shared UI (Navbar, Footer, etc.)
│   └── reactbits/                    # Animation utilities
├── lib/                              # Server-side libraries
│   ├── supabase/
│   │   ├── client.ts                 # Browser client (createBrowserClient)
│   │   ├── server.ts                 # Server client + requireAdmin + requireMasterAdmin
│   │   └── proxy.ts                  # Auth cookie refresh middleware
│   ├── payments/
│   │   ├── types.ts                  # PaymentGateway interface
│   │   ├── index.ts                  # Gateway factory
│   │   ├── razorpay.ts              # RazorpayGateway implementation
│   │   └── post-payment.ts          # ensurePaymentConfirmationSent()
│   ├── admin.ts                      # Client-side admin helpers
│   ├── supabase.ts                   # Compatibility export
│   ├── generate-receipt-pdf.ts       # PDF receipt generation (pdf-lib)
│   └── send-registration-email.ts    # Email sending (Resend + QR)
├── data/                             # Static event data
│   ├── events.ts                     # Event listings for frontend
│   └── eventPricing.ts              # Pricing data for frontend
├── supabase/
│   ├── schema.sql                    # Current schema dump
│   └── migrations/                   # Ordered migration chain (5 files)
├── middleware.ts                      # Auth cookie refresh for admin routes
├── next.config.ts                    # Next.js config
├── tailwind.config.ts                # Tailwind config
└── package.json                      # Dependencies
```

---

## 3. API Route Specifications

### 3.1 Public Routes (No Auth)

#### `POST /api/register`
Registration handler. 1,435 lines. Handles:
- Input validation and sanitization
- Rate limiting (8 req/min per IP, in-memory)
- Request body size limiting (48KB)
- Event lookup and validation (active, registration open, team size)
- Participant ID lookup for returning participants
- Team member validation (email uniqueness, size limits)
- Atomic registration via `register_participant_events` RPC
- Payment order creation for paid events
- Registration confirmation email (async)
- Returns: `{ success, participantId, paymentOrderId?, requiresPayment }`

#### `GET /api/participants/[participantId]`
Public participant lookup. Returns limited profile and registered events. Used by the registration form for returning participants.

#### `POST /api/payments/create`
Creates a payment gateway order from an existing `payment_orders` row. Idempotent (reuses existing gateway order if present).

#### `POST /api/payments/verify`
Server-side payment verification. HMAC-SHA256 signature check. Updates `payment_orders`, `participant_events`, and `payments` tables. Triggers receipt email.

#### `POST /api/payments/recover`
Recovers abandoned payment. Finds or creates a `payment_orders` row for a participant's unpaid event registration.

#### `POST /api/payments/webhook`
Razorpay webhook handler. Validates signature, processes `payment.captured` and `payment.failed` events. Fully idempotent. Always returns 200 (to prevent Razorpay retries).

### 3.2 Admin Routes (Auth Required)

#### `GET /api/admin/registrations`
Returns all registrations with participant details, events, team members, and payment orders. Auth: `requireAdmin()`.

#### `PATCH /api/admin/registrations`
Check-in/check-out toggle. Auth: `requireAdmin()`.

#### `DELETE /api/admin/registrations`
Archive (soft delete) or permanent delete. Permanent delete requires Master Admin and calls `delete_registration_permanently()` RPC. Auth: `requireMasterAdmin()` for both archive and permanent delete.

#### `POST /api/admin/registrations`
Restore archived registration. Auth: `requireMasterAdmin()`.

#### `GET/POST/PATCH/DELETE /api/admin/events`
Full event CRUD. Auth: `requireMasterAdmin()`.

#### `GET/POST/DELETE /api/admin/admins`
Admin management. Auth: `requireMasterAdmin()`.

#### `POST /api/admin/check-in`
Check-in / check-out via scanner. Auth: `requireAdmin()`.

#### `GET /api/admin/logs`
Audit log retrieval. Auth: `requireMasterAdmin()`.

---

## 4. Database Schema

### 4.1 Core Tables

#### `participants`
```sql
id              uuid PK DEFAULT gen_random_uuid()
participant_id  text UNIQUE NOT NULL  -- SVK26-XXXXXXXX
name            text NOT NULL
college         text NOT NULL
email           text NOT NULL
phone           text NOT NULL
photo_url       text
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

#### `events`
```sql
id                uuid PK DEFAULT gen_random_uuid()
slug              text UNIQUE NOT NULL
name              text NOT NULL
category          text          -- Technical, Non-Technical, Cultural, Sports
description       text
event_date        date
start_time        time
venue             text
registration_type text NOT NULL DEFAULT 'individual'  -- CHECK: individual, team
min_team_size     integer
max_team_size     integer
registration_limit integer
registration_open boolean NOT NULL DEFAULT true
active            boolean NOT NULL DEFAULT true
registration_fee  integer NOT NULL DEFAULT 0
payment_unit      text DEFAULT 'free'  -- CHECK: per_student, per_team
payment_type      text              -- CHECK: free, paid
created_at        timestamptz DEFAULT now()
```

#### `participant_events`
```sql
id                  uuid PK DEFAULT gen_random_uuid()
participant_id      uuid NOT NULL FK → participants(id) ON DELETE CASCADE
event_id            uuid NOT NULL FK → events(id) ON DELETE RESTRICT
registration_status text NOT NULL DEFAULT 'pending'
payment_status      text NOT NULL DEFAULT 'not_required'
payment_amount      integer NOT NULL DEFAULT 0
payment_id          text
team_name           text
checked_in          boolean NOT NULL DEFAULT false
checked_in_at       timestamptz
is_archived         boolean NOT NULL DEFAULT false
created_at          timestamptz DEFAULT now()
updated_at          timestamptz DEFAULT now()
UNIQUE (participant_id, event_id)
```

#### `participant_event_members`
```sql
id                    uuid PK DEFAULT gen_random_uuid()
participant_event_id  uuid NOT NULL FK → participant_events(id) ON DELETE CASCADE
name                  text NOT NULL
email                 text
phone                 text
is_team_leader        boolean NOT NULL DEFAULT false
participant_id        uuid FK → participants(id) ON DELETE CASCADE
created_at            timestamptz DEFAULT now()
```

#### `payment_orders`
```sql
id                    uuid PK DEFAULT gen_random_uuid()
order_reference       text UNIQUE NOT NULL
payer_participant_id  uuid FK → participants(id) ON DELETE SET NULL
amount                integer NOT NULL DEFAULT 0 CHECK (>= 0)
currency              text NOT NULL DEFAULT 'INR'
gateway               text
gateway_order_id      text
gateway_payment_id    text
status                text NOT NULL DEFAULT 'pending'
receipt_email_sent_at timestamptz
receipt_email_claim_id uuid
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()
```

#### `payment_order_items`
```sql
id                          uuid PK DEFAULT gen_random_uuid()
payment_order_id            uuid NOT NULL FK → payment_orders(id) ON DELETE CASCADE
participant_id              uuid NOT NULL FK → participants(id) ON DELETE CASCADE
participant_event_id        uuid FK → participant_events(id) ON DELETE SET NULL
participant_event_member_id uuid FK → participant_event_members(id) ON DELETE SET NULL
event_id                    uuid NOT NULL FK → events(id) ON DELETE RESTRICT
amount                      integer NOT NULL DEFAULT 0 CHECK (>= 0)
created_at                  timestamptz DEFAULT now()
```

#### `payments`
```sql
id                    uuid PK DEFAULT gen_random_uuid()
participant_id        uuid NOT NULL FK → participants(id) ON DELETE CASCADE
participant_event_id  uuid FK → participant_events(id) ON DELETE SET NULL
amount                integer NOT NULL DEFAULT 0
status                text NOT NULL DEFAULT 'pending'
gateway               text
gateway_payment_id    text
gateway_order_id      text
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()
```

#### `admins`
```sql
user_id    uuid PK FK → auth.users(id) ON DELETE CASCADE
created_at timestamptz DEFAULT now()
role       text NOT NULL DEFAULT 'admin' CHECK (master, admin)
```

#### `admin_audit_logs`
```sql
id          uuid PK DEFAULT gen_random_uuid()
admin_id    uuid FK → auth.users(id)
action_type text NOT NULL
target_id   uuid NOT NULL
details     jsonb
created_at  timestamptz DEFAULT now()
```

### 4.2 Legacy Tables (Unused, Retained for History)

- `registrations` — Original single-table registration model.
- `registration_members` — Original team members model.

These are NOT used by any active code. They remain in the schema for migration continuity.

### 4.3 Database Functions (RPC)

| Function | Purpose | Security |
|---|---|---|
| `register_participant_events(...)` | Atomic registration: create/reuse participant, link events, create team members, handle payment orders | SECURITY DEFINER, service_role only |
| `create_event_registration(...)` | Single-event registration (used by RPC) | SECURITY DEFINER |
| `add_events_to_participant(...)` | Add events to existing participant | SECURITY DEFINER |
| `delete_registration_permanently(...)` | Atomic delete with audit logging | SECURITY DEFINER, service_role only |
| `is_admin()` | RLS helper — checks if current user is in admins table | Used by RLS policies |

---

## 5. Authentication Architecture

### 5.1 Client-Side

- `lib/supabase/client.ts` — `createBrowserClient()` from `@supabase/ssr`.
- Used in admin client components for auth state checks.

### 5.2 Server-Side

- `lib/supabase/server.ts` — `createServerClient()` with cookie-based session management.
- `requireAdmin()` — Validates auth user → checks `admins` table → enforces MFA for master role.
- `requireMasterAdmin()` — Calls `requireAdmin()` + checks `role === 'master'`.

### 5.3 Middleware

- `middleware.ts` uses `lib/supabase/proxy.ts` to refresh auth cookies on `/admin/*` routes.
- Ensures session tokens stay fresh without requiring full page reloads.

### 5.4 MFA

- Master admins must complete TOTP MFA verification (Google Authenticator).
- Checked via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`.
- Required level: `aal2`.

---

## 6. Payment Gateway Abstraction

### 6.1 Interface

```typescript
// lib/payments/types.ts
interface PaymentGateway {
  readonly name: string;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  getCheckoutConfig(params: {...}): CheckoutConfig;
  validateWebhook(params: {...}): WebhookValidationResult;
}
```

### 6.2 Factory

```typescript
// lib/payments/index.ts
function getPaymentGateway(gatewayName?: string): PaymentGateway
// Reads PAYMENT_GATEWAY env var, defaults to 'razorpay'
```

### 6.3 Razorpay Implementation

- Key resolution precedence: `RAZORPAY_KEY_ID?.trim()` -> `NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim()`.
- Server-only secrets: `RAZORPAY_KEY_SECRET` (never exposed via `NEXT_PUBLIC_*`).
- Direct REST API calls via `fetch` (no SDK).
- Checkout overlay loaded via CDN: `https://checkout.razorpay.com/v1/checkout.js`.
- Payment verification: HMAC-SHA256 of `{order_id}|{payment_id}` with API key secret using `crypto.timingSafeEqual`.
- Webhook validation: HMAC-SHA256 of raw body with webhook secret.

### 6.4 Secure Payment Resume Link (Phase 2C)

- **Stateless HMAC-SHA256 Token**: Generated server-side using `PAYMENT_RESUME_TOKEN_SECRET` (with `SUPABASE_SECRET_KEY` fallback).
- **Format**: `base64url(payload).base64url(signature)`.
- **Payload**: `paymentOrderId`, `participantId`, `payerParticipantUuid`, `iat`, `exp`, `nonce`.
- **Lifetime**: 24-hour expiration (`exp`), verified with `timingSafeEqual`.
- **Server Verification**: `GET /api/payments/resume?token=...` cryptographically authenticates token, verifies `payment_orders.payer_participant_id === payerParticipantUuid`, checks `status === 'pending'`, and loads authoritative line items from `payment_order_items`.
- **Zero DB Clutter**: Operates entirely stateless without creating token records in PostgreSQL.

---

## 7. Email System

### 7.1 Provider

Resend SDK (`resend` npm package). Direct API calls, no HTTP self-fetch.

### 7.2 QR Code Embedding

- QR generated as PNG buffer using `qrcode` library.
- Attached as CID inline attachment (`contentId: "saviskar-entry-qr"`).
- Referenced in HTML as `cid:saviskar-entry-qr`.
- Fallback: text-based participant ID if QR generation fails.

### 7.3 PDF Receipt

- Generated using `pdf-lib` (no external fonts).
- Uses Helvetica / Helvetica-Bold (WinAnsi encoding).
- Currency displayed as `INR` (not ₹ symbol — unsupported by WinAnsi).
- Attached to payment confirmation email as `application/pdf`.

---

## 8. Indexes

| Table | Index | Columns |
|---|---|---|
| participant_events | idx_participant_events_event | event_id |
| participant_events | idx_participant_events_participant | participant_id |
| participant_events | idx_participant_events_payment | payment_status |
| participant_events | idx_participant_events_is_archived | is_archived |
| participants | idx_participants_email | email |
| participants | idx_participants_participant_id | participant_id |
| participants | idx_participants_phone | phone |
| payments | idx_payments_event_registration | participant_event_id |
| payments | idx_payments_participant | participant_id |
| payment_orders | payment_orders_payer_participant_id_idx | payer_participant_id |
| payment_orders | payment_orders_status_idx | status |
| payment_orders | payment_orders_gateway_order_id_idx | gateway_order_id |
| payment_order_items | payment_order_items_payment_order_id_idx | payment_order_id |
| payment_order_items | payment_order_items_participant_id_idx | participant_id |
| payment_order_items | payment_order_items_participant_event_id_idx | participant_event_id |
| payment_order_items | payment_order_items_member_id_idx | participant_event_member_id |

---

## 9. Row Level Security (RLS)

- `admin_audit_logs`: RLS enabled. Only master admins can SELECT.
- `events`: RLS policies for admin CRUD via `is_admin()`.
- `registrations` (legacy): RLS policies via `is_admin()`.
- `registration_members` (legacy): RLS policies via `is_admin()`.
- Active tables (`participants`, `participant_events`, etc.): Accessed via service_role client (bypasses RLS).

---

## 10. Error Handling Patterns

- All admin API routes use try-catch at the handler level.
- Non-fatal errors (e.g., payment record insert fails after order marked paid) are logged but don't block the response.
- Webhook handler always returns HTTP 200 to prevent Razorpay retries.
- Email sending failures don't fail the registration flow — they release the claim for retry.
- Registration email errors don't block the registration response.

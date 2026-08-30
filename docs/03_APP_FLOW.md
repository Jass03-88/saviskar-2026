# Saviskar 2026 — Application Flow

---

## 1. Registration Flow (Participant Perspective)

### Step 1: Entry
- User visits the public landing page.
- Clicks "Register Now" or selects a specific event card.
- Navigates to `/register`.

### Step 2: Identity Selection
- User chooses between "New Registration" and "Returning Participant".
- **New**: Enters Name, College, Email, Phone.
- **Returning**: Enters `SVK26-XXXXXXXX` ID and associated email.
  - Form calls `GET /api/participants/[participantId]`.
  - Auto-fills details and filters out already-registered events.

### Step 3: Event Selection
- User selects up to 20 events.
- If an event is a "Team" event, UI prompts for team name and team member details (name, email, phone).
  - Validation ensures `min_team_size` and `max_team_size` are met.

### Step 4: Submission
- User clicks "Register & Pay" (or "Register" if all events are free).
- Form calls `POST /api/register`.
  - Backend executes atomic `register_participant_events` RPC.
  - Assigns participant IDs to all new members.
  - Links participants to events.
  - If paid events exist, generates a `payment_orders` row.
  - Sends immediate Registration Confirmation Email (QR code).

### Step 5: Payment (If applicable)
- Registration API returns `{ requiresPayment: true, paymentOrderId: '...' }`.
- Frontend calls `POST /api/payments/create` to generate a Razorpay order ID.
- Razorpay Checkout overlay opens.
- User completes payment (card, UPI, etc.).
- Razorpay returns `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }`.
- Frontend calls `POST /api/payments/verify`.
  - Backend verifies HMAC-SHA256 signature and captured status.
  - Marks payment as `paid`.
  - Triggers Receipt PDF generation and Payment Confirmation Email.
- Overlay closes, user sees success screen.

### Step 5.1: Payment Resume via Email (Phase 2C)
- If checkout is closed or pending, the Registration Confirmation / Payment Pending email contains a secure **[ COMPLETE PAYMENT ]** button.
- Clicking the button opens `/payment/resume?token=<HMAC_SIGNED_TOKEN>`.
- Server validates the 24-hour token, authenticates payer ownership, and loads event line items directly from database `payment_orders`.
- User clicks "Complete Payment", opens Razorpay checkout, verifies payment server-side, and receives confirmation + PDF receipt.

---

## 2. Admin Check-In Flow

### Step 1: Dashboard Access
- Staff member visits `/admin/scanner` on their phone/tablet.
- Authenticates (Normal Admin or Master Admin).

### Step 2: Scanning
- Staff points camera at participant's QR code (from their email).
- QR decodes to a Participant ID (`SVK26-XXXXXXXX`).
- Scanner UI fetches participant's registered events.

### Step 3: Check-In
- Staff sees a list of the participant's events.
- Green checks for paid, Red warnings for pending payments.
- Staff taps the specific event to check in.
- UI calls `PATCH /api/admin/registrations` with `checkedIn: true`.
- Participant is checked in.

---

## 3. Event Management Flow (Master Admin)

### Step 1: View Events
- Master Admin visits `/admin/events`.
- Sees list of all events with registration counts.

### Step 2: Create / Edit Event
- Admin clicks "New Event" or selects an existing event.
- Enters details (name, category, fee, team sizes, etc.).
- Clicks "Save".
- UI calls `POST /api/admin/events` (create) or `PATCH /api/admin/events` (update).
- Database is updated.

### Step 3: Delete / Deactivate Event
- Admin clicks "Delete" on an event.
- If event has registrations: Backend rejects the deletion. Admin must toggle "Active" instead.
- If event has no registrations: UI calls `DELETE /api/admin/events`, removing it entirely.

---

## 4. Admin Management Flow (Master Admin)

### Step 1: View Admins
- Master Admin visits `/admin/admins`.
- Sees list of current admins and their roles.

### Step 2: Invite Admin
- Admin enters an email address and selects a role (Master or Normal).
- UI calls `POST /api/admin/admins`.
- **If new user**: Supabase creates user and sends invite email.
- **If existing user**: Supabase adds role and sends password reset email.
- User receives email, clicks link, lands on `/admin/reset-password`.
- User sets password, logs in, accesses dashboard.

### Step 3: Remove Admin
- Master Admin clicks "Remove" on a Normal Admin.
- UI calls `DELETE /api/admin/admins`.
- User's admin role is removed from the `admins` table (Auth account remains).

---

## 5. Audit & Archival Flow (Master Admin)

### Step 1: Archive Registration
- Master Admin visits `/admin`.
- Clicks "Archive" on a junk registration.
- UI calls `DELETE /api/admin/registrations` (without `permanent` flag).
- `is_archived` is set to true. Registration disappears from main list.

### Step 2: Permanent Deletion (Master Admin Only)
- Master Admin goes to Archive view.
- Clicks "Permanently Delete".
- UI confirms intent.
- UI calls `DELETE /api/admin/registrations?permanent=true`.
- Backend executes `delete_registration_permanently` RPC.
  - Validates Master Admin status.
  - Inserts record into `admin_audit_logs`.
  - Deletes `participant_events`, `participant_event_members`, `payment_order_items`, and orphaned `payment_orders`.
- Registration is permanently erased.

### Step 3: View Logs
- Master Admin visits `/admin/logs`.
- UI calls `GET /api/admin/logs`.
- Displays chronologically ordered table of all sensitive administrative actions (who deleted what, when).

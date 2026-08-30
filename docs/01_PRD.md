# Saviskar 2026 — Product Requirements Document (PRD)

---

## 1. Product Overview

Saviskar 2026 is a web-based event registration and management platform for an inter-college fest. It allows participants to browse events, register individually or as teams, pay online, and receive confirmation emails with QR-coded entry passes. Administrators manage events, registrations, payments, and on-site check-ins.

---

## 2. Goals

1. Enable seamless multi-event registration for college students.
2. Support both free and paid events with online payment.
3. Provide permanent participant identity across all registrations.
4. Give administrators full visibility into registrations, payments, and attendance.
5. Ensure payment integrity through server-side verification.
6. Generate professional payment receipts for paid events.

---

## 3. Users and Roles

| Role | Description |
|---|---|
| **Participant** | College student browsing events and registering. No login required. |
| **Normal Admin** | Staff member who can view registrations and perform check-ins. |
| **Master Admin** | Full-privilege administrator who can manage events, manage admins, permanently delete registrations, and view audit logs. Requires TOTP MFA. |

---

## 4. Registration Requirements

### 4.1 Participant Registration

- First-time participants provide: name, college, email, phone number.
- The system generates a permanent **Participant ID** (format: `SVK26-XXXXXXXX`).
- Returning participants can enter their Participant ID + email to register for additional events.
- A participant can register for up to 20 events in a single request.
- Duplicate registrations for the same event are prevented.

### 4.2 Team Registration

- Events may be configured as `team` registration type.
- Team registration requires a team name and team members.
- Each team member receives their own Participant ID.
- Events enforce `min_team_size` and `max_team_size` constraints.
- All team members receive individual confirmation emails.

### 4.3 Free Events

- Registration is immediate with no payment flow.
- Confirmation email with QR code is sent.
- Payment status: `not_required`.

### 4.4 Paid Events

- Registration creates a pending payment order.
- Participant is directed to Razorpay checkout.
- Payment is verified server-side (signature verification).
- Upon successful payment: status → `paid`, receipt PDF generated, receipt email sent.
- Payment status: `pending` → `paid`.

---

## 5. Event Requirements

- Events have: name, slug, category, description, date, time, venue.
- Categories: Technical, Non-Technical, Cultural, Sports.
- Registration type: `individual` or `team`.
- Payment type: `free` or `paid`.
- Payment unit: `per_student`, `per_team`, `free`.
- Events can be activated/deactivated and registration opened/closed independently.
- Events with existing registrations cannot be deleted (must deactivate instead).
- Only Master Admin can create, edit, or delete events.

---

## 6. Payment Requirements

- Gateway-agnostic architecture (current implementation: Razorpay).
- Payment amount is determined server-side from event configuration, not from client input.
- Payment orders track: order reference, amount, currency, gateway details, status.
- Payment order items link orders to specific participant-event registrations.
- Payment recovery: participants with pending payments can resume/complete payment.
- Payment verification: HMAC-SHA256 signature check (server-side only).
- Webhook handler for backup verification (Razorpay `payment.captured` / `payment.failed`).
- Idempotent processing: duplicate payment events are handled safely.

---

## 7. Email Requirements

### 7.1 Registration Confirmation Email

- Sent immediately after registration (both free and paid).
- Contains: event name, participant details, QR code, team member list (if team event).
- For paid events: indicates "Payment: Pending".
- For free events: indicates "Payment: No payment required."
- Subject: `You're Registered — Saviskar 2026 | {participantId}`

### 7.2 Payment Confirmation Email

- Sent only after successful verified payment.
- Contains: payment confirmation message, PDF receipt attachment.
- Subject: `Payment Confirmed — Saviskar 2026 | Receipt {participantId}`
- Uses atomic claim mechanism to prevent duplicate sends.

---

## 8. QR Code Requirements

- QR encodes only the permanent Participant ID.
- No payment IDs, secrets, or PII in QR content.
- QR is rendered as a CID inline image attachment in emails (not base64 data URI).
- Used for on-site check-in scanning.

---

## 9. Admin Requirements

### 9.1 Dashboard

- View event analytics (total registrations, checked-in count, pending payments).
- Filter by event, payment type (paid/free), category.
- Payment indicators: Green (Paid + amount), Red (Pending + amount), White (Free).

### 9.2 Registration Management

- View all registrations with participant details, payment status, team info.
- Check-in / check-out participants.
- Archive registrations (Master Admin only, non-destructive, reversible).
- Restore archived registrations (Master Admin).
- Permanently delete registrations (Master Admin only, with confirmation).

### 9.3 Event Management (Master Admin Only)

- Create, edit, delete events.
- Toggle registration open/closed and active/inactive.
- View registration counts per event.

### 9.4 Admin Management (Master Admin Only)

- Invite new administrators (Normal Admin or Master Admin).
- Remove Normal Admin access.
- Master Admin limit: maximum 2.
- Master Admins cannot be removed via the control panel.

### 9.5 Audit Logs (Master Admin Only)

- View audit trail of sensitive administrative actions.
- Logged actions: ARCHIVE_REGISTRATION, RESTORE_REGISTRATION, DELETE_REGISTRATION.
- Each log includes: admin ID, action type, target ID, details, timestamp.
- Audit logs are never deleted when registrations are deleted.

### 9.6 QR Scanner

- Admin page with QR code scanner for on-site check-in.

---

## 10. Archive vs Delete

| Operation | Behavior | Who Can Do It |
|---|---|---|
| **Archive** | Sets `is_archived = true`. Registration stays in database. Excluded from active counts. | Master Admin only |
| **Restore** | Sets `is_archived = false`. Registration returns to active state. | Master Admin |
| **Permanent Delete** | Removes registration, linked payment order items, orphaned payment orders. Preserves participant record. Audit logged atomically. | Master Admin only |

---

## 11. Security / Product Constraints

1. Payment secrets never exposed to the client.
2. Payment amounts never trusted from the browser.
3. Admin role restrictions enforced server-side (not just UI hiding).
4. Master Admin requires TOTP MFA (AAL2).
5. Rate limiting on registration endpoint (8 requests/minute per IP).
6. Request size limiting (48KB max).
7. Public participant lookup exposes only limited fields.

---

## 12. Acceptance Criteria

1. New participant can register for free and paid events.
2. Returning participant can register using their Participant ID.
3. Team registration creates Participant IDs for all members.
4. Paid registration triggers Razorpay checkout and server-side verification.
5. Registration confirmation email arrives with functional QR code.
6. Payment receipt email arrives with PDF attachment after successful payment.
7. Duplicate receipt emails are prevented by atomic claim mechanism.
8. Admin can view, filter, and check-in registrations.
9. Master Admin can archive and restore registrations.
10. Master Admin can permanently delete with audit trail.
11. Normal Admin cannot access Master Admin functions.
12. Abandoned payments can be recovered.

---

## 13. Out of Scope

- User login / registration accounts for participants (no auth required to register).
- Refund processing through the application.
- Multi-currency support (INR only).
- Ticket pricing tiers (single fee per event).
- Event scheduling/calendar integration.
- Bulk email campaigns.
- Attendance reporting / analytics export.

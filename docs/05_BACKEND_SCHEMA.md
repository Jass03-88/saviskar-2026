# Saviskar 2026 — Backend Schema Reference

---

## 1. Overview

The backend uses PostgreSQL hosted on Supabase.
All business logic enforces relationships using foreign keys.
Critical registration logic is wrapped in a `SECURITY DEFINER` RPC function (`register_participant_events`) to guarantee atomicity.

---

## 2. Core Tables

### 2.1 `participants`
The source of truth for a person's identity. This table is **never** deleted, even if their registrations are.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, Default gen_random_uuid() | Internal identifier |
| `participant_id` | `text` | UNIQUE, NOT NULL | Public ID (`SVK26-XXXXXXXX`) |
| `name` | `text` | NOT NULL | Full name |
| `college` | `text` | NOT NULL | College/University name |
| `email` | `text` | NOT NULL | Email address |
| `phone` | `text` | NOT NULL | Phone number |
| `photo_url` | `text` | nullable | Optional avatar URL |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |

### 2.2 `events`
The catalog of available events.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, Default gen_random_uuid() | |
| `slug` | `text` | UNIQUE, NOT NULL | URL-friendly identifier |
| `name` | `text` | NOT NULL | Display name |
| `category` | `text` | nullable | E.g. Technical, Cultural |
| `registration_type` | `text` | DEFAULT 'individual', CHECK | `individual` or `team` |
| `min_team_size` | `integer` | nullable | Required if team |
| `max_team_size` | `integer` | nullable | Required if team |
| `registration_open` | `boolean`| DEFAULT true | Are new signups allowed? |
| `active` | `boolean` | DEFAULT true | Is event visible? |
| `registration_fee` | `integer` | DEFAULT 0 | Fee in INR |
| `payment_unit` | `text` | DEFAULT 'free', CHECK | `free`, `per_student`, `per_team` |
| `payment_type` | `text` | CHECK | `free`, `paid` |

### 2.3 `participant_events`
The junction table linking a Participant to an Event. This represents a "Registration".

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, Default gen_random_uuid() | |
| `participant_id` | `uuid` | NOT NULL, FK to participants (CASCADE) | The registering user |
| `event_id` | `uuid` | NOT NULL, FK to events (RESTRICT) | The event |
| `registration_status`| `text` | DEFAULT 'pending' | Current status |
| `payment_status` | `text` | DEFAULT 'not_required' | `paid`, `pending`, `not_required` |
| `payment_amount` | `integer` | DEFAULT 0 | Amount owed/paid |
| `payment_id` | `text` | nullable | Gateway payment ID |
| `team_name` | `text` | nullable | Only for team events |
| `checked_in` | `boolean`| DEFAULT false | Attendance tracking |
| `checked_in_at` | `timestamptz` | nullable | Attendance timestamp |
| `is_archived` | `boolean`| DEFAULT false | Soft-delete flag |
| *(UNIQUE)* | | `(participant_id, event_id)` | Prevents duplicate registrations |

### 2.4 `participant_event_members`
Stores team members for a team registration.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, Default gen_random_uuid() | |
| `participant_event_id`| `uuid` | NOT NULL, FK to participant_events (CASCADE) | The parent registration |
| `name` | `text` | NOT NULL | Member name |
| `email` | `text` | nullable | Member email |
| `phone` | `text` | nullable | Member phone |
| `is_team_leader` | `boolean`| DEFAULT false | True for the person who registered |
| `participant_id` | `uuid` | FK to participants (CASCADE) | Links member to their own global ID |

---

## 3. Payment Tables

### 3.1 `payment_orders`
Represents a single checkout intent (e.g. adding 3 paid events to cart).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, Default gen_random_uuid() | |
| `order_reference` | `text` | UNIQUE, NOT NULL | Internal reference |
| `payer_participant_id`| `uuid` | FK to participants (SET NULL) | The person paying |
| `amount` | `integer` | NOT NULL, DEFAULT 0 | Total checkout amount |
| `gateway` | `text` | nullable | e.g. `razorpay` |
| `gateway_order_id` | `text` | nullable | Gateway's order ID |
| `gateway_payment_id` | `text` | nullable | Gateway's successful payment ID |
| `status` | `text` | DEFAULT 'pending' | `pending`, `paid`, `failed` |
| `receipt_email_sent_at`|`timestamptz`| nullable | Delivery timestamp |
| `receipt_email_claim_id`|`uuid` | nullable | Concurrency lock for email sender |
| `receipt_email_claimed_at`|`timestamptz`| nullable | Timestamp when claim was locked (stale after 10m) |

### 3.2 `payment_order_items`
Links a `payment_order` to specific `participant_events`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `payment_order_id` | `uuid` | NOT NULL, FK to payment_orders (CASCADE) | Parent order |
| `participant_id` | `uuid` | NOT NULL, FK to participants (CASCADE) | The student |
| `participant_event_id`| `uuid` | FK to participant_events (SET NULL) | The registration |
| `event_id` | `uuid` | NOT NULL, FK to events (RESTRICT) | The event |
| `amount` | `integer` | NOT NULL | Line item cost |

### 3.3 `payments`
Immutable record of a successful payment. Created by the verification webhook/API.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `participant_id` | `uuid` | NOT NULL, FK to participants (CASCADE)| |
| `participant_event_id`| `uuid` | FK to participant_events (SET NULL)| Primary linked event |
| `amount` | `integer` | NOT NULL | |
| `status` | `text` | NOT NULL | `paid` |
| `gateway_payment_id` | `text` | nullable | Gateway ID |

---

## 4. Admin & Security Tables

### 4.1 `admins`
Maps Supabase Auth users to Saviskar Admin roles.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | `uuid` | PK, FK to auth.users (CASCADE) | Auth user ID |
| `role` | `text` | DEFAULT 'admin', CHECK (master, admin) | Admin privilege level |

### 4.2 `admin_audit_logs`
Immutable audit trail for destructive actions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `admin_id` | `uuid` | FK to auth.users | Who performed the action |
| `action_type` | `text` | NOT NULL | e.g. `DELETE_REGISTRATION` |
| `target_id` | `uuid` | NOT NULL | UUID of affected record |
| `details` | `jsonb` | nullable | Snapshotted metadata |
| `created_at` | `timestamptz`| DEFAULT now() | |

---

## 5. Key Stored Procedures (RPC)

### `register_participant_events`
**Arguments:** `p_participant` (JSON), `p_events` (JSON array)
**Behavior:**
1. Looks up or creates a `participants` record (generating `SVK26-XXXXXXXX` ID).
2. Iterates over `p_events`. Row-locks event records (`FOR UPDATE`), validates capacity (`registration_limit`) against active registrations, validates active/open state.
3. Inserts into `participant_events`.
4. If it's a team event, inserts members into `participants` (generating IDs) and `participant_event_members`.
5. If total fee > 0, generates a `payment_orders` row and `payment_order_items`.
6. Returns the global Participant ID and the event registrations.
**Security:** `SECURITY DEFINER` (runs as superuser, bypassing RLS; anon/authenticated grants revoked).

### `delete_registration_permanently`
**Arguments:** `p_participant_event_id` (UUID), `p_admin_id` (UUID)
**Behavior:**
1. Validates that `p_admin_id` has `master` role.
2. Snapshots registration data.
3. Inserts into `admin_audit_logs`.
4. Deletes `participant_event_members`.
5. For unpaid/test orders (`status <> 'paid'`), cleans up `payment_order_items` and removes empty uncompleted `payment_orders`.
6. For paid orders (`status = 'paid'`), preserves `payment_orders` and line items (decouples `participant_event_id = NULL`).
7. Deletes `participant_events`.
8. Preserves `participants` row.
**Security:** `SECURITY DEFINER`.

---

## 6. Migration Chain

1. `20260818112137_remote_schema.sql` (Base schema)
2. `20260819141205_multi_payment_system.sql` (Payment orders abstraction)
3. `20260819181140_add_is_archived_to_participant_events.sql` (Soft-delete flag)
4. `20260821121727_atomic_delete_audit_log.sql` (Permanent delete + audit)
5. `20260821235000_add_receipt_email_sent_at.sql` (Email idempotency)
6. `20260830060000_p0_security_hardening.sql` (RPC revocation + RLS on payment tables)
7. `20260830120000_p1_reliability_and_limits.sql` (Receipt claim recovery, registration limits, and atomic payment orders)
8. `20260830180000_p1_data_integrity_and_safety.sql` (Email uniqueness, ID collision retry, paid delete safety, structured SVK error codes)

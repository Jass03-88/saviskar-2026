# STANDARD OPERATING PROCEDURE (SOP)
## Resolution of Late Payment Settlement Conflicts for Accommodations

**Document Reference**: `SOP-SAV-2026-ACC-001`  
**Target Audience**: Festival Administrators, Accommodation Desk Staff, Finance & Accounts Team  
**System Scope**: Saviskar 2026 Management Portal (`/admin/accommodations` & `/admin/logs`)  

---

## 1. PURPOSE & CRITICAL SYSTEM PRINCIPLE

During peak registration, a participant may complete payment for accommodation at the PayU gateway, but by the time the gateway callback arrives at the Saviskar server, their requested dates have already been booked by another participant or manually assigned.

To prevent room over-allocation, double-booking, and database corruption:
1. **The system automatically leaves the conflicting accommodation in `cancelled` status.**
2. **The payment order is recorded as `paid`, and the financial payment receipt is captured in `public.payments`.**
3. **An immutable audit log is generated with action `ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT`.**

> [!IMPORTANT]
> **NO AUTOMATED REFUND OR AUTOMATIC ROOM REASSIGNMENT IS PERFORMED BY THE CODE.**  
> - The system does NOT automatically resolve payment conflicts.
> - The application does NOT provide automated refunds.
> - The database enforces strict physical exclusion constraints. The participant has paid money, but does **NOT** have a confirmed room for the disputed dates.
> - Staff must not consider a conflict resolved until the actual outcome has been independently confirmed. Authorized staff must resolve this case manually following this SOP.

---

## 2. HOW TO IDENTIFY PAID ACCOMMODATION CONFLICTS

Authorized staff can locate unresolved conflicts through two administrative screens:

### Method A: Accommodation Exceptions Dashboard (Recommended)
1. Log in to the Saviskar Admin Portal with **Accommodation Access** or as **Master Admin**.
2. Navigate to **Accommodation Dashboard** (`/admin/accommodations`).
3. Click on the **Exceptions** tab.
4. The **Payment Settlement Overlap Conflicts** banner will list all orders where payment was captured on PayU but accommodation dates could not be reserved.
5. Each row details:
   - Participant Name and Permanent ID (`SVK26-XXXX`)
   - Participant Email and Phone
   - Payment Order Reference (`SVK-ORD-...`) and Amount Paid (e.g., ₹600, ₹1200)
   - Requested Stay Dates and Plan Name
   - Conflict Timestamp
   - Current Resolution Status:
     - `REQUIRES MANUAL VERIFICATION`: Unconditional status for all conflict records. Payment was captured, but the requested stay is unconfirmed. Requires staff verification of a PayU refund or alternate room allocation.
   - Specific Guidance Notes and Existing Booking details (if present).
   - **Critical Principle**: An existing separate booking for the participant is supplemental information only; it is **NOT** proof that the disputed dates were fulfilled or that the conflict was resolved.

### Method B: Audit Logs Screen
1. Log in as a **Master Admin** (MFA required).
2. Navigate to **Audit Logs** (`/admin/logs`).
3. Click the filter pill **Payment Conflicts**.
4. Records with `ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT` will be isolated, displaying the accommodation ID, payment order ID, and transaction timestamps.

---

## 3. VERIFICATION PROCEDURE

Before taking any action or contacting the participant, staff must verify the record:

1. **Verify Gateway Transaction**:
   - Locate the `orderReference` from the conflict row.
   - Cross-reference with the PayU Merchant Dashboard using the payment order reference or gateway payment ID.
   - Confirm that the status is **SUCCESS** and verify the net amount captured.
2. **Verify Participant Profile**:
   - Check the participant's registrations in `/admin` (Registrations table).
   - Confirm whether their competition registrations succeeded (event passes remain valid even if accommodation conflicted).
3. **Verify Current Accommodation Status**:
   - Inspect the participant's record in `/admin/accommodations`.
   - Confirm that the requested date range shows no active room assigned.

---

## 4. CONTACTING THE PARTICIPANT

1. Use only the verified contact information (`phone` or `email`) from the participant's official profile.
2. **Mandatory Communication Guidelines**:
   - **DO NOT** claim that a refund has already been sent.
   - **DO NOT** promise a room before verifying current physical capacity in `/admin/accommodations` Overview.
   - Explain politely:  
     *"Your competition registration for Saviskar 2026 is confirmed. However, during your payment session, the selected accommodation dates became fully booked. We have received your payment of ₹[AMOUNT] and are reaching out to offer you an alternative stay date or initiate a full refund for the accommodation portion."*

---

## 5. RESOLUTION PATHS

Authorized personnel must choose exactly ONE of the two paths below:

### Option 1: Alternate Room Allocation (If Capacity Exists)
1. Check the **Hostel Operations** and **Room Inventory** in `/admin/accommodations`.
2. If non-conflicting dates or an available room are agreed upon with the participant:
   - Authorized Accommodation Staff uses the room allocation tool in `/admin/accommodations` to allocate an available room to the participant's confirmed alternate stay.
   - Staff must independently verify that the newly allocated dates match the participant's agreed festival schedule.

### Option 2: Gateway Refund via PayU Merchant Dashboard
1. If the participant declines alternative dates or the hostel is at 100% capacity:
   - Escalate to the **Designated Finance Officer** (`TO BE CONFIRMED BY SAVISKAR ADMINISTRATION`).
   - The Finance Officer logs into the official **PayU Merchant Dashboard**.
   - Initiates a refund for the exact accommodation amount using the gateway payment transaction reference.
   - Note: Refund completion must be verified using the approved PayU financial process. The refund takes 5–7 banking days to reflect in the participant's original payment method per PayU banking SLAs.

> [!CAUTION]
> **DUPLICATE REFUND PROTECTION**:  
> Always check the PayU Merchant Dashboard history before clicking "Refund". Never process a refund via cash, UPI, or external channels unless explicitly authorized in writing by the Saviskar Finance Director.

---

## 6. RECORDING RESOLUTION & AUDIT TRAIL

1. **System Boundary**: The database does NOT automatically detect external gateway refunds or mutate payment order statuses. The application does not provide automated refunds.
2. **Independent Confirmation**: Staff must not consider a conflict resolved until the actual outcome (gateway refund settlement or alternative room assignment) has been independently confirmed.
3. Ensure the resolution (refund transaction ID or alternate room allocation) is logged in the operational incident tracker (`TO BE CONFIRMED BY SAVISKAR ADMINISTRATION`).
4. If an alternate stay was allocated, staff can verify the allocated room directly in the `/admin/accommodations` table under the participant's profile.
5. If refunded via PayU, maintain the PayU Refund Reference ID for banking reconciliation and records.

---

## 7. AMBIGUOUS CASES & ESCALATION

If any of the following occur:
- Payment is marked "pending" or "failed" on PayU, but participant claims money was debited:  
  *Instruct participant to wait 2 hours for automated banking settlement or submit bank statement screenshot to Saviskar Helpdesk.*
- Gateway transaction ID cannot be located on the PayU portal:  
  *Escalate immediately to the Technical Lead and Finance Officer.*
- System cannot record resolution or database throws an error:  
  *Contact the Technical Administrator (`jashan082006@gmail.com` / `mvashisht911@gmail.com`).*

---

**Approved by**: Saviskar 2026 Organizing Committee  
**Operational Status**: ACTIVE

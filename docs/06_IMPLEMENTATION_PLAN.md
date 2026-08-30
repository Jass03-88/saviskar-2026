# Saviskar 2026 — Implementation Plan (For Future Development)

---

## 1. Goal

The current goal (creation of the documentation set) is complete. The system is fundamentally stable and operational.

This document serves as a **hand-over plan** for any future AI or developer tasked with maintaining, extending, or deploying the Saviskar 2026 application.

> [!WARNING]
> Do **NOT** redesign the core architecture described here. The current model (permanent participant IDs, server-side payment verification, atomic audit-logged deletions) has been thoroughly tested and handles edge cases effectively.

---

## 2. Current State of the Application

The application is **feature-complete** for core event registration. 
- The Supabase backend is correctly migrated and functional.
- The Razorpay integration is functional in test mode.
- The Resend email integration (QR codes and PDFs) is functional.
- The Admin dashboard correctly segregates Master and Normal admins.

---

## 3. Deployment Checklist for Production

Before launching the event to actual students, the following steps must be completed.

### 3.1 Payment Gateway
- [ ] Change `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env.local` from Test credentials to Live credentials.
- [ ] Update `NEXT_PUBLIC_RAZORPAY_KEY_ID` with the Live key ID.
- [ ] Configure the Razorpay Webhook in the Razorpay Dashboard (Events: `payment.captured`, `payment.failed`).
- [ ] Set `RAZORPAY_WEBHOOK_SECRET` in the production environment.

### 3.2 Domain & Email
- [ ] Finalize the production domain on Vercel.
- [ ] Ensure `NEXT_PUBLIC_SITE_URL` in production is set to the final domain (e.g., `https://saviskar.com`).
- [ ] Ensure `RESEND_FROM_EMAIL` is verified in the Resend dashboard (DNS records configured for the sending domain).

### 3.3 Supabase Configuration
- [ ] Ensure `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_URL` point to the production project.
- [ ] Ensure Supabase Auth settings allow the production domain in the Redirect URLs.
- [ ] Ensure MFA is enforced at the project level for Master Admin accounts.

---

## 4. Guidelines for Future Feature Development

If new features are requested, adhere to the following architectural rules:

### 4.1 Database Modifications
- **Rule**: NEVER modify tables directly via the Supabase UI.
- **Action**: Always create a new sequential migration file in `supabase/migrations/` (e.g., `2026XXXXXXXXXX_feature_name.sql`).
- **Safety**: Do not use `DROP TABLE` or `DROP COLUMN` on active tables (`participants`, `participant_events`, `payment_orders`). Use `is_archived` flags or similar non-destructive patterns.

### 4.2 New API Routes
- **Rule**: All state-modifying actions must happen on the server.
- **Action**: Place logic in `app/api/...`.
- **Security**: For admin routes, always import and await `requireAdmin()` or `requireMasterAdmin()` from `lib/supabase/server.ts` before reading request bodies or interacting with the database.

### 4.3 Payment Integrations
- **Rule**: Keep the gateway abstraction intact.
- **Action**: If adding a new provider (e.g., Stripe, Cashfree), create a new class implementing the `PaymentGateway` interface in `lib/payments/types.ts`. Do NOT scatter gateway-specific logic in the route handlers.
- **Idempotency**: Always assume webhooks and client-side verifications can race or duplicate. Rely on the atomic claim logic (`ensurePaymentConfirmationSent`) for side effects like emails.

### 4.4 UI Changes
- **Rule**: Maintain the premium dark-mode aesthetic.
- **Action**: Use Tailwind classes. Stick to the established color palette (deep blacks, grays, glowing accents). Ensure mobile responsiveness (test on `sm:` breakpoints). Keep framer-motion animations subtle.

---

## 5. Potential Future Enhancements (Backlog)

If time permits, these are low-risk enhancements that could add value:

1. **Excel/CSV Export**: Add a Master Admin feature to export registrations from `/api/admin/registrations` into a CSV file.
2. **Bulk Communications**: Add an admin tool to send updates (via Resend) to all participants registered for a specific event.
3. **On-site Registration Mode**: Create a specialized admin view optimized for volunteers registering walk-in students quickly (bypassing email verification loops if any are added).
4. **Enhanced Analytics**: Add charts (using e.g., Recharts) to the Admin Dashboard showing registration velocity over time.

---

## 6. Verification Plan

When the hand-off is complete or before any major deployment, verify the build:

### Automated Tests
- Run `npm run build` to ensure Next.js compiles successfully with zero TypeScript errors.

### Manual Verification
- Deploy to Vercel (Staging environment).
- Perform a complete test registration (Free event). Check email delivery and QR rendering.
- Perform a complete test registration (Paid event). Complete Razorpay test flow. Check PDF receipt delivery.
- Log in as Master Admin. Verify event creation, audit logs, and MFA prompt.
- Log in as Normal Admin. Verify lack of access to Master features, and test the check-in toggle.

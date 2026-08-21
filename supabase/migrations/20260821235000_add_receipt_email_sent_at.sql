-- Add idempotency tracking for payment receipt emails
ALTER TABLE public.payment_orders
ADD COLUMN receipt_email_sent_at timestamp with time zone DEFAULT NULL,
ADD COLUMN receipt_email_claim_id uuid DEFAULT NULL;

-- ============================================================
-- SAVISKAR 2026
-- MULTI-EVENT / TEAM PAYMENT SYSTEM
-- ============================================================

-- One checkout/payment attempt.
CREATE TABLE IF NOT EXISTS public.payment_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_reference text NOT NULL,
    payer_participant_id uuid,
    amount integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'INR',

    -- Gateway abstraction
    gateway text,
    gateway_order_id text,
    gateway_payment_id text,

    status text NOT NULL DEFAULT 'pending',

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT payment_orders_pkey PRIMARY KEY (id),
    CONSTRAINT payment_orders_order_reference_key UNIQUE (order_reference),
    CONSTRAINT payment_orders_amount_check CHECK (amount >= 0)
);

-- Every event/member being paid for inside the checkout.
CREATE TABLE IF NOT EXISTS public.payment_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_order_id uuid NOT NULL,

    participant_id uuid NOT NULL,
    participant_event_id uuid,

    -- For team registrations this identifies the actual member.
    participant_event_member_id uuid,

    event_id uuid NOT NULL,

    amount integer NOT NULL DEFAULT 0,

    created_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT payment_order_items_pkey PRIMARY KEY (id),
    CONSTRAINT payment_order_items_amount_check CHECK (amount >= 0)
);

-- ============================================================
-- FOREIGN KEYS
-- ============================================================

ALTER TABLE ONLY public.payment_orders
    ADD CONSTRAINT payment_orders_payer_participant_id_fkey
    FOREIGN KEY (payer_participant_id)
    REFERENCES public.participants(id)
    ON DELETE SET NULL;

ALTER TABLE ONLY public.payment_order_items
    ADD CONSTRAINT payment_order_items_payment_order_id_fkey
    FOREIGN KEY (payment_order_id)
    REFERENCES public.payment_orders(id)
    ON DELETE CASCADE;

ALTER TABLE ONLY public.payment_order_items
    ADD CONSTRAINT payment_order_items_participant_id_fkey
    FOREIGN KEY (participant_id)
    REFERENCES public.participants(id)
    ON DELETE CASCADE;

ALTER TABLE ONLY public.payment_order_items
    ADD CONSTRAINT payment_order_items_participant_event_id_fkey
    FOREIGN KEY (participant_event_id)
    REFERENCES public.participant_events(id)
    ON DELETE SET NULL;

ALTER TABLE ONLY public.payment_order_items
    ADD CONSTRAINT payment_order_items_participant_event_member_id_fkey
    FOREIGN KEY (participant_event_member_id)
    REFERENCES public.participant_event_members(id)
    ON DELETE SET NULL;

ALTER TABLE ONLY public.payment_order_items
    ADD CONSTRAINT payment_order_items_event_id_fkey
    FOREIGN KEY (event_id)
    REFERENCES public.events(id)
    ON DELETE RESTRICT;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS payment_orders_payer_participant_id_idx
    ON public.payment_orders(payer_participant_id);

CREATE INDEX IF NOT EXISTS payment_orders_status_idx
    ON public.payment_orders(status);

CREATE INDEX IF NOT EXISTS payment_orders_gateway_order_id_idx
    ON public.payment_orders(gateway_order_id);

CREATE INDEX IF NOT EXISTS payment_order_items_payment_order_id_idx
    ON public.payment_order_items(payment_order_id);

CREATE INDEX IF NOT EXISTS payment_order_items_participant_id_idx
    ON public.payment_order_items(participant_id);

CREATE INDEX IF NOT EXISTS payment_order_items_participant_event_id_idx
    ON public.payment_order_items(participant_event_id);

CREATE INDEX IF NOT EXISTS payment_order_items_member_id_idx
    ON public.payment_order_items(participant_event_member_id);

-- ============================================================
-- OWNERSHIP
-- ============================================================

ALTER TABLE public.payment_orders OWNER TO postgres;
ALTER TABLE public.payment_order_items OWNER TO postgres;
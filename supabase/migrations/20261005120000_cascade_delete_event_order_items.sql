-- Migration: 20261005120000_cascade_delete_event_order_items.sql
-- Description: Restored to ON DELETE RESTRICT to protect payment order item financial history.
-- Events cannot be deleted if there are associated payment records.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_order_items_event_id_fkey'
    ) THEN
        ALTER TABLE public.payment_order_items
            DROP CONSTRAINT payment_order_items_event_id_fkey;
    END IF;

    ALTER TABLE public.payment_order_items
        ADD CONSTRAINT payment_order_items_event_id_fkey
        FOREIGN KEY (event_id)
        REFERENCES public.events(id)
        ON DELETE RESTRICT;
END $$;

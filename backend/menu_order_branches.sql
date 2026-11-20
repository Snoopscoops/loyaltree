-- Digital menu orders: remember the branch, the loyalty card (if connected), and the payment method.
-- Run once in Supabase SQL editor. Safe to run again.
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS branch_public_id text NOT NULL DEFAULT '';
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS branch_name text NOT NULL DEFAULT '';
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS member_customer_public_id text NOT NULL DEFAULT '';
-- 'cash' | 'qrph' | 'card' ('' for orders placed before this change).
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS menu_counter_orders_business_created_idx ON public.menu_counter_orders (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS menu_counter_orders_business_branch_idx ON public.menu_counter_orders (business_id, branch_public_id);
NOTIFY pgrst, 'reload schema';

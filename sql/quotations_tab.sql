-- Quotations tab additions: support standalone quotes (no opportunity required).
-- Additive only.

-- 1. Make opportunity_id nullable
ALTER TABLE public.crm_quotes ALTER COLUMN opportunity_id DROP NOT NULL;

-- 2. Add customer columns for standalone quotes
ALTER TABLE public.crm_quotes
  ADD COLUMN IF NOT EXISTS customer_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name    text,
  ADD COLUMN IF NOT EXISTS company_freetext text,
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','won','lost','cancelled'));

-- Backfill customer_name from opportunity → customer (best-effort, idempotent)
UPDATE public.crm_quotes q
  SET customer_name = COALESCE(q.customer_name, c.customer_name)
  FROM public.crm_opportunities o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE q.opportunity_id = o.id AND q.customer_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_quotes_quote_number ON public.crm_quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_crm_quotes_customer    ON public.crm_quotes(customer_id);

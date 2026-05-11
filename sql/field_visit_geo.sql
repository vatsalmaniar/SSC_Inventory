-- Field visit geo: origin (office or custom) → destination (customer address)
-- All additive. No external API dependency at write-time except Nominatim
-- (called from frontend with caching).

-- 1. Geocode cache so same address never re-hits Nominatim
CREATE TABLE IF NOT EXISTS public.address_geocodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_norm  text NOT NULL UNIQUE,  -- lowercased, trimmed
  lat           numeric NOT NULL,
  lng           numeric NOT NULL,
  display_name  text,
  source        text DEFAULT 'nominatim',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.address_geocodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read"  ON public.address_geocodes;
DROP POLICY IF EXISTS "auth_write" ON public.address_geocodes;
CREATE POLICY "auth_read"  ON public.address_geocodes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON public.address_geocodes FOR INSERT TO authenticated WITH CHECK (true);

-- 2. New columns on crm_field_visits — additive only
ALTER TABLE public.crm_field_visits
  ADD COLUMN IF NOT EXISTS origin_type           text,    -- 'office_ahmedabad' | 'office_baroda' | 'other'
  ADD COLUMN IF NOT EXISTS origin_address        text,
  ADD COLUMN IF NOT EXISTS origin_lat            numeric,
  ADD COLUMN IF NOT EXISTS origin_lng            numeric,
  ADD COLUMN IF NOT EXISTS destination_address   text,
  ADD COLUMN IF NOT EXISTS destination_lat       numeric,
  ADD COLUMN IF NOT EXISTS destination_lng       numeric,
  ADD COLUMN IF NOT EXISTS distance_km           numeric;

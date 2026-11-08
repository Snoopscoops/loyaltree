CREATE TABLE IF NOT EXISTS public.ltb_phone_remembers (
  email text NOT NULL,
  phone text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, phone)
);
CREATE INDEX IF NOT EXISTS ltb_phone_remembers_verified_idx
  ON public.ltb_phone_remembers(verified_at DESC);

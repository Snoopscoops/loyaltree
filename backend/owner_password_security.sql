-- Apply before deploying owner password/session revocation support.
-- Existing sessions remain valid at auth_version 0 until a password reset.
BEGIN;
-- Older installs may have a 64-character SHA-256 column; salted envelopes need
-- more space. Widening preserves existing hashes and plaintext values.
ALTER TABLE public.businesses ALTER COLUMN password_hash TYPE text;
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS auth_version bigint NOT NULL DEFAULT 0;

-- One statement consumes the reset token, changes the password and revokes old
-- owner sessions. Concurrent reuse of the token can update at most one row.
CREATE OR REPLACE FUNCTION public.reset_owner_password(
  p_public_id text,
  p_token_hash text,
  p_password_hash text
) RETURNS TABLE(auth_version bigint)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.businesses AS b
  SET password_hash = p_password_hash,
      auth_version = b.auth_version + 1,
      password_reset_token_hash = NULL,
      password_reset_expires_at = NULL,
      password_changed_at = now(),
      updated_at = now()
  WHERE b.public_id = p_public_id
    AND b.password_reset_token_hash = p_token_hash
    AND b.password_reset_expires_at::timestamptz > now()
    AND p_password_hash LIKE 'pbkdf2_sha256$600000$%'
  RETURNING b.auth_version;
$$;
REVOKE ALL ON FUNCTION public.reset_owner_password(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_owner_password(text,text,text) TO service_role;
COMMIT;

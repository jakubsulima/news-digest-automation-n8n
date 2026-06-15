CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.allowed_reader_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO private.allowed_reader_emails (email, created_at)
SELECT email, created_at
FROM public.allowed_reader_emails
ON CONFLICT (email) DO UPDATE SET
  created_at = LEAST(private.allowed_reader_emails.created_at, EXCLUDED.created_at);

DROP TABLE IF EXISTS public.allowed_reader_emails;

CREATE OR REPLACE FUNCTION private.is_allowed_reader()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, private
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.allowed_reader_emails
    WHERE email = LOWER(auth.jwt() ->> 'email')
  );
$$;

REVOKE ALL ON FUNCTION private.is_allowed_reader() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_allowed_reader() TO authenticated;

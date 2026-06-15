CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP POLICY IF EXISTS "Allowed readers can view allowed emails" ON public.allowed_reader_emails;
DROP POLICY IF EXISTS "Allowed readers can view news" ON public.news_items;
DROP POLICY IF EXISTS "Allowed readers can view own states" ON public.reader_item_states;
DROP POLICY IF EXISTS "Allowed readers can insert own states" ON public.reader_item_states;
DROP POLICY IF EXISTS "Allowed readers can update own states" ON public.reader_item_states;
DROP POLICY IF EXISTS "Allowed readers can delete own states" ON public.reader_item_states;

DROP FUNCTION IF EXISTS public.is_allowed_reader();

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

CREATE POLICY "Allowed readers can view news"
ON public.news_items
FOR SELECT
TO authenticated
USING (private.is_allowed_reader());

CREATE POLICY "Allowed readers can view own states"
ON public.reader_item_states
FOR SELECT
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid());

CREATE POLICY "Allowed readers can insert own states"
ON public.reader_item_states
FOR INSERT
TO authenticated
WITH CHECK (private.is_allowed_reader() AND user_id = auth.uid());

CREATE POLICY "Allowed readers can update own states"
ON public.reader_item_states
FOR UPDATE
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid())
WITH CHECK (private.is_allowed_reader() AND user_id = auth.uid());

CREATE POLICY "Allowed readers can delete own states"
ON public.reader_item_states
FOR DELETE
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid());

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.allowed_reader_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  digest_date DATE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL,
  importance_score INTEGER CHECK (
    importance_score IS NULL
    OR importance_score BETWEEN 0 AND 100
  ),
  published_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reader_item_states (
  news_item_id UUID NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (news_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS news_items_digest_date_idx
  ON public.news_items (digest_date DESC);

CREATE INDEX IF NOT EXISTS news_items_published_at_idx
  ON public.news_items (published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS news_items_category_idx
  ON public.news_items (category);

CREATE INDEX IF NOT EXISTS news_items_source_idx
  ON public.news_items (source);

CREATE INDEX IF NOT EXISTS reader_item_states_user_idx
  ON public.reader_item_states (user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS set_news_items_updated_at ON public.news_items;
CREATE TRIGGER set_news_items_updated_at
BEFORE UPDATE ON public.news_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_reader_item_states_updated_at ON public.reader_item_states;
CREATE TRIGGER set_reader_item_states_updated_at
BEFORE UPDATE ON public.reader_item_states
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_item_states ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Allowed readers can view news" ON public.news_items;
CREATE POLICY "Allowed readers can view news"
ON public.news_items
FOR SELECT
TO authenticated
USING (private.is_allowed_reader());

DROP POLICY IF EXISTS "Allowed readers can view own states" ON public.reader_item_states;
CREATE POLICY "Allowed readers can view own states"
ON public.reader_item_states
FOR SELECT
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Allowed readers can insert own states" ON public.reader_item_states;
CREATE POLICY "Allowed readers can insert own states"
ON public.reader_item_states
FOR INSERT
TO authenticated
WITH CHECK (private.is_allowed_reader() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Allowed readers can update own states" ON public.reader_item_states;
CREATE POLICY "Allowed readers can update own states"
ON public.reader_item_states
FOR UPDATE
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid())
WITH CHECK (private.is_allowed_reader() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Allowed readers can delete own states" ON public.reader_item_states;
CREATE POLICY "Allowed readers can delete own states"
ON public.reader_item_states
FOR DELETE
TO authenticated
USING (private.is_allowed_reader() AND user_id = auth.uid());

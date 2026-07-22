CREATE TABLE IF NOT EXISTS public.reader_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_cluster_id UUID REFERENCES public.story_clusters(id) ON DELETE SET NULL,
  news_item_id UUID REFERENCES public.news_items(id) ON DELETE SET NULL,
  article_id UUID REFERENCES public.articles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'research', 'thought')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  note_text TEXT NOT NULL DEFAULT '',
  quote_text TEXT,
  quote_prefix TEXT,
  quote_suffix TEXT,
  title_snapshot TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  source_url_snapshot TEXT NOT NULL,
  published_at_snapshot TIMESTAMPTZ,
  topic_tags_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_tags_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reader_notes_content_required CHECK (
    LENGTH(BTRIM(note_text)) > 0 OR LENGTH(BTRIM(COALESCE(quote_text, ''))) > 0
  ),
  CONSTRAINT reader_notes_note_length CHECK (CHAR_LENGTH(note_text) <= 10000),
  CONSTRAINT reader_notes_quote_length CHECK (CHAR_LENGTH(COALESCE(quote_text, '')) <= 4000),
  CONSTRAINT reader_notes_quote_prefix_length CHECK (CHAR_LENGTH(COALESCE(quote_prefix, '')) <= 200),
  CONSTRAINT reader_notes_quote_suffix_length CHECK (CHAR_LENGTH(COALESCE(quote_suffix, '')) <= 200),
  CONSTRAINT reader_notes_topic_tags_array CHECK (jsonb_typeof(topic_tags_snapshot) = 'array'),
  CONSTRAINT reader_notes_entity_tags_array CHECK (jsonb_typeof(entity_tags_snapshot) = 'array')
);

CREATE INDEX IF NOT EXISTS reader_notes_user_updated_idx
  ON public.reader_notes (user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS reader_notes_user_kind_status_idx
  ON public.reader_notes (user_id, kind, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS reader_notes_story_cluster_idx
  ON public.reader_notes (story_cluster_id, updated_at DESC)
  WHERE story_cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reader_notes_news_item_idx
  ON public.reader_notes (news_item_id)
  WHERE news_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_reader_notes_updated_at ON public.reader_notes;
CREATE TRIGGER set_reader_notes_updated_at
BEFORE UPDATE ON public.reader_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reader_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can view own notes" ON public.reader_notes;
CREATE POLICY "Allowed readers can view own notes"
ON public.reader_notes
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can create own notes" ON public.reader_notes;
CREATE POLICY "Allowed readers can create own notes"
ON public.reader_notes
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can update own notes" ON public.reader_notes;
CREATE POLICY "Allowed readers can update own notes"
ON public.reader_notes
FOR UPDATE
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()))
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can delete own notes" ON public.reader_notes;
CREATE POLICY "Allowed readers can delete own notes"
ON public.reader_notes
FOR DELETE
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_notes TO authenticated;
GRANT ALL ON public.reader_notes TO service_role;


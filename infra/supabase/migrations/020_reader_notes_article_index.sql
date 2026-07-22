CREATE INDEX IF NOT EXISTS reader_notes_article_idx
  ON public.reader_notes (article_id)
  WHERE article_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reader_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  category TEXT NOT NULL CHECK (LENGTH(TRIM(category)) > 0),
  feed_url TEXT NOT NULL UNIQUE CHECK (feed_url ~* '^https?://'),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reader_sources_enabled_priority_idx
  ON public.reader_sources (enabled, priority DESC, name ASC);

INSERT INTO public.reader_sources (name, category, feed_url, priority, enabled)
VALUES
  ('Money.pl Gospodarka', 'Polska / Gospodarka', 'https://www.money.pl/rss/rss-gospodarka.xml', 4, TRUE),
  ('Stooq', 'Polska / Giełda', 'https://stooq.pl/rss/', 4, TRUE),
  ('StockWatch', 'Polska / Giełda', 'https://www.stockwatch.pl/rss/', 4, TRUE),
  ('Niebezpiecznik', 'Cyberbezpieczeństwo PL', 'https://feeds.feedburner.com/niebezpiecznik/', 1, TRUE),
  ('CERT Polska', 'Cyberbezpieczeństwo PL', 'https://cert.pl/feed/', 1, TRUE),
  ('300Gospodarka', 'Polska / Gospodarka / Technologie', 'https://300gospodarka.pl/feed', 4, TRUE),
  ('Rest of World Money', 'Świat / Gospodarka cyfrowa', 'https://restofworld.org/feed/money/', 4, TRUE),
  ('BBC World', 'Świat / Ważne wydarzenia', 'https://feeds.bbci.co.uk/news/world/rss.xml', 5, TRUE),
  ('Rest of World Global', 'Świat / Technologie / Biznes', 'https://restofworld.org/feed/global/', 4, TRUE),
  ('Rest of World Innovation', 'Świat / Technologie / Innowacje', 'https://restofworld.org/feed/innovation/', 4, TRUE),
  ('NPR World', 'Świat / Ważne wydarzenia', 'https://feeds.npr.org/1004/rss.xml', 4, TRUE),
  ('The Guardian World', 'Świat / Geopolityka', 'https://www.theguardian.com/world/rss', 5, TRUE),
  ('POLITICO Europe', 'Świat / Geopolityka / Europa', 'https://www.politico.eu/feed/', 5, TRUE),
  ('Al Jazeera', 'Świat / Geopolityka', 'https://www.aljazeera.com/xml/rss/all.xml', 4, TRUE),
  ('BBC Business', 'Świat / Biznes / Makro', 'https://feeds.bbci.co.uk/news/business/rss.xml', 4, TRUE),
  ('The Guardian Business', 'Świat / Biznes / Makro', 'https://www.theguardian.com/uk/business/rss', 3, TRUE),
  ('NPR Business', 'Świat / Biznes / Makro', 'https://feeds.npr.org/1006/rss.xml', 3, TRUE),
  ('Hacker News Frontpage', 'Software / IT', 'https://hnrss.org/frontpage', 5, TRUE),
  ('Hacker News Best', 'Software / IT', 'https://hnrss.org/best', 3, TRUE),
  ('Ars Technica', 'Software / IT', 'https://feeds.arstechnica.com/arstechnica/index', 5, TRUE),
  ('The Register', 'Software / IT', 'https://www.theregister.com/?lab_viewport=rss', 4, TRUE),
  ('VentureBeat AI', 'AI / Biznes / Rynek', 'https://venturebeat.com/category/ai/feed', 4, TRUE),
  ('BBC Technology', 'Software / IT', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 4, TRUE),
  ('GitHub Blog', 'Software / DevTools', 'https://github.blog/feed/', 4, TRUE),
  ('GitHub Engineering', 'Software / Engineering', 'https://github.blog/engineering/feed/', 4, TRUE),
  ('InfoQ', 'Software / Architecture', 'https://feed.infoq.com/', 4, TRUE),
  ('Martin Fowler', 'Software / Architecture', 'https://martinfowler.com/feed.atom', 3, TRUE),
  ('Hugging Face Blog', 'AI / Open Source', 'https://huggingface.co/blog/feed.xml', 2, TRUE),
  ('BleepingComputer', 'Cybersecurity Global', 'https://www.bleepingcomputer.com/feed/', 1, TRUE)
ON CONFLICT (feed_url) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.reader_item_feedback (
  news_item_id UUID NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('more', 'less')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (news_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS reader_item_feedback_user_idx
  ON public.reader_item_feedback (user_id);

DROP TRIGGER IF EXISTS set_reader_sources_updated_at ON public.reader_sources;
CREATE TRIGGER set_reader_sources_updated_at
BEFORE UPDATE ON public.reader_sources
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_reader_item_feedback_updated_at ON public.reader_item_feedback;
CREATE TRIGGER set_reader_item_feedback_updated_at
BEFORE UPDATE ON public.reader_item_feedback
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reader_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_item_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can view sources" ON public.reader_sources;
CREATE POLICY "Allowed readers can view sources"
ON public.reader_sources
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()));

DROP POLICY IF EXISTS "Allowed readers can insert sources" ON public.reader_sources;
CREATE POLICY "Allowed readers can insert sources"
ON public.reader_sources
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_allowed_reader()));

DROP POLICY IF EXISTS "Allowed readers can update sources" ON public.reader_sources;
CREATE POLICY "Allowed readers can update sources"
ON public.reader_sources
FOR UPDATE
TO authenticated
USING ((SELECT private.is_allowed_reader()))
WITH CHECK ((SELECT private.is_allowed_reader()));

DROP POLICY IF EXISTS "Allowed readers can view own feedback" ON public.reader_item_feedback;
CREATE POLICY "Allowed readers can view own feedback"
ON public.reader_item_feedback
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can insert own feedback" ON public.reader_item_feedback;
CREATE POLICY "Allowed readers can insert own feedback"
ON public.reader_item_feedback
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can update own feedback" ON public.reader_item_feedback;
CREATE POLICY "Allowed readers can update own feedback"
ON public.reader_item_feedback
FOR UPDATE
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()))
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can delete own feedback" ON public.reader_item_feedback;
CREATE POLICY "Allowed readers can delete own feedback"
ON public.reader_item_feedback
FOR DELETE
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

import "server-only";

import type { Json } from "./database.types";
import { readingTimeMinutesForDigestBrief } from "./digest-brief-text";
import { createSupabaseAdminClient } from "./supabase";
import type { EvidenceStatus } from "./evidence";
import type { ReaderLocale } from "./reader-locale";

export type DigestBriefHighlight = {
  newsItemId: string;
  source: string;
  sourceUrl: string | null;
  title: string;
  whatHappened: string;
  whyItMatters: string;
};

export type DigestBriefReference = {
  newsItemId: string;
  source: string;
  sourceUrl: string | null;
  title: string;
};

export type DigestBriefSupport = {
  fullTextSourceCount: number;
  independentSourceCount: number;
  status: EvidenceStatus;
};

export type DigestBriefSection = {
  category: string;
  paragraphs: Array<{
    references: DigestBriefReference[];
    support?: DigestBriefSupport;
    text: string;
  }>;
  title: string;
};

export type DigestBriefWatchItem = {
  references: DigestBriefReference[];
  signal: string;
  why: string;
};

export type DigestBrief = {
  coverageNote: string;
  digestDate: string;
  highlights: DigestBriefHighlight[];
  readingTimeMinutes: number;
  sections: DigestBriefSection[];
  summary: string;
  watchlist: DigestBriefWatchItem[];
};

export type LocalizedDigestBrief = DigestBrief & {
  locale: ReaderLocale;
};

export type DigestBriefFallbackArticle = {
  category: string;
  digestDate: string;
  id: string;
  preview: { whyItMatters: string } | null;
  source: string;
  sourceUrl?: string;
  summary: string;
  title: string;
  whyInteresting: string | null;
};

type SupabaseError = {
  code?: string;
  message?: string;
};

export function isDigestBriefSchemaError(error: unknown) {
  const supabaseError = error && typeof error === "object" ? (error as SupabaseError) : {};
  const message = supabaseError.message?.toLowerCase() || "";

  return (
    supabaseError.code === "42P01" ||
    supabaseError.code === "42703" ||
    supabaseError.code === "PGRST204" ||
    supabaseError.code === "PGRST205" ||
    message.includes("digest_summaries") ||
    message.includes("schema cache")
  );
}

function parseHighlights(value: Json): DigestBriefHighlight[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const highlight = entry as Record<string, Json | undefined>;
    const newsItemId = typeof highlight.newsItemId === "string" ? highlight.newsItemId : null;
    const source = typeof highlight.source === "string" ? highlight.source : null;
    const sourceUrl = typeof highlight.sourceUrl === "string" ? highlight.sourceUrl : null;
    const title = typeof highlight.title === "string" ? highlight.title : null;
    const whatHappened = typeof highlight.whatHappened === "string" ? highlight.whatHappened : null;
    const whyItMatters = typeof highlight.whyItMatters === "string" ? highlight.whyItMatters : null;

    return newsItemId && source && title && whyItMatters
      ? [{ newsItemId, source, sourceUrl, title, whatHappened: whatHappened || title, whyItMatters }]
      : [];
  });
}

function parseReferences(value: Json | undefined): DigestBriefReference[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const reference = entry as Record<string, Json | undefined>;
    const newsItemId = typeof reference.newsItemId === "string" ? reference.newsItemId : null;
    const source = typeof reference.source === "string" ? reference.source : null;
    const sourceUrl = typeof reference.sourceUrl === "string" ? reference.sourceUrl : null;
    const title = typeof reference.title === "string" ? reference.title : null;

    if (!newsItemId || !source || !title || seen.has(newsItemId)) return [];
    seen.add(newsItemId);
    return [{ newsItemId, source, sourceUrl, title }];
  });
}

function parseParagraphs(section: Record<string, Json | undefined>): DigestBriefSection["paragraphs"] {
  const rawParagraphs = Array.isArray(section.paragraphs)
    ? section.paragraphs
    : typeof section.situation === "string"
      ? [{ text: section.situation, references: section.references }]
      : [];

  return rawParagraphs.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const paragraph = entry as Record<string, Json | undefined>;
    const text = typeof paragraph.text === "string" ? paragraph.text.trim() : "";
    const references = parseReferences(paragraph.references);
    const supportValue = paragraph.support && typeof paragraph.support === "object" && !Array.isArray(paragraph.support)
      ? paragraph.support as Record<string, Json | undefined>
      : {};
    const support: DigestBriefSupport = {
      fullTextSourceCount: typeof supportValue.fullTextSourceCount === "number" ? Math.max(0, supportValue.fullTextSourceCount) : 0,
      independentSourceCount: typeof supportValue.independentSourceCount === "number"
        ? Math.max(1, supportValue.independentSourceCount)
        : Math.max(1, references.length),
      status: supportValue.status === "full_text" || supportValue.status === "corroborated_summary" || supportValue.status === "limited"
        ? supportValue.status
        : references.length >= 2 ? "corroborated_summary" : "limited",
    };

    return text ? [{ references, support, text }] : [];
  });
}

function parseSections(value: Json): DigestBriefSection[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const section = entry as Record<string, Json | undefined>;
    const category = typeof section.category === "string" ? section.category : null;
    const title = typeof section.title === "string" ? section.title : null;
    const paragraphs = parseParagraphs(section);

    return category && title && paragraphs.length
      ? [{ category, paragraphs, title }]
      : [];
  });
}

function parseWatchlist(value: Json): DigestBriefWatchItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, Json | undefined>;
    const signal = typeof item.signal === "string" ? item.signal : null;
    const why = typeof item.why === "string" ? item.why : null;

    return signal && why ? [{ references: parseReferences(item.references), signal, why }] : [];
  });
}

function fallbackSectionTitle(category: string) {
  const labels: Record<string, string> = {
    ai: "AI",
    business: "Biznes i gospodarka",
    geopolitics: "Geopolityka",
    security: "Cyberbezpieczeństwo",
    software: "Technologia i software",
  };

  return labels[category.toLowerCase()] || category;
}

function compactToWordLimit(value: string, maxWords: number) {
  const words = value.split(/\s+/).filter(Boolean);

  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?-]+$/, "")}…` : value;
}

function fallbackWhyItMatters(article: DigestBriefFallbackArticle) {
  return compactToWordLimit(article.preview?.whyItMatters || article.whyInteresting || article.summary, 30);
}

export function fallbackDigestBriefFromNews(items: DigestBriefFallbackArticle[]): DigestBrief | null {
  const digestDate = items.reduce<string | null>(
    (latestDate, item) => (!latestDate || item.digestDate > latestDate ? item.digestDate : latestDate),
    null,
  );

  if (!digestDate) {
    return null;
  }

  const latestItems = items.filter((item) => item.digestDate === digestDate);
  const highlights = latestItems.slice(0, 5).map((item) => ({
    newsItemId: item.id,
    source: item.source,
    sourceUrl: item.sourceUrl ?? null,
    title: item.title,
    whatHappened: compactToWordLimit(item.summary, 25),
    whyItMatters: fallbackWhyItMatters(item),
  }));
  const sections = Array.from(new Set(latestItems.map((item) => item.category))).slice(0, 5).map((category) => {
    const categoryItems = latestItems.filter((item) => item.category === category).slice(0, 6);
    const references = categoryItems.map((item) => ({ newsItemId: item.id, source: item.source, sourceUrl: item.sourceUrl ?? null, title: item.title }));

    return {
      category,
      paragraphs: [{
        references,
        text: compactToWordLimit(categoryItems.map((item) => item.summary).join(" "), 65),
      }],
      title: fallbackSectionTitle(category),
    };
  });
  const subject = latestItems.length === 1 ? "jedną wiadomość" : "wybrane wiadomości";

  return {
    coverageNote: "Widok awaryjny bez syntezy AI — pełny kontekst znajduje się w materiałach źródłowych.",
    digestDate,
    highlights,
    readingTimeMinutes: readingTimeMinutesForDigestBrief({
      coverageNote: "Widok awaryjny bez syntezy AI — pełny kontekst znajduje się w materiałach źródłowych.",
      sections,
      summary: `Najnowszy digest obejmuje ${subject}. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.`,
      watchlist: [],
    }),
    sections,
    summary: `Najnowszy digest obejmuje ${subject}. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.`,
    watchlist: [],
  };
}

export async function getLatestDigestBrief(): Promise<DigestBrief | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_summaries")
    .select("coverage_note, digest_date, highlights, reading_time_minutes, sections, summary, watchlist")
    .order("digest_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isDigestBriefSchemaError(error)) {
      return null;
    }

    throw error;
  }

  if (!data) return null;

  const sections = parseSections(data.sections);
  const watchlist = parseWatchlist(data.watchlist);
  const highlights = parseHighlights(data.highlights);
  const summary = data.summary;
  const coverageNote = data.coverage_note;
  const newsItemIds = Array.from(new Set([
    ...highlights.map((highlight) => highlight.newsItemId),
    ...sections.flatMap((section) => section.paragraphs.flatMap((paragraph) => paragraph.references.map((reference) => reference.newsItemId))),
    ...watchlist.flatMap((item) => item.references.map((reference) => reference.newsItemId)),
  ]));
  const sourceUrlByNewsItemId = new Map<string, string>();

  if (newsItemIds.length) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from("news_items")
      .select("id, source_url")
      .in("id", newsItemIds);

    if (sourceError) throw sourceError;

    for (const row of sourceRows) {
      sourceUrlByNewsItemId.set(row.id, row.source_url);
    }
  }

  const withSourceUrl = <T extends { newsItemId: string; sourceUrl: string | null }>(item: T): T => ({
    ...item,
    sourceUrl: sourceUrlByNewsItemId.get(item.newsItemId) ?? item.sourceUrl,
  });
  const linkedSections = sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs.map((paragraph) => ({
      ...paragraph,
      references: paragraph.references.map(withSourceUrl),
    })),
  }));
  const linkedWatchlist = watchlist.map((item) => ({
    ...item,
    references: item.references.map(withSourceUrl),
  }));

  return {
    coverageNote,
    digestDate: data.digest_date,
    highlights: highlights.map(withSourceUrl),
    readingTimeMinutes: readingTimeMinutesForDigestBrief({ coverageNote, sections: linkedSections, summary, watchlist: linkedWatchlist }),
    sections: linkedSections,
    summary,
    watchlist: linkedWatchlist,
  };
}

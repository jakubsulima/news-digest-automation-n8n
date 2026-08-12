import "server-only";

import type { Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type DigestBriefHighlight = {
  newsItemId: string;
  source: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
};

export type DigestBriefReference = {
  newsItemId: string;
  source: string;
  title: string;
};

export type DigestBriefSection = {
  category: string;
  references: DigestBriefReference[];
  situation: string;
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

export type DigestBriefFallbackArticle = {
  category: string;
  digestDate: string;
  id: string;
  preview: { whyItMatters: string } | null;
  source: string;
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
    const title = typeof highlight.title === "string" ? highlight.title : null;
    const whatHappened = typeof highlight.whatHappened === "string" ? highlight.whatHappened : null;
    const whyItMatters = typeof highlight.whyItMatters === "string" ? highlight.whyItMatters : null;

    return newsItemId && source && title && whyItMatters
      ? [{ newsItemId, source, title, whatHappened: whatHappened || title, whyItMatters }]
      : [];
  });
}

function parseReferences(value: Json | undefined): DigestBriefReference[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const reference = entry as Record<string, Json | undefined>;
    const newsItemId = typeof reference.newsItemId === "string" ? reference.newsItemId : null;
    const source = typeof reference.source === "string" ? reference.source : null;
    const title = typeof reference.title === "string" ? reference.title : null;

    return newsItemId && source && title ? [{ newsItemId, source, title }] : [];
  });
}

function parseSections(value: Json): DigestBriefSection[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const section = entry as Record<string, Json | undefined>;
    const category = typeof section.category === "string" ? section.category : null;
    const title = typeof section.title === "string" ? section.title : null;
    const situation = typeof section.situation === "string" ? section.situation : null;

    return category && title && situation
      ? [{ category, references: parseReferences(section.references), situation, title }]
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
    title: item.title,
    whatHappened: compactToWordLimit(item.summary, 25),
    whyItMatters: fallbackWhyItMatters(item),
  }));
  const sections = Array.from(new Set(latestItems.map((item) => item.category))).slice(0, 5).map((category) => {
    const categoryItems = latestItems.filter((item) => item.category === category).slice(0, 6);

    return {
      category,
      references: categoryItems.map((item) => ({ newsItemId: item.id, source: item.source, title: item.title })),
      situation: compactToWordLimit(categoryItems.map((item) => item.summary).join(" "), 65),
      title: fallbackSectionTitle(category),
    };
  });
  const articleCount = latestItems.length;
  const subject = articleCount === 1 ? "jedną wiadomość" : `${articleCount} wiadomości`;

  return {
    coverageNote: "Widok awaryjny bez syntezy AI — pełny kontekst znajduje się w materiałach źródłowych.",
    digestDate,
    highlights,
    readingTimeMinutes: Math.max(1, Math.min(5, Math.ceil(articleCount / 5))),
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

  return data
    ? {
        coverageNote: data.coverage_note,
        digestDate: data.digest_date,
        highlights: parseHighlights(data.highlights),
        readingTimeMinutes: data.reading_time_minutes,
        sections: parseSections(data.sections),
        summary: data.summary,
        watchlist: parseWatchlist(data.watchlist),
      }
    : null;
}

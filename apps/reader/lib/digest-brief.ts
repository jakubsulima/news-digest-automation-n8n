import "server-only";

import type { Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type DigestBriefHighlight = {
  newsItemId: string;
  source: string;
  title: string;
  whyItMatters: string;
};

export type DigestBrief = {
  digestDate: string;
  highlights: DigestBriefHighlight[];
  summary: string;
};

export type DigestBriefFallbackArticle = {
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
    const whyItMatters = typeof highlight.whyItMatters === "string" ? highlight.whyItMatters : null;

    return newsItemId && source && title && whyItMatters ? [{ newsItemId, source, title, whyItMatters }] : [];
  });
}

function fallbackWhyItMatters(article: DigestBriefFallbackArticle) {
  return article.preview?.whyItMatters || article.whyInteresting || article.summary;
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
    whyItMatters: fallbackWhyItMatters(item),
  }));
  const articleCount = latestItems.length;
  const subject = articleCount === 1 ? "jedną wiadomość" : `${articleCount} wiadomości`;

  return {
    digestDate,
    highlights,
    summary: `Najnowszy digest obejmuje ${subject}. Poniżej znajdziesz najważniejsze informacje z tego zestawu.`,
  };
}

export async function getLatestDigestBrief(): Promise<DigestBrief | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_summaries")
    .select("digest_date, highlights, summary")
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
        digestDate: data.digest_date,
        highlights: parseHighlights(data.highlights),
        summary: data.summary,
      }
    : null;
}

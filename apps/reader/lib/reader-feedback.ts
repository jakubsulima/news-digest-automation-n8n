import "server-only";

import { readerFeedForCategory, type ReaderFeedId } from "./feed-categories";
import { createSupabaseAdminClient } from "./supabase";
import { plainTextFromHtml } from "./text";

export type FeedbackSentiment = "more" | "less";

type FeedbackBasis = {
  category: string;
  sentiment: FeedbackSentiment;
  source: string;
  summary: string;
  title: string;
};
type SupabaseError = {
  code?: string;
  message?: string;
};

export type FeedbackProfile = {
  feeds: Map<Exclude<ReaderFeedId, "all">, { more: number; less: number }>;
  keywords: Map<string, { more: number; less: number }>;
  sources: Map<string, { more: number; less: number }>;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "amid",
  "from",
  "have",
  "into",
  "more",
  "over",
  "said",
  "that",
  "their",
  "this",
  "with",
  "will",
  "would",
  "your",
  "oraz",
  "jest",
  "jako",
  "przez",
  "tego",
  "tych",
  "dla",
  "się",
]);

export function parseFeedbackSentiment(value: unknown): FeedbackSentiment | null | undefined {
  if (value === null) {
    return null;
  }

  if (value === "more" || value === "less") {
    return value;
  }

  return undefined;
}

export function isReaderFeedbackSchemaError(error: unknown) {
  const supabaseError = error && typeof error === "object" ? (error as SupabaseError) : {};

  return (
    supabaseError.code === "42P01" ||
    supabaseError.code === "42703" ||
    supabaseError.code === "PGRST204" ||
    supabaseError.code === "PGRST205" ||
    Boolean(supabaseError.message?.toLowerCase().includes("reader_item_feedback")) ||
    Boolean(supabaseError.message?.toLowerCase().includes("schema cache"))
  );
}

function emptyCounts() {
  return { less: 0, more: 0 };
}

function addCount<T>(map: Map<T, { more: number; less: number }>, key: T, sentiment: FeedbackSentiment) {
  const counts = map.get(key) ?? emptyCounts();
  counts[sentiment] += 1;
  map.set(key, counts);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function extractFeedbackKeywords(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((word) => word.length >= 4 && !STOP_WORDS.has(word)) ?? [],
    ),
  ).slice(0, 40);
}

export function buildFeedbackProfile(items: FeedbackBasis[]): FeedbackProfile {
  const profile: FeedbackProfile = {
    feeds: new Map(),
    keywords: new Map(),
    sources: new Map(),
  };

  for (const item of items) {
    addCount(profile.sources, item.source.toLowerCase(), item.sentiment);
    addCount(profile.feeds, readerFeedForCategory(item.category), item.sentiment);

    for (const keyword of extractFeedbackKeywords(`${item.title} ${item.summary}`)) {
      addCount(profile.keywords, keyword, item.sentiment);
    }
  }

  return profile;
}

export function feedbackScoreAdjustment(profile: FeedbackProfile, item: { category: string; source: string; text: string }) {
  const sourceCounts = profile.sources.get(item.source.toLowerCase());
  const feedCounts = profile.feeds.get(readerFeedForCategory(item.category));
  let adjustment = 0;

  if (sourceCounts) {
    adjustment += sourceCounts.more > 0 ? 5 : 0;
    adjustment -= sourceCounts.less > 0 ? 8 : 0;
  }

  if (feedCounts) {
    adjustment += feedCounts.more > 0 ? 3 : 0;
    adjustment -= feedCounts.less > 0 ? 5 : 0;
  }

  let keywordBoost = 0;
  let keywordPenalty = 0;

  for (const keyword of extractFeedbackKeywords(item.text)) {
    const counts = profile.keywords.get(keyword);

    if (!counts) {
      continue;
    }

    keywordBoost += counts.more * 2;
    keywordPenalty += counts.less * 3;
  }

  return adjustment + clamp(keywordBoost, 0, 12) - clamp(keywordPenalty, 0, 16);
}

export async function getFeedbackProfileForUser(userId: string | null): Promise<FeedbackProfile> {
  if (!userId) {
    return buildFeedbackProfile([]);
  }

  const supabase = createSupabaseAdminClient();
  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("reader_item_feedback")
    .select("news_item_id, sentiment")
    .eq("user_id", userId)
    .limit(500);

  if (feedbackError) {
    if (isReaderFeedbackSchemaError(feedbackError)) {
      return buildFeedbackProfile([]);
    }

    throw feedbackError;
  }

  const feedback = feedbackRows || [];
  const itemIds = feedback.map((row) => row.news_item_id);

  if (!itemIds.length) {
    return buildFeedbackProfile([]);
  }

  const { data: newsItems, error: itemError } = await supabase
    .from("news_items")
    .select("id, title, summary, source, category")
    .in("id", itemIds);

  if (itemError) {
    throw itemError;
  }

  const feedbackByItemId = new Map(feedback.map((row) => [row.news_item_id, row.sentiment]));
  const basis = (newsItems || []).flatMap((item) => {
    const sentiment = feedbackByItemId.get(item.id);

    return sentiment
      ? [
          {
            category: item.category,
            sentiment,
            source: item.source,
            summary: plainTextFromHtml(item.summary),
            title: plainTextFromHtml(item.title),
          },
        ]
      : [];
  });

  return buildFeedbackProfile(basis);
}

export async function setReaderItemFeedback(userId: string, newsItemId: string, sentiment: FeedbackSentiment | null) {
  const supabase = createSupabaseAdminClient();

  if (!sentiment) {
    const { error } = await supabase
      .from("reader_item_feedback")
      .delete()
      .eq("user_id", userId)
      .eq("news_item_id", newsItemId);

    if (error) {
      throw error;
    }

    return;
  }

  const { error } = await supabase.from("reader_item_feedback").upsert(
    {
      news_item_id: newsItemId,
      sentiment,
      user_id: userId,
    },
    { onConflict: "news_item_id,user_id" },
  );

  if (error) {
    throw error;
  }
}

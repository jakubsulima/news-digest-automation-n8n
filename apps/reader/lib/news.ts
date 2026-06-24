import "server-only";

import type { Database, Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";
import { cleanArticleSummary, plainTextFromHtml } from "./text";
import { isReaderFeedbackSchemaError, type FeedbackSentiment } from "./reader-feedback";

export type NewsItemPreview = {
  clickIf: string;
  practicalBucket: string;
  whatHappened: string;
  whyItMatters: string;
};

export type NewsItemWithState = {
  id: string;
  externalId: string;
  digestDate: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  category: string;
  importanceScore: number | null;
  practicalBucket: string | null;
  preview: NewsItemPreview | null;
  publishedAt: string | null;
  recommendedAction: string | null;
  readAt: string | null;
  savedAt: string | null;
  archivedAt: string | null;
  scoreComponents: Record<string, string | number | boolean>;
  feedback: FeedbackSentiment | null;
  whyInteresting: string | null;
};

type NewsItemRow = Pick<
  Database["public"]["Tables"]["news_items"]["Row"],
  | "id"
  | "external_id"
  | "digest_date"
  | "title"
  | "summary"
  | "source"
  | "source_url"
  | "category"
  | "importance_score"
  | "published_at"
  | "raw_payload"
>;
type ReaderItemStateRow = Pick<
  Database["public"]["Tables"]["reader_item_states"]["Row"],
  "read_at" | "saved_at" | "archived_at"
>;

const NEWS_ITEM_COLUMNS =
  "id, external_id, digest_date, title, summary, source, source_url, category, importance_score, published_at, raw_payload";

function jsonRecord(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonString(value: Json | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scoreComponentsFromPayload(rawPayload: Json): Record<string, string | number | boolean> {
  const score = jsonRecord(rawPayload).score;
  const components = jsonRecord(score).components;
  const componentRecord = jsonRecord(components);

  return Object.fromEntries(
    Object.entries(componentRecord).filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
    ),
  );
}

function previewFromPayload(rawPayload: Json): NewsItemPreview | null {
  const payload = jsonRecord(rawPayload);
  const preview = jsonRecord(payload.preview);
  const whatHappened = jsonString(preview.whatHappened);
  const whyItMatters = jsonString(preview.whyItMatters);
  const clickIf = jsonString(preview.clickIf);
  const practicalBucket = jsonString(preview.practicalBucket) || jsonString(payload.practicalBucket);

  if (!whatHappened || !whyItMatters || !clickIf || !practicalBucket) {
    return null;
  }

  return {
    clickIf,
    practicalBucket,
    whatHappened,
    whyItMatters,
  };
}

function newsItemWithState(
  item: NewsItemRow,
  state: ReaderItemStateRow | null | undefined,
  feedback: FeedbackSentiment | null,
): NewsItemWithState {
  const title = plainTextFromHtml(item.title);
  const rawPayload = jsonRecord(item.raw_payload);
  const preview = previewFromPayload(item.raw_payload);

  return {
    id: item.id,
    externalId: item.external_id,
    digestDate: item.digest_date,
    title,
    summary: cleanArticleSummary(item.summary, title) || title,
    source: item.source,
    sourceUrl: item.source_url,
    category: item.category,
    importanceScore: item.importance_score,
    practicalBucket: preview?.practicalBucket ?? jsonString(rawPayload.practicalBucket),
    preview,
    publishedAt: item.published_at,
    recommendedAction: jsonString(rawPayload.recommendedAction),
    readAt: state?.read_at ?? null,
    savedAt: state?.saved_at ?? null,
    archivedAt: state?.archived_at ?? null,
    scoreComponents: scoreComponentsFromPayload(item.raw_payload),
    feedback,
    whyInteresting: jsonString(rawPayload.whyInteresting),
  };
}

export async function getReaderNewsItems(userId: string): Promise<NewsItemWithState[]> {
  const supabase = createSupabaseAdminClient();

  const [
    { data: items, error: itemError },
    { data: states, error: stateError },
    { data: feedback, error: feedbackError },
  ] = await Promise.all([
    supabase
      .from("news_items")
      .select(NEWS_ITEM_COLUMNS)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("digest_date", { ascending: false })
      .limit(100),
    supabase
      .from("reader_item_states")
      .select("news_item_id, read_at, saved_at, archived_at")
      .eq("user_id", userId),
    supabase
      .from("reader_item_feedback")
      .select("news_item_id, sentiment")
      .eq("user_id", userId),
  ]);

  if (itemError) {
    throw itemError;
  }
  if (stateError) {
    throw stateError;
  }
  if (feedbackError && !isReaderFeedbackSchemaError(feedbackError)) {
    throw feedbackError;
  }

  const statesByItemId = new Map((states || []).map((state) => [state.news_item_id, state]));
  const feedbackByItemId = new Map(feedbackError ? [] : (feedback || []).map((row) => [row.news_item_id, row.sentiment]));

  return (items || []).map((item) => {
    const state = statesByItemId.get(item.id);
    return newsItemWithState(item, state, feedbackByItemId.get(item.id) ?? null);
  });
}

export async function getReaderNewsItem(itemId: string, userId: string): Promise<NewsItemWithState | null> {
  const supabase = createSupabaseAdminClient();

  const [
    { data: item, error: itemError },
    { data: state, error: stateError },
    { data: feedback, error: feedbackError },
  ] = await Promise.all([
    supabase
      .from("news_items")
      .select(NEWS_ITEM_COLUMNS)
      .eq("id", itemId)
      .single(),
    supabase
      .from("reader_item_states")
      .select("news_item_id, read_at, saved_at, archived_at")
      .eq("user_id", userId)
      .eq("news_item_id", itemId)
      .maybeSingle(),
    supabase
      .from("reader_item_feedback")
      .select("news_item_id, sentiment")
      .eq("user_id", userId)
      .eq("news_item_id", itemId)
      .maybeSingle(),
  ]);

  if (itemError) {
    if (itemError.code === "PGRST116") {
      return null;
    }
    throw itemError;
  }
  if (stateError) {
    throw stateError;
  }
  if (feedbackError && !isReaderFeedbackSchemaError(feedbackError)) {
    throw feedbackError;
  }

  return newsItemWithState(item, state, feedbackError ? null : feedback?.sentiment ?? null);
}

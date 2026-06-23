import "server-only";

import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";
import { cleanArticleSummary, plainTextFromHtml } from "./text";
import { isReaderFeedbackSchemaError, type FeedbackSentiment } from "./reader-feedback";

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
  publishedAt: string | null;
  readAt: string | null;
  savedAt: string | null;
  archivedAt: string | null;
  feedback: FeedbackSentiment | null;
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
>;
type ReaderItemStateRow = Pick<
  Database["public"]["Tables"]["reader_item_states"]["Row"],
  "read_at" | "saved_at" | "archived_at"
>;

const NEWS_ITEM_COLUMNS =
  "id, external_id, digest_date, title, summary, source, source_url, category, importance_score, published_at";

function newsItemWithState(
  item: NewsItemRow,
  state: ReaderItemStateRow | null | undefined,
  feedback: FeedbackSentiment | null,
): NewsItemWithState {
  const title = plainTextFromHtml(item.title);

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
    publishedAt: item.published_at,
    readAt: state?.read_at ?? null,
    savedAt: state?.saved_at ?? null,
    archivedAt: state?.archived_at ?? null,
    feedback,
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

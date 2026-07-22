import "server-only";

import type { Database, Json } from "./database.types";
import { selectCachedArticle, type CachedArticle } from "./cached-article";
import { createSupabaseAdminClient } from "./supabase";
import { cleanArticleSummary, plainTextFromHtml } from "./text";
import {
  isReaderFeedbackSchemaError,
  type FeedbackReason,
  type FeedbackSentiment,
} from "./reader-feedback";
import { getReaderNoteCount, getReaderNoteCounts } from "./reader-notes";

export type NewsItemPreview = {
  clickIf: string;
  practicalBucket: string;
  whatHappened: string;
  whyItMatters: string;
};

export type NewsSourceVariant = {
  articleId: string;
  name: string;
  priority: number;
  publishedAt: string | null;
  readerSourceId: string | null;
  sourceFeedUrl: string | null;
  url: string;
};

export type StoryUpdate = {
  changedFields: string[];
  createdAt: string;
  digestRunId: string;
  snapshot: Record<string, Json | undefined>;
};

export type NewsItemWithState = {
  id: string;
  storyClusterId: string | null;
  externalId: string;
  digestDate: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  category: string;
  importanceScore: number | null;
  editorialScore: number;
  selectionScore: number;
  firstSelectedAt: string | null;
  lastSelectedAt: string | null;
  lastMaterialChangeAt: string | null;
  changedFields: string[];
  sourceCount: number;
  sourceVariants: NewsSourceVariant[];
  topicTags: string[];
  entityTags: string[];
  updateHistory: StoryUpdate[];
  practicalBucket: string | null;
  preview: NewsItemPreview | null;
  publishedAt: string | null;
  recommendedAction: string | null;
  readAt: string | null;
  savedAt: string | null;
  archivedAt: string | null;
  scoreComponents: Record<string, string | number | boolean>;
  feedback: FeedbackSentiment | null;
  feedbackReason: FeedbackReason | null;
  whyInteresting: string | null;
  noteCount: number;
  cachedArticle?: CachedArticle | null;
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
  | "story_cluster_id"
  | "editorial_score"
  | "selection_score"
  | "first_selected_at"
  | "last_selected_at"
  | "last_material_change_at"
  | "changed_fields"
  | "source_count"
  | "source_variants"
  | "topic_tags"
  | "entity_tags"
  | "published_at"
  | "raw_payload"
>;
type ReaderItemStateRow = Pick<
  Database["public"]["Tables"]["reader_item_states"]["Row"],
  "read_at" | "saved_at" | "archived_at"
>;

const NEWS_ITEM_COLUMNS =
  "id, external_id, digest_date, title, summary, source, source_url, category, importance_score, story_cluster_id, editorial_score, selection_score, first_selected_at, last_selected_at, last_material_change_at, changed_fields, source_count, source_variants, topic_tags, entity_tags, published_at, raw_payload";

const CACHED_ARTICLE_COLUMNS =
  "id, canonical_url, source, raw_summary, enriched_text, enriched_word_count, enriched_fetched_at, content_mode";

async function cachedArticleForNewsItem(item: NewsItemRow) {
  const supabase = createSupabaseAdminClient();
  const variantIds = sourceVariantsFromJson(item.source_variants).map((variant) => variant.articleId);
  const candidates = variantIds.length
    ? await supabase.from("articles").select(CACHED_ARTICLE_COLUMNS).in("id", variantIds)
    : await supabase.from("articles").select(CACHED_ARTICLE_COLUMNS).eq("canonical_url", item.source_url).limit(1);

  if (candidates.error) throw candidates.error;

  return selectCachedArticle(candidates.data || [], item.source_url);
}

function jsonRecord(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonString(value: Json | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonStringList(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function sourceVariantsFromJson(value: Json): NewsSourceVariant[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const record = jsonRecord(entry);
    const articleId = jsonString(record.articleId);
    const name = jsonString(record.name);
    const url = jsonString(record.url);
    const priority = typeof record.priority === "number" ? record.priority : 0;
    const publishedAt = jsonString(record.publishedAt);
    const readerSourceId = jsonString(record.readerSourceId);
    const sourceFeedUrl = jsonString(record.sourceFeedUrl);

    return articleId && name && url
      ? [{ articleId, name, priority, publishedAt, readerSourceId, sourceFeedUrl, url }]
      : [];
  });
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
  feedback: { reason: FeedbackReason; sentiment: FeedbackSentiment } | null,
  options: { noteCount?: number; updateHistory?: StoryUpdate[] } = {},
): NewsItemWithState {
  const { noteCount = 0, updateHistory = [] } = options;
  const title = plainTextFromHtml(item.title);
  const rawPayload = jsonRecord(item.raw_payload);
  const preview = previewFromPayload(item.raw_payload);

  return {
    id: item.id,
    storyClusterId: item.story_cluster_id,
    externalId: item.external_id,
    digestDate: item.digest_date,
    title,
    summary: cleanArticleSummary(item.summary, title) || title,
    source: item.source,
    sourceUrl: item.source_url,
    category: item.category,
    importanceScore: item.importance_score,
    editorialScore: item.editorial_score,
    selectionScore: item.selection_score,
    firstSelectedAt: item.first_selected_at,
    lastSelectedAt: item.last_selected_at,
    lastMaterialChangeAt: item.last_material_change_at,
    changedFields: jsonStringList(item.changed_fields),
    sourceCount: item.source_count,
    sourceVariants: sourceVariantsFromJson(item.source_variants),
    topicTags: jsonStringList(item.topic_tags),
    entityTags: jsonStringList(item.entity_tags),
    updateHistory,
    practicalBucket: preview?.practicalBucket ?? jsonString(rawPayload.practicalBucket),
    preview,
    publishedAt: item.published_at,
    recommendedAction: jsonString(rawPayload.recommendedAction),
    readAt: state?.read_at ?? null,
    savedAt: state?.saved_at ?? null,
    archivedAt: state?.archived_at ?? null,
    scoreComponents: scoreComponentsFromPayload(item.raw_payload),
    feedback: feedback?.sentiment ?? null,
    feedbackReason: feedback?.reason ?? null,
    whyInteresting: jsonString(rawPayload.whyInteresting),
    noteCount,
  };
}

export async function getReaderNewsItems(userId: string): Promise<NewsItemWithState[]> {
  const supabase = createSupabaseAdminClient();

  const [
    { data: items, error: itemError },
    { data: states, error: stateError },
    { data: storyFeedback, error: storyFeedbackError },
    { data: legacyFeedback, error: legacyFeedbackError },
    noteCounts,
  ] = await Promise.all([
    supabase
      .from("news_items")
      .select(NEWS_ITEM_COLUMNS)
      .order("last_selected_at", { ascending: false, nullsFirst: false })
      .order("digest_date", { ascending: false })
      .limit(500),
    supabase
      .from("reader_item_states")
      .select("news_item_id, read_at, saved_at, archived_at")
      .eq("user_id", userId),
    supabase
      .from("reader_story_feedback")
      .select("story_cluster_id, sentiment, reason")
      .eq("user_id", userId),
    supabase.from("reader_item_feedback").select("news_item_id, sentiment").eq("user_id", userId),
    getReaderNoteCounts(userId),
  ]);

  if (itemError) {
    throw itemError;
  }
  if (stateError) {
    throw stateError;
  }
  if (storyFeedbackError && !isReaderFeedbackSchemaError(storyFeedbackError)) throw storyFeedbackError;
  if (legacyFeedbackError && !isReaderFeedbackSchemaError(legacyFeedbackError)) throw legacyFeedbackError;

  const statesByItemId = new Map((states || []).map((state) => [state.news_item_id, state]));
  const storyFeedbackByClusterId = new Map(
    storyFeedbackError ? [] : (storyFeedback || []).map((row) => [row.story_cluster_id, row]),
  );
  const legacyFeedbackByItemId = new Map(
    legacyFeedbackError ? [] : (legacyFeedback || []).map((row) => [row.news_item_id, row.sentiment]),
  );

  return (items || []).map((item) => {
    const state = statesByItemId.get(item.id);
    const durableFeedback = item.story_cluster_id ? storyFeedbackByClusterId.get(item.story_cluster_id) : null;
    const legacySentiment = legacyFeedbackByItemId.get(item.id);
    return newsItemWithState(
      item,
      state,
      durableFeedback
        ? { reason: durableFeedback.reason, sentiment: durableFeedback.sentiment }
        : legacySentiment
          ? { reason: "topic", sentiment: legacySentiment }
          : null,
      { noteCount: noteCounts.get(item.id) || 0 },
    );
  });
}

export async function getReaderNewsItem(itemId: string, userId: string): Promise<NewsItemWithState | null> {
  const supabase = createSupabaseAdminClient();

  const [
    { data: item, error: itemError },
    { data: state, error: stateError },
    { data: legacyFeedback, error: legacyFeedbackError },
    noteCount,
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
    getReaderNoteCount(userId, itemId),
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
  if (legacyFeedbackError && !isReaderFeedbackSchemaError(legacyFeedbackError)) throw legacyFeedbackError;

  const [
    { data: storyFeedback, error: storyFeedbackError },
    { data: updates, error: updatesError },
    cachedArticle,
  ] = item.story_cluster_id
    ? await Promise.all([
        supabase
          .from("reader_story_feedback")
          .select("story_cluster_id, sentiment, reason")
          .eq("user_id", userId)
          .eq("story_cluster_id", item.story_cluster_id)
          .maybeSingle(),
        supabase
        .from("story_updates")
        .select("digest_run_id, changed_fields, snapshot, created_at")
        .eq("story_cluster_id", item.story_cluster_id)
        .order("created_at", { ascending: false })
        .limit(20),
        cachedArticleForNewsItem(item),
      ])
    : [{ data: null, error: null }, { data: [], error: null }, await cachedArticleForNewsItem(item)];

  if (storyFeedbackError && !isReaderFeedbackSchemaError(storyFeedbackError)) throw storyFeedbackError;
  if (updatesError && !isReaderFeedbackSchemaError(updatesError)) throw updatesError;

  const updateHistory: StoryUpdate[] = (updates || []).map((update) => ({
    changedFields: jsonStringList(update.changed_fields),
    createdAt: update.created_at,
    digestRunId: update.digest_run_id,
    snapshot: jsonRecord(update.snapshot),
  }));

  const feedback = !storyFeedbackError && storyFeedback
    ? { reason: storyFeedback.reason, sentiment: storyFeedback.sentiment }
    : !legacyFeedbackError && legacyFeedback?.sentiment
      ? { reason: "topic" as const, sentiment: legacyFeedback.sentiment }
      : null;

  return {
    ...newsItemWithState(item, state, feedback, { noteCount, updateHistory }),
    cachedArticle,
  };
}

import "server-only";

import type { Database, Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

const EVENT_TYPES = new Set(["impression", "fast_read", "source_open", "read", "save", "archive", "feedback"]);
const SORT_MODES = new Set(["for-you", "top", "latest"]);
const INTERACTION_ORIGINS = new Set(["direct", "bulk", "automatic"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_BATCH_SIZE = 100;
const MAX_JSON_LENGTH = 5_000;
const MAX_REASON_COUNT = 20;
const MAX_REASON_LENGTH = 200;

export type FeedEventInput = {
  eventType: Database["public"]["Tables"]["reader_feed_events"]["Row"]["event_type"];
  feed?: string | null;
  interactionOrigin?: Database["public"]["Tables"]["reader_feed_events"]["Row"]["interaction_origin"];
  isExploration?: boolean | null;
  metadata?: Json;
  modelRank?: number | null;
  newsItemId?: string | null;
  policyVersion?: string | null;
  rank?: number | null;
  rankingContextId?: string | null;
  rankScore?: number | null;
  recommendationReasons?: string[] | null;
  scoreComponents?: Record<string, Json | undefined> | null;
  sessionId: string;
  sortMode?: Database["public"]["Tables"]["reader_feed_events"]["Row"]["sort_mode"];
  storyClusterId?: string | null;
};

function isUuidOrEmpty(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isNullableNonNegativeInteger(value: unknown) {
  return value === undefined || value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isNullableFiniteNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function serializedLength(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : serialized.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isJsonObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validRecommendationReasons(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) &&
      value.length <= MAX_REASON_COUNT &&
      value.every((reason) => typeof reason === "string" && reason.length > 0 && reason.length <= MAX_REASON_LENGTH) &&
      serializedLength(value) <= MAX_JSON_LENGTH)
  );
}

function isFeedEventInput(value: unknown): value is FeedEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const metadataIsValid = event.metadata === undefined || serializedLength(event.metadata) <= MAX_JSON_LENGTH;
  const scoreComponentsAreValid =
    event.scoreComponents === undefined ||
    event.scoreComponents === null ||
    (isJsonObject(event.scoreComponents) && serializedLength(event.scoreComponents) <= MAX_JSON_LENGTH);

  return (
    typeof event.eventType === "string" &&
    EVENT_TYPES.has(event.eventType) &&
    typeof event.sessionId === "string" &&
    UUID_PATTERN.test(event.sessionId) &&
    isUuidOrEmpty(event.newsItemId) &&
    isUuidOrEmpty(event.storyClusterId) &&
    isUuidOrEmpty(event.rankingContextId) &&
    isNullableNonNegativeInteger(event.rank) &&
    isNullableNonNegativeInteger(event.modelRank) &&
    isNullableFiniteNumber(event.rankScore) &&
    (event.feed === undefined || event.feed === null || (typeof event.feed === "string" && event.feed.length <= 100)) &&
    (event.sortMode === undefined || event.sortMode === null || (typeof event.sortMode === "string" && SORT_MODES.has(event.sortMode))) &&
    (event.policyVersion === undefined ||
      event.policyVersion === null ||
      (typeof event.policyVersion === "string" && event.policyVersion.length >= 1 && event.policyVersion.length <= 100)) &&
    (event.isExploration === undefined || event.isExploration === null || typeof event.isExploration === "boolean") &&
    (event.interactionOrigin === undefined ||
      event.interactionOrigin === null ||
      (typeof event.interactionOrigin === "string" && INTERACTION_ORIGINS.has(event.interactionOrigin))) &&
    metadataIsValid &&
    scoreComponentsAreValid &&
    validRecommendationReasons(event.recommendationReasons)
  );
}

export function parseFeedEventBatch(value: unknown): FeedEventInput[] | null {
  return Array.isArray(value) && value.length <= MAX_EVENT_BATCH_SIZE && value.every(isFeedEventInput)
    ? value
    : null;
}

function impressionKey(userId: string, event: FeedEventInput) {
  if (event.eventType !== "impression" || !event.rankingContextId || !event.storyClusterId) return null;
  return `${userId}:${event.rankingContextId}:${event.storyClusterId}`;
}

export async function recordFeedEvents(userId: string, events: FeedEventInput[]) {
  const supabase = createSupabaseAdminClient();
  const rows: Database["public"]["Tables"]["reader_feed_events"]["Insert"][] = events.slice(0, 100).map((event) => ({
    event_type: event.eventType,
    feed: event.feed || null,
    impression_key: impressionKey(userId, event),
    interaction_origin: event.interactionOrigin || null,
    is_exploration: event.isExploration ?? null,
    metadata: event.metadata || {},
    model_rank: event.modelRank ?? null,
    news_item_id: event.newsItemId || null,
    policy_version: event.policyVersion || null,
    rank: event.rank ?? null,
    rank_score: event.rankScore ?? null,
    ranking_context_id: event.rankingContextId || null,
    recommendation_reasons: event.recommendationReasons ?? null,
    score_components: event.scoreComponents ?? null,
    session_id: event.sessionId,
    sort_mode: event.sortMode || null,
    story_cluster_id: event.storyClusterId || null,
    user_id: userId,
  }));

  if (!rows.length) return;
  const { error } = await supabase
    .from("reader_feed_events")
    .upsert(rows, { ignoreDuplicates: true, onConflict: "impression_key" });
  if (error) throw error;
  const { recordBehavioralPreferenceSignals } = await import("./preference-signals");
  await recordBehavioralPreferenceSignals(userId, events);
}

type InsightEvent = Pick<
  Database["public"]["Tables"]["reader_feed_events"]["Row"],
  | "event_type"
  | "interaction_origin"
  | "policy_version"
  | "rank"
  | "ranking_context_id"
  | "story_cluster_id"
>;

export function buildReaderFeedInsightMetrics(rows: InsightEvent[]) {
  const isDirect = (event: InsightEvent) =>
    event.interaction_origin === null || event.interaction_origin === "direct";
  const decisionKey = (event: InsightEvent) =>
    event.ranking_context_id && event.story_cluster_id && event.policy_version
      ? `${event.ranking_context_id}:${event.story_cluster_id}:${event.policy_version}`
      : null;
  const exposures = new Map<string, InsightEvent>();

  for (const event of rows) {
    const key = decisionKey(event);
    if (event.event_type === "impression" && key && isDirect(event)) exposures.set(key, event);
  }

  const openKeys = new Set<string>();
  const saveKeys = new Set<string>();
  const feedbackKeys = new Set<string>();
  let unattributedOutcomeCount = 0;

  for (const event of rows) {
    if (!isDirect(event) || !["fast_read", "source_open", "save", "feedback"].includes(event.event_type)) continue;
    const key = decisionKey(event);
    if (!key || !exposures.has(key)) {
      unattributedOutcomeCount += 1;
      continue;
    }
    if (event.event_type === "fast_read" || event.event_type === "source_open") openKeys.add(key);
    if (event.event_type === "save") saveKeys.add(key);
    if (event.event_type === "feedback") feedbackKeys.add(key);
  }

  const rankEngagement = new Map<string, { impressions: number; opens: number }>();
  for (const [key, exposure] of exposures) {
    if (exposure.rank === null) continue;
    const bucket = exposure.rank < 5 ? "1–5" : exposure.rank < 10 ? "6–10" : "11+";
    const current = rankEngagement.get(bucket) || { impressions: 0, opens: 0 };
    current.impressions += 1;
    if (openKeys.has(key)) current.opens += 1;
    rankEngagement.set(bucket, current);
  }

  const policyCounts = new Map<string, number>();
  for (const exposure of exposures.values()) {
    const policy = exposure.policy_version!;
    policyCounts.set(policy, (policyCounts.get(policy) || 0) + 1);
  }
  const impressions = exposures.size;

  return {
    feedbackRate: impressions ? feedbackKeys.size / impressions : 0,
    impressions,
    legacyEventCount: rows.filter((event) => !decisionKey(event)).length,
    openRate: impressions ? openKeys.size / impressions : 0,
    policyExposureCounts: [...policyCounts].map(([policyVersion, count]) => ({ count, policyVersion })),
    rankEngagement: [...rankEngagement].map(([bucket, values]) => ({ bucket, ...values })),
    saveRate: impressions ? saveKeys.size / impressions : 0,
    unattributedOutcomeCount,
  };
}

export async function getReaderFeedInsights(userId: string) {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const [{ data: events, error: eventError }, { data: feedback, error: feedbackError }] = await Promise.all([
    supabase
      .from("reader_feed_events")
      .select("event_type, interaction_origin, policy_version, rank, ranking_context_id, story_cluster_id")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("reader_story_feedback")
      .select("story_cluster_id, sentiment, reason")
      .eq("user_id", userId)
      .eq("sentiment", "less")
      .limit(500),
  ]);

  if (eventError) throw eventError;
  if (feedbackError) throw feedbackError;

  const rows = events || [];
  const metrics = buildReaderFeedInsightMetrics(rows);

  const clusterIds = (feedback || []).map((row) => row.story_cluster_id);
  const { data: ignoredClusters, error: clusterError } = clusterIds.length
    ? await supabase.from("story_clusters").select("id, source, category").in("id", clusterIds)
    : { data: [], error: null };
  if (clusterError) throw clusterError;

  const unreadCutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: olderItems, error: olderItemsError } = await supabase
    .from("news_items")
    .select("id")
    .lt("last_selected_at", unreadCutoff)
    .limit(1000);
  if (olderItemsError) throw olderItemsError;
  const olderItemIds = (olderItems || []).map((item) => item.id);
  const { data: readStates, error: readStateError } = olderItemIds.length
    ? await supabase
        .from("reader_item_states")
        .select("news_item_id, read_at, archived_at")
        .eq("user_id", userId)
        .in("news_item_id", olderItemIds)
    : { data: [], error: null };
  if (readStateError) throw readStateError;
  const clearedIds = new Set(
    (readStates || []).filter((state) => state.read_at || state.archived_at).map((state) => state.news_item_id),
  );

  const frequency = (values: string[]) =>
    [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>())]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value }));

  return {
    ...metrics,
    ignoredSources: frequency((ignoredClusters || []).map((cluster) => cluster.source)),
    ignoredTopics: frequency((ignoredClusters || []).map((cluster) => cluster.category)),
    unreadAfter24Hours: olderItemIds.filter((id) => !clearedIds.has(id)).length,
  };
}

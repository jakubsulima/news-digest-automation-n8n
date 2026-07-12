import "server-only";

import type { Database, Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type FeedEventInput = {
  eventType: Database["public"]["Tables"]["reader_feed_events"]["Row"]["event_type"];
  feed?: string | null;
  metadata?: Json;
  newsItemId?: string | null;
  rank?: number | null;
  sessionId: string;
  sortMode?: Database["public"]["Tables"]["reader_feed_events"]["Row"]["sort_mode"];
  storyClusterId?: string | null;
};

export async function recordFeedEvents(userId: string, events: FeedEventInput[]) {
  const supabase = createSupabaseAdminClient();
  const rows: Database["public"]["Tables"]["reader_feed_events"]["Insert"][] = events.slice(0, 100).map((event) => ({
    event_type: event.eventType,
    feed: event.feed || null,
    metadata: event.metadata || {},
    news_item_id: event.newsItemId || null,
    rank: event.rank ?? null,
    session_id: event.sessionId,
    sort_mode: event.sortMode || null,
    story_cluster_id: event.storyClusterId || null,
    user_id: userId,
  }));

  if (!rows.length) return;
  const { error } = await supabase.from("reader_feed_events").insert(rows);
  if (error) throw error;
}

export async function getReaderFeedInsights(userId: string) {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const [{ data: events, error: eventError }, { data: feedback, error: feedbackError }] = await Promise.all([
    supabase
      .from("reader_feed_events")
      .select("event_type, rank, story_cluster_id")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
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
  const impressions = rows.filter((event) => event.event_type === "impression").length;
  const count = (eventType: string) => rows.filter((event) => event.event_type === eventType).length;
  const rankEngagement = new Map<string, { impressions: number; opens: number }>();

  for (const event of rows) {
    if (event.rank === null) continue;
    const bucket = event.rank < 5 ? "1–5" : event.rank < 10 ? "6–10" : "11+";
    const current = rankEngagement.get(bucket) || { impressions: 0, opens: 0 };
    if (event.event_type === "impression") current.impressions += 1;
    if (event.event_type === "fast_read" || event.event_type === "source_open") current.opens += 1;
    rankEngagement.set(bucket, current);
  }

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
    feedbackRate: impressions ? count("feedback") / impressions : 0,
    ignoredSources: frequency((ignoredClusters || []).map((cluster) => cluster.source)),
    ignoredTopics: frequency((ignoredClusters || []).map((cluster) => cluster.category)),
    impressions,
    openRate: impressions ? (count("fast_read") + count("source_open")) / impressions : 0,
    rankEngagement: [...rankEngagement].map(([bucket, values]) => ({ bucket, ...values })),
    saveRate: impressions ? count("save") / impressions : 0,
    unreadAfter24Hours: olderItemIds.filter((id) => !clearedIds.has(id)).length,
  };
}

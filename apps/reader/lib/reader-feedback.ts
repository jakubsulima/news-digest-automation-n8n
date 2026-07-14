import "server-only";

import { createSupabaseAdminClient } from "./supabase";
import { plainTextFromHtml } from "./text";
import {
  buildFeedbackProfile,
  type FeedbackProfile,
  type FeedbackReason,
  type FeedbackSentiment,
} from "./reader-feedback-scoring";

export {
  buildFeedbackProfile,
  extractFeedbackKeywords,
  feedbackScoreAdjustment,
  parseFeedbackReason,
  parseFeedbackSentiment,
} from "./reader-feedback-scoring";
export type { FeedbackBasis, FeedbackProfile, FeedbackReason, FeedbackSentiment } from "./reader-feedback-scoring";
type SupabaseError = {
  code?: string;
  message?: string;
};

export function isReaderFeedbackSchemaError(error: unknown) {
  const supabaseError = error && typeof error === "object" ? (error as SupabaseError) : {};

  return (
    supabaseError.code === "42P01" ||
    supabaseError.code === "42703" ||
    supabaseError.code === "PGRST204" ||
    supabaseError.code === "PGRST205" ||
    Boolean(supabaseError.message?.toLowerCase().includes("reader_item_feedback")) ||
    Boolean(supabaseError.message?.toLowerCase().includes("reader_story_feedback")) ||
    Boolean(supabaseError.message?.toLowerCase().includes("schema cache"))
  );
}

const IMPLICIT_EVENT_WEIGHTS = {
  fast_read: 0.5,
  read: 1.25,
  save: 2,
  source_open: 0.75,
} as const;
const IMPLICIT_EVENT_TYPES = Object.keys(IMPLICIT_EVENT_WEIGHTS) as Array<keyof typeof IMPLICIT_EVENT_WEIGHTS>;
const IMPLICIT_COLD_START_STORIES = 5;

export async function getFeedbackProfileForUser(
  userId: string | null,
  options: { includeImplicit?: boolean } = {},
): Promise<FeedbackProfile> {
  if (!userId) {
    return buildFeedbackProfile([]);
  }

  const supabase = createSupabaseAdminClient();
  const { data: storyFeedbackRows, error: storyFeedbackError } = await supabase
    .from("reader_story_feedback")
    .select("story_cluster_id, sentiment, reason, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (!storyFeedbackError) {
    const storyFeedback = storyFeedbackRows || [];
    const clusterIds = storyFeedback.map((row) => row.story_cluster_id);
    const explicitBasis = [] as Parameters<typeof buildFeedbackProfile>[0];

    if (clusterIds.length) {
      const { data: clusters, error: clusterError } = await supabase
        .from("story_clusters")
        .select("id, canonical_title, latest_summary, source, category")
        .in("id", clusterIds);

      if (clusterError) throw clusterError;

      const feedbackByClusterId = new Map(storyFeedback.map((row) => [row.story_cluster_id, row]));
      explicitBasis.push(
        ...(clusters || []).flatMap((cluster) => {
          const feedback = feedbackByClusterId.get(cluster.id);
          if (!feedback) return [];

          return [{
            category: cluster.category,
            origin: "explicit" as const,
            reason: feedback.reason,
            sentiment: feedback.sentiment,
            source: cluster.source,
            storyClusterId: cluster.id,
            summary: plainTextFromHtml(cluster.latest_summary),
            title: plainTextFromHtml(cluster.canonical_title),
            updatedAt: feedback.updated_at,
          }];
        }),
      );
    }

    if (!options.includeImplicit) {
      return buildFeedbackProfile(explicitBasis);
    }

    const { data: eventRows, error: eventError } = await supabase
      .from("reader_feed_events")
      .select("session_id, story_cluster_id, event_type, created_at")
      .eq("user_id", userId)
      .in("event_type", IMPLICIT_EVENT_TYPES)
      .not("story_cluster_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1_000);

    if (eventError) throw eventError;
    const strongestBySessionStory = new Map<string, NonNullable<typeof eventRows>[number]>();

    for (const event of eventRows || []) {
      if (!event.story_cluster_id || !(event.event_type in IMPLICIT_EVENT_WEIGHTS)) continue;
      const key = `${event.session_id}:${event.story_cluster_id}`;
      const existing = strongestBySessionStory.get(key);
      const weight = IMPLICIT_EVENT_WEIGHTS[event.event_type as keyof typeof IMPLICIT_EVENT_WEIGHTS];
      const existingWeight = existing
        ? IMPLICIT_EVENT_WEIGHTS[existing.event_type as keyof typeof IMPLICIT_EVENT_WEIGHTS]
        : -1;
      if (!existing || weight > existingWeight) strongestBySessionStory.set(key, event);
    }

    const cappedByDayStory = new Map<string, NonNullable<typeof eventRows>[number]>();
    for (const event of strongestBySessionStory.values()) {
      if (!event.story_cluster_id) continue;
      const key = `${event.created_at.slice(0, 10)}:${event.story_cluster_id}`;
      const existing = cappedByDayStory.get(key);
      const weight = IMPLICIT_EVENT_WEIGHTS[event.event_type as keyof typeof IMPLICIT_EVENT_WEIGHTS];
      const existingWeight = existing
        ? IMPLICIT_EVENT_WEIGHTS[existing.event_type as keyof typeof IMPLICIT_EVENT_WEIGHTS]
        : -1;
      if (!existing || weight > existingWeight) cappedByDayStory.set(key, event);
    }

    const implicitEvents = [...cappedByDayStory.values()];
    const implicitClusterIds = [...new Set(implicitEvents.flatMap((event) => event.story_cluster_id ? [event.story_cluster_id] : []))];

    if (implicitClusterIds.length < IMPLICIT_COLD_START_STORIES) {
      return buildFeedbackProfile(explicitBasis);
    }

    const { data: implicitClusters, error: implicitClusterError } = await supabase
      .from("story_clusters")
      .select("id, canonical_title, latest_summary, source, category")
      .in("id", implicitClusterIds);
    if (implicitClusterError) throw implicitClusterError;
    const clustersById = new Map((implicitClusters || []).map((cluster) => [cluster.id, cluster]));
    const implicitBasis = implicitEvents.flatMap((event) => {
      const cluster = event.story_cluster_id ? clustersById.get(event.story_cluster_id) : null;
      if (!cluster || !(event.event_type in IMPLICIT_EVENT_WEIGHTS)) return [];
      return [{
        category: cluster.category,
        origin: "implicit" as const,
        sentiment: "more" as const,
        source: cluster.source,
        storyClusterId: cluster.id,
        summary: plainTextFromHtml(cluster.latest_summary),
        title: plainTextFromHtml(cluster.canonical_title),
        updatedAt: event.created_at,
        weight: IMPLICIT_EVENT_WEIGHTS[event.event_type as keyof typeof IMPLICIT_EVENT_WEIGHTS],
      }];
    });

    return buildFeedbackProfile([...explicitBasis, ...implicitBasis]);
  }

  if (!isReaderFeedbackSchemaError(storyFeedbackError)) {
    throw storyFeedbackError;
  }

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("reader_item_feedback")
    .select("news_item_id, sentiment, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (feedbackError) {
    if (isReaderFeedbackSchemaError(feedbackError)) return buildFeedbackProfile([]);
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

  const feedbackByItemId = new Map(feedback.map((row) => [row.news_item_id, row]));
  const basis = (newsItems || []).flatMap((item) => {
    const itemFeedback = feedbackByItemId.get(item.id);

    return itemFeedback
      ? [
          {
            category: item.category,
            sentiment: itemFeedback.sentiment,
            source: item.source,
            summary: plainTextFromHtml(item.summary),
            title: plainTextFromHtml(item.title),
            updatedAt: itemFeedback.updated_at,
          },
        ]
      : [];
  });

  return buildFeedbackProfile(basis);
}

function strongestPreferences(map: Map<string, { more: number; less: number }>, limit = 5) {
  return [...map]
    .map(([label, counts]) => ({ label, score: counts.more - counts.less }))
    .filter((item) => Math.abs(item.score) >= 0.2)
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
    .slice(0, limit);
}

export function summarizeFeedbackProfile(profile: FeedbackProfile) {
  return {
    evidenceCount: profile.evidenceCount,
    explicitEvidenceCount: profile.explicitEvidenceCount,
    feeds: strongestPreferences(profile.feeds),
    implicitEvidenceCount: profile.implicitEvidenceCount,
    keywords: strongestPreferences(profile.keywords),
    sources: strongestPreferences(profile.sources),
  };
}

export async function resetReaderPersonalization(userId: string) {
  const supabase = createSupabaseAdminClient();
  const results = await Promise.all([
    supabase.from("reader_story_feedback").delete().eq("user_id", userId),
    supabase.from("reader_item_feedback").delete().eq("user_id", userId),
    supabase.from("reader_feed_events").delete().eq("user_id", userId),
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

export async function setReaderItemFeedback(
  userId: string,
  newsItemId: string,
  sentiment: FeedbackSentiment | null,
  reason: FeedbackReason = "topic",
) {
  const supabase = createSupabaseAdminClient();
  const { data: newsItem, error: newsItemError } = await supabase
    .from("news_items")
    .select("story_cluster_id")
    .eq("id", newsItemId)
    .maybeSingle();

  if (newsItemError) throw newsItemError;

  if (!sentiment) {
    const legacyDelete = supabase.from("reader_item_feedback").delete().eq("user_id", userId).eq("news_item_id", newsItemId);
    const storyDelete = newsItem?.story_cluster_id
      ? supabase
          .from("reader_story_feedback")
          .delete()
          .eq("user_id", userId)
          .eq("story_cluster_id", newsItem.story_cluster_id)
      : Promise.resolve({ error: null });
    const [{ error: legacyError }, { error: storyError }] = await Promise.all([legacyDelete, storyDelete]);

    if (legacyError && !isReaderFeedbackSchemaError(legacyError)) throw legacyError;
    if (storyError && !isReaderFeedbackSchemaError(storyError)) throw storyError;
    return;
  }

  if (newsItem?.story_cluster_id) {
    const { error: storyError } = await supabase.from("reader_story_feedback").upsert(
      {
        reason,
        sentiment,
        story_cluster_id: newsItem.story_cluster_id,
        user_id: userId,
      },
      { onConflict: "story_cluster_id,user_id" },
    );

    if (storyError && !isReaderFeedbackSchemaError(storyError)) {
      throw storyError;
    }
  }

  const { error: legacyError } = await supabase.from("reader_item_feedback").upsert(
    {
      news_item_id: newsItemId,
      sentiment,
      user_id: userId,
    },
    { onConflict: "news_item_id,user_id" },
  );

  if (legacyError && !isReaderFeedbackSchemaError(legacyError)) throw legacyError;
}

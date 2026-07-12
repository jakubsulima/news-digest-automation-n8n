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

export async function getFeedbackProfileForUser(userId: string | null): Promise<FeedbackProfile> {
  if (!userId) {
    return buildFeedbackProfile([]);
  }

  const supabase = createSupabaseAdminClient();
  const { data: storyFeedbackRows, error: storyFeedbackError } = await supabase
    .from("reader_story_feedback")
    .select("story_cluster_id, sentiment, reason, updated_at")
    .eq("user_id", userId)
    .limit(500);

  if (!storyFeedbackError) {
    const storyFeedback = storyFeedbackRows || [];
    const clusterIds = storyFeedback.map((row) => row.story_cluster_id);

    if (clusterIds.length) {
      const { data: clusters, error: clusterError } = await supabase
        .from("news_items")
        .select("story_cluster_id, title, summary, source, category, topic_tags, entity_tags")
        .in("story_cluster_id", clusterIds);

      if (clusterError) throw clusterError;

      const feedbackByClusterId = new Map(storyFeedback.map((row) => [row.story_cluster_id, row]));
      return buildFeedbackProfile(
        (clusters || []).flatMap((cluster) => {
          const feedback = cluster.story_cluster_id ? feedbackByClusterId.get(cluster.story_cluster_id) : null;
          if (!feedback) return [];

          return [{
            category: cluster.category,
            entityTags: Array.isArray(cluster.entity_tags)
              ? cluster.entity_tags.filter((value): value is string => typeof value === "string")
              : [],
            reason: feedback.reason,
            sentiment: feedback.sentiment,
            source: cluster.source,
            storyClusterId: cluster.story_cluster_id || undefined,
            summary: plainTextFromHtml(cluster.summary),
            title: plainTextFromHtml(cluster.title),
            topicTags: Array.isArray(cluster.topic_tags)
              ? cluster.topic_tags.filter((value): value is string => typeof value === "string")
              : [],
            updatedAt: feedback.updated_at,
          }];
        }),
      );
    }

    return buildFeedbackProfile([]);
  }

  if (!isReaderFeedbackSchemaError(storyFeedbackError)) {
    throw storyFeedbackError;
  }

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("reader_item_feedback")
    .select("news_item_id, sentiment, updated_at")
    .eq("user_id", userId)
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

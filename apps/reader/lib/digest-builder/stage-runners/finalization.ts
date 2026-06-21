import "server-only";

import { createSupabaseAdminClient } from "../../supabase";
import type { StageRunner } from "../types";
import { throwDatabaseError } from "../utils";

export const runFinalizationStage: StageRunner = async ({ digestRunId }) => {
  const supabase = createSupabaseAdminClient();
  const { count: sourceItemCount, error: sourceError } = await supabase
    .from("source_items")
    .select("id", { count: "exact", head: true })
    .eq("digest_run_id", digestRunId);
  const { count: storyCount, error: storyError } = await supabase
    .from("story_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("digest_run_id", digestRunId);
  const { count: enrichmentRecordCount, error: enrichmentRecordError } = await supabase
    .from("enrichment_records")
    .select("id", { count: "exact", head: true })
    .eq("digest_run_id", digestRunId);
  const { count: publishedCount, error: publishedError } = await supabase
    .from("news_items")
    .select("id", { count: "exact", head: true })
    .contains("raw_payload", { digestRunId });
  const { data: enrichedArticles, error: enrichedArticlesError } = await supabase
    .from("enrichment_records")
    .select("article_id")
    .eq("digest_run_id", digestRunId);

  if (sourceError) {
    throw sourceError;
  }
  if (storyError) {
    throw storyError;
  }
  if (enrichmentRecordError) {
    throw enrichmentRecordError;
  }
  if (publishedError) {
    throw publishedError;
  }
  if (enrichedArticlesError) {
    throw enrichedArticlesError;
  }

  const enrichedArticleIds = Array.from(new Set((enrichedArticles || []).map((record) => record.article_id)));

  if (enrichedArticleIds.length) {
    const { error: articleTextCleanupError } = await supabase
      .from("articles")
      .update({
        enriched_text: null,
        enriched_word_count: 0,
      })
      .in("id", enrichedArticleIds);

    if (articleTextCleanupError) {
      throwDatabaseError("cleanup enriched article text", articleTextCleanupError);
    }
  }

  const [
    { error: sourceCleanupError },
    { error: snapshotCleanupError },
    { error: enrichmentCleanupError },
  ] = await Promise.all([
    supabase.from("source_items").delete().eq("digest_run_id", digestRunId),
    supabase.from("story_snapshots").delete().eq("digest_run_id", digestRunId),
    supabase.from("enrichment_records").delete().eq("digest_run_id", digestRunId),
  ]);

  if (sourceCleanupError) {
    throwDatabaseError("cleanup source items", sourceCleanupError);
  }
  if (snapshotCleanupError) {
    throwDatabaseError("cleanup story snapshots", snapshotCleanupError);
  }
  if (enrichmentCleanupError) {
    throwDatabaseError("cleanup enrichment records", enrichmentCleanupError);
  }

  return {
    metrics: {
      cleanedEnrichmentRecordCount: enrichmentRecordCount || 0,
      cleanedEnrichedArticleTextCount: enrichedArticleIds.length,
      cleanedSourceItemCount: sourceItemCount || 0,
      cleanedStorySnapshotCount: storyCount || 0,
      enrichmentRecordCount: enrichmentRecordCount || 0,
      publishedCount: publishedCount || 0,
      sourceItemCount: sourceItemCount || 0,
      storyCount: storyCount || 0,
    },
  };
};

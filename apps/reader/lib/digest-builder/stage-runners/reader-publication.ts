import "server-only";

import type { Database, Json } from "../../database.types";
import { isDigestBriefSchemaError } from "../../digest-brief";
import { getDigestRunById } from "../../digest-runs";
import { getDigestSettingsForRun } from "../../digest-settings";
import {
  digestBriefWithNvidia,
  previewArticleWithNvidia,
  shortenSummaryWithNvidia,
  type NvidiaArticlePreview,
} from "../../ai-summary";
import { createSupabaseAdminClient } from "../../supabase";
import { cleanArticleSummary, plainTextFromHtml } from "../../text";
import { SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, compactText, jsonNumber, jsonString, jsonStringArray } from "../utils";

type NewsItemInsert = Database["public"]["Tables"]["news_items"]["Insert"];
type DigestSummaryInsert = Database["public"]["Tables"]["digest_summaries"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publishedSummary(snapshot: StorySnapshotRow) {
  return jsonString(snapshot.metadata, "summary") || jsonString(snapshot.metadata, "title") || "No summary available.";
}

function previewSummary(preview: NvidiaArticlePreview) {
  return [
    `What happened: ${preview.whatHappened}`,
    `Why it matters: ${preview.whyItMatters}`,
    `Click if: ${preview.clickIf}`,
  ].join("\n");
}

async function compactPublishedSummary({
  maxChars,
  summary,
  title,
  useAiSummaries,
}: {
  maxChars: number;
  summary: string;
  title: string;
  useAiSummaries: boolean;
}) {
  const cleanSummary = cleanArticleSummary(summary, title) || plainTextFromHtml(title);
  const fallback = compactText(cleanSummary, maxChars);

  if (!useAiSummaries || fallback.length <= maxChars * 0.75) {
    return fallback;
  }

  const aiSummary = await shortenSummaryWithNvidia({
    maxChars,
    summary: cleanSummary,
    title,
  }).catch(() => null);

  return aiSummary ? compactText(aiSummary, maxChars) : fallback;
}

const NEWS_RETENTION_DAYS = 90;
const EVENT_RETENTION_DAYS = 180;

export function readerExternalIdForStory(storyClusterId: string) {
  return `story:${storyClusterId}`;
}

export function deletableExpiredNewsItemIds(staleIds: string[], savedIds: Iterable<string>) {
  const saved = new Set(savedIds);
  return staleIds.filter((id) => !saved.has(id));
}

export function deriveTopicTags(title: string, category: string, practicalBucket: string) {
  const tags = [category, practicalBucket.replace(/_/g, " ")]
    .map((tag) => plainTextFromHtml(tag).trim().toLowerCase())
    .filter(Boolean);
  const titleKeywords = title
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => word.length >= 5)
    .slice(0, 5) || [];

  return Array.from(new Set([...tags, ...titleKeywords])).slice(0, 8);
}

export function deriveEntityTags(title: string) {
  return Array.from(
    new Set(
      title.match(/\b[\p{Lu}][\p{L}\p{N}-]{2,}(?:\s+[\p{Lu}][\p{L}\p{N}-]{2,})*/gu) || [],
    ),
  ).slice(0, 8);
}

async function cleanupExpiredReaderData() {
  const supabase = createSupabaseAdminClient();
  const newsCutoff = new Date(Date.now() - NEWS_RETENTION_DAYS * 86_400_000).toISOString();
  const eventCutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("news_items")
    .select("id")
    .lt("last_selected_at", newsCutoff)
    .limit(1000);

  if (error) {
    throw error;
  }

  const staleIds = (data || []).map((item) => item.id);
  const savedIds = new Set<string>();

  for (const staleBatch of chunk(staleIds, SUPABASE_WRITE_BATCH_SIZE)) {
    const { data: savedStates, error: savedError } = await supabase
      .from("reader_item_states")
      .select("news_item_id")
      .in("news_item_id", staleBatch)
      .not("saved_at", "is", null);

    if (savedError) throw savedError;
    for (const state of savedStates || []) savedIds.add(state.news_item_id);
  }

  const deletableIds = deletableExpiredNewsItemIds(staleIds, savedIds);

  for (const staleBatch of chunk(deletableIds, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error: deleteError } = await supabase.from("news_items").delete().in("id", staleBatch);

    if (deleteError) {
      throw deleteError;
    }
  }

  const { count: deletedEventCount, error: eventCleanupError } = await supabase
    .from("reader_feed_events")
    .delete({ count: "exact" })
    .lt("created_at", eventCutoff);

  if (eventCleanupError) throw eventCleanupError;

  return { deletedEventCount: deletedEventCount || 0, deletedNewsItemCount: deletableIds.length };
}

export const runReaderPublicationStage: StageRunner = async ({ digestRunId }) => {
  const run = await getDigestRunById(digestRunId);
  const settings = await getDigestSettingsForRun(digestRunId);

  if (!run) {
    throw new Error("Digest run not found.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: snapshots, error } = await supabase
    .from("story_snapshots")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .eq("is_selected", true)
    .order("editorial_score", { ascending: false })
    .limit(settings.publishTopN);

  if (error) {
    throw error;
  }

  const selectedSnapshots = snapshots || [];
  const clusterIds = selectedSnapshots.map((snapshot) => snapshot.story_cluster_id);
  const { data: existingItems, error: existingError } = clusterIds.length
    ? await supabase
        .from("news_items")
        .select("story_cluster_id, first_selected_at, last_material_change_at")
        .in("story_cluster_id", clusterIds)
    : { data: [], error: null };

  if (existingError) throw existingError;

  const existingByClusterId = new Map((existingItems || []).map((item) => [item.story_cluster_id, item]));

  const rows: NewsItemInsert[] = [];
  const selectedAt = new Date().toISOString();

  for (const snapshot of selectedSnapshots) {
    const canonicalUrl = jsonString(snapshot.metadata, "canonicalUrl");
    const title = jsonString(snapshot.metadata, "title") || canonicalUrl;
    const metadata = jsonRecord(snapshot.metadata);
    const scoreComponents = metadata.scoreComponents;
    const sourceVariants = Array.isArray(metadata.sourceVariants) ? metadata.sourceVariants : [];
    const changedFields = jsonStringArray(snapshot.changed_fields);
    const practicalBucket = jsonString(snapshot.metadata, "practicalBucket") || "ignore";
    const existingItem = existingByClusterId.get(snapshot.story_cluster_id);
    const sourceSummary = publishedSummary(snapshot);
    const cleanSummary = cleanArticleSummary(sourceSummary, title) || plainTextFromHtml(title);
    const preview = settings.useAiSummaries
      ? await previewArticleWithNvidia({
          summary: cleanSummary,
          title,
        })
      : null;
    const summary = preview
      ? previewSummary(preview)
      : await compactPublishedSummary({
          maxChars: settings.summaryMaxChars,
          summary: sourceSummary,
          title,
          useAiSummaries: settings.useAiSummaries,
        });

    rows.push({
      category: jsonString(snapshot.metadata, "category") || "general",
      changed_fields: changedFields,
      digest_date: run.report_date,
      editorial_score: snapshot.editorial_score,
      entity_tags: preview?.entities.length ? preview.entities : deriveEntityTags(title),
      external_id: readerExternalIdForStory(snapshot.story_cluster_id),
      first_selected_at: existingItem?.first_selected_at || selectedAt,
      importance_score: Math.max(0, Math.min(100, Math.round(snapshot.editorial_score))),
      last_material_change_at: changedFields.length
        ? selectedAt
        : existingItem?.last_material_change_at || null,
      last_selected_at: selectedAt,
      published_at: jsonString(snapshot.metadata, "publishedAt") || null,
      raw_payload: {
        digestRunId,
        practicalBucket,
        recommendedAction: jsonString(snapshot.metadata, "recommendedAction"),
        score: {
          components:
            scoreComponents && typeof scoreComponents === "object" && !Array.isArray(scoreComponents)
              ? scoreComponents
              : {},
          editorial: snapshot.editorial_score,
          importance: Math.max(0, Math.min(100, Math.round(snapshot.editorial_score))),
        },
        ...(preview ? { preview } : {}),
        storyClusterId: snapshot.story_cluster_id,
        whyInteresting: jsonString(snapshot.metadata, "whyInteresting"),
      },
      source: jsonString(snapshot.metadata, "source") || "Unknown",
      source_count: Math.max(1, sourceVariants.length || snapshot.duplicate_count),
      source_variants: sourceVariants,
      source_url: canonicalUrl,
      selection_score: jsonNumber(snapshot.metadata, "selectionScore") || jsonNumber(scoreComponents || {}, "selection") || snapshot.editorial_score,
      story_cluster_id: snapshot.story_cluster_id,
      summary,
      title: plainTextFromHtml(title),
      topic_tags: preview?.topics.length
        ? preview.topics
        : deriveTopicTags(title, jsonString(snapshot.metadata, "category") || "general", practicalBucket),
    });
  }

  if (rows.length) {
    const { error: upsertError } = await supabase.from("news_items").upsert(rows, {
      onConflict: "story_cluster_id",
    });

    if (upsertError) {
      throw upsertError;
    }
  }

  const brief = await digestBriefWithNvidia({
    articles: rows.map((row) => ({
      source: row.source,
      summary: row.summary,
      title: row.title,
    })),
  });
  const publishedItems = rows.length
    ? await supabase
        .from("news_items")
        .select("id, story_cluster_id, source, title")
        .in(
          "story_cluster_id",
          rows.flatMap((row) => (row.story_cluster_id ? [row.story_cluster_id] : [])),
        )
    : { data: [], error: null };

  if (publishedItems.error) {
    throw publishedItems.error;
  }

  const publishedItemsByClusterId = new Map((publishedItems.data || []).map((item) => [item.story_cluster_id, item]));
  const highlights = brief.highlights.flatMap((highlight) => {
    const row = rows[highlight.articleIndex];
    const item = row?.story_cluster_id ? publishedItemsByClusterId.get(row.story_cluster_id) : null;

    return item
      ? [
          {
            newsItemId: item.id,
            source: item.source,
            title: item.title,
            whyItMatters: highlight.whyItMatters,
          },
        ]
      : [];
  });
  const digestSummary: DigestSummaryInsert = {
    digest_date: run.report_date,
    digest_run_id: digestRunId,
    highlights,
    summary: brief.summary,
  };
  const { error: digestSummaryError } = await supabase.from("digest_summaries").upsert(digestSummary, {
    onConflict: "digest_run_id",
  });

  if (digestSummaryError && !isDigestBriefSchemaError(digestSummaryError)) {
    throw digestSummaryError;
  }

  const cleanup = rows.length
    ? await cleanupExpiredReaderData()
    : { deletedEventCount: 0, deletedNewsItemCount: 0 };

  return {
    metrics: {
      deletedEventCount: cleanup.deletedEventCount,
      deletedStaleCount: cleanup.deletedNewsItemCount,
      digestBriefHighlightCount: highlights.length,
      publishedCount: rows.length,
      settings: {
        publishTopN: settings.publishTopN,
        summaryMaxChars: settings.summaryMaxChars,
        useAiSummaries: settings.useAiSummaries,
      },
    },
  };
};

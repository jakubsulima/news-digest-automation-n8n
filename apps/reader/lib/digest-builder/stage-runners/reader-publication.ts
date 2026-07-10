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
import { chunk, compactText, jsonString } from "../utils";

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

async function deleteStaleNewsItems(currentExternalIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("news_items").select("id, external_id");

  if (error) {
    throw error;
  }

  const current = new Set(currentExternalIds);
  const staleIds = (data || [])
    .filter((item) => currentExternalIds.length === 0 || !current.has(item.external_id))
    .map((item) => item.id);

  for (const staleBatch of chunk(staleIds, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error: deleteError } = await supabase.from("news_items").delete().in("id", staleBatch);

    if (deleteError) {
      throw deleteError;
    }
  }

  return staleIds.length;
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

  const rows: NewsItemInsert[] = [];

  for (const snapshot of snapshots || []) {
    const canonicalUrl = jsonString(snapshot.metadata, "canonicalUrl");
    const title = jsonString(snapshot.metadata, "title") || canonicalUrl;
    const metadata = jsonRecord(snapshot.metadata);
    const scoreComponents = metadata.scoreComponents;
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
      digest_date: run.report_date,
      external_id: `${run.report_date}:${snapshot.story_cluster_id}`,
      importance_score: Math.max(0, Math.min(100, Math.round(snapshot.editorial_score))),
      published_at: jsonString(snapshot.metadata, "publishedAt") || null,
      raw_payload: {
        digestRunId,
        practicalBucket: jsonString(snapshot.metadata, "practicalBucket") || "ignore",
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
      source_url: canonicalUrl,
      summary,
      title: plainTextFromHtml(title),
    });
  }

  if (rows.length) {
    const { error: upsertError } = await supabase.from("news_items").upsert(rows, {
      onConflict: "external_id",
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
        .select("id, external_id, source, title")
        .in(
          "external_id",
          rows.map((row) => row.external_id),
        )
    : { data: [], error: null };

  if (publishedItems.error) {
    throw publishedItems.error;
  }

  const publishedItemsByExternalId = new Map((publishedItems.data || []).map((item) => [item.external_id, item]));
  const highlights = brief.highlights.flatMap((highlight) => {
    const row = rows[highlight.articleIndex];
    const item = row ? publishedItemsByExternalId.get(row.external_id) : null;

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

  const deletedStaleCount = await deleteStaleNewsItems(rows.map((row) => row.external_id));

  return {
    metrics: {
      deletedStaleCount,
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

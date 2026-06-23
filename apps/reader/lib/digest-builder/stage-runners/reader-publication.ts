import "server-only";

import type { Database } from "../../database.types";
import { getDigestRunById } from "../../digest-runs";
import { getDigestSettingsForRun } from "../../digest-settings";
import { shortenSummaryWithNvidia } from "../../ai-summary";
import { createSupabaseAdminClient } from "../../supabase";
import { cleanArticleSummary, plainTextFromHtml } from "../../text";
import { SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, compactText, jsonString } from "../utils";

type NewsItemInsert = Database["public"]["Tables"]["news_items"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

function publishedSummary(snapshot: StorySnapshotRow) {
  return jsonString(snapshot.metadata, "summary") || jsonString(snapshot.metadata, "title") || "No summary available.";
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
    const summary = await compactPublishedSummary({
      maxChars: settings.summaryMaxChars,
      summary: publishedSummary(snapshot),
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
        storyClusterId: snapshot.story_cluster_id,
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

  const deletedStaleCount = await deleteStaleNewsItems(rows.map((row) => row.external_id));

  return {
    metrics: {
      deletedStaleCount,
      publishedCount: rows.length,
      settings: {
        publishTopN: settings.publishTopN,
        summaryMaxChars: settings.summaryMaxChars,
        useAiSummaries: settings.useAiSummaries,
      },
    },
  };
};

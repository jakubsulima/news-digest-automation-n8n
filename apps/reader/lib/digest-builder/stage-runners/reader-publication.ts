import "server-only";

import type { Database } from "../../database.types";
import { getDigestRunById } from "../../digest-runs";
import { createSupabaseAdminClient } from "../../supabase";
import { plainTextFromHtml } from "../../text";
import { PUBLISH_TOP_N, SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, compactText, jsonString } from "../utils";

type NewsItemInsert = Database["public"]["Tables"]["news_items"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

function publishedSummary(snapshot: StorySnapshotRow) {
  return jsonString(snapshot.metadata, "summary") || jsonString(snapshot.metadata, "title") || "No summary available.";
}

async function deleteStaleNewsItems(currentExternalIds: string[]) {
  if (!currentExternalIds.length) {
    return 0;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("news_items").select("id, external_id");

  if (error) {
    throw error;
  }

  const current = new Set(currentExternalIds);
  const staleIds = (data || []).filter((item) => !current.has(item.external_id)).map((item) => item.id);

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
    .limit(PUBLISH_TOP_N);

  if (error) {
    throw error;
  }

  const rows: NewsItemInsert[] = (snapshots || []).map((snapshot) => {
    const canonicalUrl = jsonString(snapshot.metadata, "canonicalUrl");
    const title = jsonString(snapshot.metadata, "title") || canonicalUrl;

    return {
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
      summary: compactText(plainTextFromHtml(publishedSummary(snapshot)), 5000),
      title: plainTextFromHtml(title),
    };
  });

  if (rows.length) {
    const { error: upsertError } = await supabase.from("news_items").upsert(rows, {
      onConflict: "external_id",
    });

    if (upsertError) {
      throw upsertError;
    }
  }

  const deletedStaleCount = rows.length ? await deleteStaleNewsItems(rows.map((row) => row.external_id)) : 0;

  return {
    metrics: {
      deletedStaleCount,
      publishedCount: rows.length,
    },
  };
};

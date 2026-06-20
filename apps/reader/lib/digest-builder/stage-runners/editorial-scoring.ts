import "server-only";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { IMPORTANT_KEYWORDS, PUBLISH_TOP_N, SCOPE_KEYWORDS, SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, jsonString } from "../utils";

type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

async function loadRunSnapshots(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("story_snapshots")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

function textIncludesAny(text: string, keywords: string[]) {
  const lower = text.toLowerCase();

  return keywords.some((keyword) => lower.includes(keyword));
}

function scoreSnapshot(snapshot: StorySnapshotRow) {
  const title = jsonString(snapshot.metadata, "title");
  const summary = jsonString(snapshot.metadata, "summary");
  const category = jsonString(snapshot.metadata, "category");
  const publishedAt = jsonString(snapshot.metadata, "publishedAt");
  const text = `${title} ${summary} ${category}`;
  const impactScore = Math.max(
    1,
    Math.min(10, 2 + IMPORTANT_KEYWORDS.filter((keyword) => text.toLowerCase().includes(keyword)).length),
  );
  const confirmationScore = Math.min(10, snapshot.duplicate_count >= 5 ? 10 : snapshot.duplicate_count * 3);
  const scopeFitScore = textIncludesAny(text, SCOPE_KEYWORDS) ? 9 : 4;
  const publishedTimestamp = Date.parse(publishedAt);
  const ageHours = Number.isNaN(publishedTimestamp) ? 72 : (Date.now() - publishedTimestamp) / 3_600_000;
  const urgencyScore = ageHours <= 6 ? 10 : ageHours <= 24 ? 8 : ageHours <= 72 ? 5 : 3;
  const noveltyScore = 8;
  const editorialScore = Math.round(
    impactScore * 2.4 + noveltyScore * 1.6 + confirmationScore * 1.4 + scopeFitScore * 2.4 + urgencyScore * 1.2,
  );

  return {
    confirmationScore,
    editorialScore,
    impactScore,
    noveltyScore,
    scopeFitScore,
    urgencyScore,
  };
}

export const runEditorialScoringStage: StageRunner = async ({ digestRunId }) => {
  const snapshots = await loadRunSnapshots(digestRunId);
  const scored = snapshots
    .map((snapshot) => ({
      scores: scoreSnapshot(snapshot),
      snapshot,
    }))
    .sort((left, right) => right.scores.editorialScore - left.scores.editorialScore);
  const selectedIds = new Set(scored.slice(0, PUBLISH_TOP_N).map(({ snapshot }) => snapshot.id));
  const supabase = createSupabaseAdminClient();
  const scoredSnapshots: StorySnapshotInsert[] = scored.map(({ scores, snapshot }) => ({
    ...snapshot,
    confirmation_score: scores.confirmationScore,
    editorial_score: scores.editorialScore,
    impact_score: scores.impactScore,
    is_selected: selectedIds.has(snapshot.id),
    novelty_score: scores.noveltyScore,
    scope_fit_score: scores.scopeFitScore,
    urgency_score: scores.urgencyScore,
  }));

  for (const snapshotBatch of chunk(scoredSnapshots, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error } = await supabase.from("story_snapshots").upsert(snapshotBatch, {
      onConflict: "id",
    });

    if (error) {
      throw error;
    }
  }

  return {
    metrics: {
      selectedCount: selectedIds.size,
      storyCount: snapshots.length,
    },
  };
};

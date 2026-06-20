import "server-only";

import type { Database } from "../../database.types";
import { readerFeedForCategory, type ReaderFeedId } from "../../feed-categories";
import { createSupabaseAdminClient } from "../../supabase";
import { IMPORTANT_KEYWORDS, PUBLISH_TOP_N, SCOPE_KEYWORDS, SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, jsonNumber, jsonString } from "../utils";

type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];
type ContentFeed = Exclude<ReaderFeedId, "all">;

const FEED_SELECTION_TARGETS: Record<ContentFeed, number> = {
  geopolitics: 14,
  business: 6,
  ai: 4,
  software: 4,
  security: 2,
};

const FEED_SELECTION_ORDER: ContentFeed[] = ["geopolitics", "business", "ai", "software", "security"];

const MAJOR_SECURITY_KEYWORDS = [
  "active exploit",
  "actively exploited",
  "breach",
  "critical",
  "cisa",
  "data leak",
  "emergency patch",
  "exploited in the wild",
  "major outage",
  "nation-state",
  "ransomware",
  "supply chain",
  "zero-day",
  "0-day",
];

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

function securityStoryIsMajor(snapshot: StorySnapshotRow, text: string) {
  return snapshot.duplicate_count >= 3 || textIncludesAny(text, MAJOR_SECURITY_KEYWORDS);
}

function feedScoreAdjustment(feed: ContentFeed, isMajorSecurity: boolean) {
  if (feed === "geopolitics") {
    return 18;
  }

  if (feed === "business") {
    return 6;
  }

  if (feed === "security") {
    return isMajorSecurity ? 2 : -100;
  }

  return 0;
}

function scoreSnapshot(snapshot: StorySnapshotRow) {
  const title = jsonString(snapshot.metadata, "title");
  const summary = jsonString(snapshot.metadata, "summary");
  const category = jsonString(snapshot.metadata, "category");
  const publishedAt = jsonString(snapshot.metadata, "publishedAt");
  const sourcePriority = Math.max(0, Math.min(5, jsonNumber(snapshot.metadata, "sourcePriority")));
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
    impactScore * 2.4 +
      noveltyScore * 1.6 +
      confirmationScore * 1.4 +
      scopeFitScore * 2.4 +
      urgencyScore * 1.2 +
      sourcePriority * 1.5,
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
    .map((snapshot) => {
      const scores = scoreSnapshot(snapshot);
      const title = jsonString(snapshot.metadata, "title");
      const summary = jsonString(snapshot.metadata, "summary");
      const category = jsonString(snapshot.metadata, "category");
      const feed = readerFeedForCategory(category);
      const text = `${title} ${summary} ${category}`;
      const isMajorSecurity = feed === "security" ? securityStoryIsMajor(snapshot, text) : false;

      return {
        feed,
        isMajorSecurity,
        scores,
        selectionScore: scores.editorialScore + feedScoreAdjustment(feed, isMajorSecurity),
        snapshot,
      };
    })
    .sort((left, right) => right.selectionScore - left.selectionScore);
  const candidates = scored.filter((item) => item.feed !== "security" || item.isMajorSecurity);
  const selectedIds = new Set<string>();
  const selectedCounts: Record<ContentFeed, number> = {
    geopolitics: 0,
    business: 0,
    ai: 0,
    software: 0,
    security: 0,
  };

  function selectItem(item: (typeof scored)[number]) {
    if (selectedIds.size >= PUBLISH_TOP_N || selectedIds.has(item.snapshot.id)) {
      return;
    }

    selectedIds.add(item.snapshot.id);
    selectedCounts[item.feed] += 1;
  }

  for (const feed of FEED_SELECTION_ORDER) {
    const feedCandidates = candidates.filter((item) => item.feed === feed);

    for (const item of feedCandidates) {
      if (selectedCounts[feed] >= FEED_SELECTION_TARGETS[feed]) {
        break;
      }

      selectItem(item);
    }
  }

  for (const item of candidates) {
    if (item.feed === "security" && selectedCounts.security >= FEED_SELECTION_TARGETS.security) {
      continue;
    }

    selectItem(item);
  }

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
      selectedFeedCounts: selectedCounts,
      skippedNonMajorSecurityCount: scored.filter((item) => item.feed === "security" && !item.isMajorSecurity).length,
      storyCount: snapshots.length,
    },
  };
};

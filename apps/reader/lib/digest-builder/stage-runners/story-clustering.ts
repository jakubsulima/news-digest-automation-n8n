import "server-only";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { buildDedupeProfile, duplicateDecision, storyKeyForProfiles, type DedupeProfile } from "../dedupe";
import { loadRunArticles, type RunArticle } from "../run-articles";
import type { StageRunner } from "../types";
import { chunk, chunkByEncodedLength, jsonNumber, jsonString, throwDatabaseError } from "../utils";
import {
  SUPABASE_FILTER_BATCH_MAX_COUNT,
  SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  SUPABASE_WRITE_BATCH_SIZE,
} from "../constants";

type ArticleRow = RunArticle;
type StoryClusterInsert = Database["public"]["Tables"]["story_clusters"]["Insert"];
type StoryClusterRow = Database["public"]["Tables"]["story_clusters"]["Row"];
type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];

type DuplicateEdge = { leftArticleId: string; reason: string; rightArticleId: string; score: number };

type GroupedStory = {
  duplicateEdges: DuplicateEdge[];
  group: ArticleRow[];
  profiles: DedupeProfile[];
  storyKey: string;
};

const MAX_DEDUPE_CANDIDATES_PER_ARTICLE = 80;
const MAX_DEDUPE_KEY_TOKENS = 8;

function bestArticleForGroup(articles: ArticleRow[]) {
  return [...articles].sort((left, right) => {
    const leftPriority = jsonNumber(left.metadata, "sourcePriority");
    const rightPriority = jsonNumber(right.metadata, "sourcePriority");
    const leftSummary = (left.enriched_description || left.raw_summary || "").length;
    const rightSummary = (right.enriched_description || right.raw_summary || "").length;

    return rightPriority - leftPriority || rightSummary - leftSummary;
  })[0];
}

function dedupeMetadata(profiles: DedupeProfile[], duplicateEdges: DuplicateEdge[]) {
  return {
    duplicateEdges,
    fingerprints: profiles.map((profile) => profile.fingerprint),
  };
}

function dedupeCandidateKeys(profile: DedupeProfile) {
  const keys = new Set<string>([`feed:${profile.broadFeed}`]);

  if (profile.fingerprint) {
    keys.add(`fingerprint:${profile.fingerprint}`);
  }

  for (const token of [...profile.titleTokens].slice(0, MAX_DEDUPE_KEY_TOKENS)) {
    keys.add(`title:${profile.broadFeed}:${token}`);
  }

  for (const token of [...profile.textTokens].filter((value) => /\d/.test(value) || value.length >= 7).slice(0, 4)) {
    keys.add(`anchor:${profile.broadFeed}:${token}`);
  }

  return [...keys];
}

function candidateIndexesForProfile(
  profile: DedupeProfile,
  buckets: Map<string, number[]>,
): { candidateIndexes: number[]; skippedCandidateCount: number } {
  const candidates = new Set<number>();

  for (const key of dedupeCandidateKeys(profile)) {
    for (const candidateIndex of buckets.get(key) || []) {
      candidates.add(candidateIndex);
    }
  }

  const candidateIndexes = [...candidates].slice(-MAX_DEDUPE_CANDIDATES_PER_ARTICLE);

  return {
    candidateIndexes,
    skippedCandidateCount: Math.max(0, candidates.size - candidateIndexes.length),
  };
}

function addProfileToCandidateBuckets(profile: DedupeProfile, articleIndex: number, buckets: Map<string, number[]>) {
  for (const key of dedupeCandidateKeys(profile)) {
    buckets.set(key, [...(buckets.get(key) || []), articleIndex]);
  }
}

function groupArticlesIntoStories(articles: ArticleRow[]) {
  const profiles = articles.map((article) =>
    buildDedupeProfile({
      canonicalUrl: article.canonical_url,
      category: article.category,
      id: article.id,
      publishedAt: article.last_seen_at || article.first_seen_at,
      source: article.source,
      summary: article.enriched_description || article.raw_summary,
      title: article.title,
    }),
  );
  const parent = articles.map((_, index) => index);
  const duplicateEdges: DuplicateEdge[] = [];
  const candidateBuckets = new Map<string, number[]>();
  let skippedDedupeCandidateCount = 0;

  function find(index: number): number {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }

    return parent[index];
  }

  function union(left: number, right: number) {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  }

  for (const [rightIndex, profile] of profiles.entries()) {
    const { candidateIndexes, skippedCandidateCount } = candidateIndexesForProfile(profile, candidateBuckets);
    skippedDedupeCandidateCount += skippedCandidateCount;

    for (const leftIndex of candidateIndexes) {
      const decision = duplicateDecision(profiles[leftIndex], profile);

      if (!decision.duplicate) {
        continue;
      }

      union(leftIndex, rightIndex);
      duplicateEdges.push({
        leftArticleId: articles[leftIndex].id,
        reason: decision.reason,
        rightArticleId: articles[rightIndex].id,
        score: Number(decision.score.toFixed(3)),
      });
    }

    addProfileToCandidateBuckets(profile, rightIndex, candidateBuckets);
  }

  const groups = new Map<number, { articleIndexes: number[]; duplicateEdges: DuplicateEdge[] }>();

  for (const [articleIndex] of articles.entries()) {
    const root = find(articleIndex);
    const existing = groups.get(root) || { articleIndexes: [], duplicateEdges: [] };
    existing.articleIndexes.push(articleIndex);
    groups.set(root, existing);
  }

  for (const edge of duplicateEdges) {
    const leftIndex = articles.findIndex((article) => article.id === edge.leftArticleId);
    const root = find(leftIndex);
    const existing = groups.get(root);

    if (existing) {
      existing.duplicateEdges.push(edge);
    }
  }

  return {
    skippedDedupeCandidateCount,
    stories: [...groups.values()].map(({ articleIndexes, duplicateEdges: edges }) => {
      const group = articleIndexes.map((index) => articles[index]);
      const groupProfiles = articleIndexes.map((index) => profiles[index]);

      return {
        duplicateEdges: edges,
        group,
        profiles: groupProfiles,
        storyKey: storyKeyForProfiles(groupProfiles),
      };
    }),
  };
}

async function loadExistingStoryClusters(storyKeys: string[]) {
  const supabase = createSupabaseAdminClient();
  const existing = new Map<
    string,
    Pick<StoryClusterRow, "story_key" | "first_seen_at" | "confirmation_count" | "metadata">
  >();
  const storyKeyBatches = chunkByEncodedLength(
    storyKeys,
    SUPABASE_FILTER_BATCH_MAX_COUNT,
    SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  );

  for (const [batchIndex, storyKeyBatch] of storyKeyBatches.entries()) {
    const { data, error } = await supabase
      .from("story_clusters")
      .select("story_key, first_seen_at, confirmation_count, metadata")
      .in("story_key", storyKeyBatch);

    if (error) {
      throwDatabaseError(
        `load existing story clusters batch ${batchIndex + 1}/${storyKeyBatches.length} (${storyKeyBatch.length} keys)`,
        error,
      );
    }

    for (const row of data || []) {
      existing.set(row.story_key, row);
    }
  }

  return existing;
}

async function loadStoryClustersByKey(storyKeys: string[]) {
  const supabase = createSupabaseAdminClient();
  const clusters = new Map<string, StoryClusterRow>();
  const storyKeyBatches = chunkByEncodedLength(
    storyKeys,
    SUPABASE_FILTER_BATCH_MAX_COUNT,
    SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  );

  for (const [batchIndex, storyKeyBatch] of storyKeyBatches.entries()) {
    const { data, error } = await supabase.from("story_clusters").select("*").in("story_key", storyKeyBatch);

    if (error) {
      throwDatabaseError(
        `load story clusters by key batch ${batchIndex + 1}/${storyKeyBatches.length} (${storyKeyBatch.length} keys)`,
        error,
      );
    }

    for (const row of data || []) {
      clusters.set(row.story_key, row);
    }
  }

  return clusters;
}

export const runStoryClusteringStage: StageRunner = async ({ digestRunId }) => {
  const articles = await loadRunArticles(digestRunId);
  const { skippedDedupeCandidateCount, stories: groupedStories } = groupArticlesIntoStories(articles);
  const storyKeys = groupedStories.map(({ storyKey }) => storyKey);
  const existingStories = await loadExistingStoryClusters(storyKeys);
  const now = new Date().toISOString();
  const clusters: StoryClusterInsert[] = groupedStories.map(({ duplicateEdges, group, profiles, storyKey }) => {
    const canonical = bestArticleForGroup(group);
    const existing = existingStories.get(storyKey);

    return {
      canonical_title: canonical.title,
      canonical_url: canonical.canonical_url,
      category: canonical.category,
      confirmation_count:
        jsonString(existing?.metadata ?? {}, "digestRunId") === digestRunId
          ? existing?.confirmation_count || group.length
          : (existing?.confirmation_count || 0) + group.length,
      first_seen_at: existing?.first_seen_at || canonical.first_seen_at || now,
      last_seen_at: now,
      latest_duplicate_count: group.length,
      latest_published_at: canonical.last_seen_at,
      latest_summary: canonical.enriched_description || canonical.raw_summary || "",
      metadata: {
        articleIds: group.map((article) => article.id),
        canonicalArticleId: canonical.id,
        dedupe: dedupeMetadata(profiles, duplicateEdges),
        digestRunId,
        sourceUrls: group.map((article) => article.canonical_url),
      },
      source: canonical.source,
      story_key: storyKey,
    };
  });
  const supabase = createSupabaseAdminClient();

  for (const clusterBatch of chunk(clusters, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error } = await supabase.from("story_clusters").upsert(clusterBatch, { onConflict: "story_key" });

    if (error) {
      throw error;
    }
  }

  const savedClusters = await loadStoryClustersByKey(storyKeys);
  const snapshots: StorySnapshotInsert[] = [];

  for (const { duplicateEdges, group, profiles, storyKey } of groupedStories) {
    const cluster = savedClusters.get(storyKey);
    const canonical = bestArticleForGroup(group);

    if (!cluster) {
      continue;
    }

    snapshots.push({
      digest_run_id: digestRunId,
      duplicate_count: group.length,
      metadata: {
        articleIds: group.map((article) => article.id),
        canonicalArticleId: canonical.id,
        canonicalUrl: canonical.canonical_url,
        category: canonical.category,
        dedupe: dedupeMetadata(profiles, duplicateEdges),
        publishedAt: canonical.last_seen_at,
        source: canonical.source,
        sourcePriority: jsonNumber(canonical.metadata, "sourcePriority"),
        summary: canonical.enriched_description || canonical.raw_summary || "",
        title: canonical.title,
      },
      story_cluster_id: cluster.id,
    });
  }

  for (const snapshotBatch of chunk(snapshots, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error } = await supabase.from("story_snapshots").upsert(snapshotBatch, {
      onConflict: "digest_run_id,story_cluster_id",
    });

    if (error) {
      throw error;
    }
  }

  return {
    metrics: {
      articleCount: articles.length,
      duplicateEdgeCount: groupedStories.reduce((count, story) => count + story.duplicateEdges.length, 0),
      skippedDedupeCandidateCount,
      storyCount: snapshots.length,
    },
  };
};

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
type StoryClusterArticleInsert = Database["public"]["Tables"]["story_cluster_articles"]["Insert"];

type DuplicateEdge = { leftArticleId: string; reason: string; rightArticleId: string; score: number };

type GroupedStory = {
  duplicateEdges: DuplicateEdge[];
  group: ArticleRow[];
  historicalMatch?: { cluster: StoryClusterRow; reason: string; score: number };
  profiles: DedupeProfile[];
  storyKey: string;
};

export type StorySourceVariant = {
  articleId: string;
  name: string;
  priority: number;
  publishedAt: string | null;
  readerSourceId: string | null;
  sourceFeedUrl: string | null;
  url: string;
};

const MAX_DEDUPE_CANDIDATES_PER_ARTICLE = 250;
const MAX_DEDUPE_KEY_TOKENS = 8;
const HISTORICAL_MATCH_WINDOW_DAYS = 7;
const STORY_CLUSTERING_ALGORITHM_VERSION = "story-clustering-v2";

function bestArticleForGroup(articles: ArticleRow[]) {
  return [...articles].sort((left, right) => {
    const leftPriority = jsonNumber(left.metadata, "sourcePriority");
    const rightPriority = jsonNumber(right.metadata, "sourcePriority");
    const leftSummary = (left.enriched_description || left.raw_summary || "").length;
    const rightSummary = (right.enriched_description || right.raw_summary || "").length;

    return rightPriority - leftPriority || rightSummary - leftSummary;
  })[0];
}

function publisherKey(article: ArticleRow) {
  return jsonString(article.metadata, "readerSourceId") || article.source.trim().toLocaleLowerCase("und");
}

export function sourceVariantsForGroup(articles: ArticleRow[]): StorySourceVariant[] {
  const distinctPublishers = new Map<string, ArticleRow>();

  for (const article of articles) {
    const key = publisherKey(article);
    const existing = distinctPublishers.get(key);

    if (
      !existing ||
      jsonNumber(article.metadata, "sourcePriority") > jsonNumber(existing.metadata, "sourcePriority") ||
      (article.enriched_description || article.raw_summary || "").length >
        (existing.enriched_description || existing.raw_summary || "").length
    ) {
      distinctPublishers.set(key, article);
    }
  }

  return [...distinctPublishers.values()]
    .sort((left, right) => {
      const priorityDiff = jsonNumber(right.metadata, "sourcePriority") - jsonNumber(left.metadata, "sourcePriority");
      const rightTime = Date.parse(right.last_seen_at || right.first_seen_at || "") || 0;
      const leftTime = Date.parse(left.last_seen_at || left.first_seen_at || "") || 0;

      return priorityDiff || rightTime - leftTime;
    })
    .map((article) => ({
      articleId: article.id,
      name: article.source,
      priority: jsonNumber(article.metadata, "sourcePriority"),
      publishedAt: article.last_seen_at || article.first_seen_at,
      readerSourceId: jsonString(article.metadata, "readerSourceId") || null,
      sourceFeedUrl: jsonString(article.metadata, "sourceUrl") || null,
      url: article.canonical_url,
    }));
}

export function detectStoryChanges(
  existing: Pick<
    StoryClusterRow,
    "canonical_title" | "source" | "latest_summary" | "latest_duplicate_count"
  > | null,
  next: { canonicalTitle: string; source: string; summary: string; sourceCount: number },
) {
  if (!existing) {
    return ["new"];
  }

  const changes: string[] = [];

  if (existing.canonical_title !== next.canonicalTitle) changes.push("title");
  if (existing.latest_summary !== next.summary) changes.push("summary");
  if (existing.source !== next.source) changes.push("canonical_source");
  if (existing.latest_duplicate_count !== next.sourceCount) changes.push("source_count");

  return changes;
}

function dedupeMetadata(profiles: DedupeProfile[], duplicateEdges: DuplicateEdge[]) {
  return {
    duplicateEdges,
    fingerprints: profiles.map((profile) => profile.fingerprint),
  };
}

function dedupeCandidateKeys(profile: DedupeProfile) {
  const keys = new Set<string>();

  if (profile.fingerprint) {
    keys.add(`fingerprint:${profile.fingerprint}`);
  }

  const informativeTitleTokens = [...profile.titleTokens].sort(
    (left, right) => Number(/\d/.test(right)) - Number(/\d/.test(left)) || right.length - left.length,
  );

  for (const token of informativeTitleTokens.slice(0, MAX_DEDUPE_KEY_TOKENS)) {
    keys.add(`title:${profile.broadFeed}:${token}`);
  }

  for (const token of [...profile.textTokens].filter((value) => /\d/.test(value) || value.length >= 7).slice(0, 4)) {
    keys.add(`anchor:${profile.broadFeed}:${token}`);
  }

  if (!keys.size || profile.titleTokens.size < 2) {
    keys.add(`feed:${profile.broadFeed}`);
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
  const candidateBuckets = new Map<string, number[]>();
  const groups: Array<{ articleIndexes: number[]; duplicateEdges: DuplicateEdge[] }> = [];
  const groupIndexByArticle = new Map<number, number>();
  let skippedDedupeCandidateCount = 0;

  for (const [rightIndex, profile] of profiles.entries()) {
    const { candidateIndexes, skippedCandidateCount } = candidateIndexesForProfile(profile, candidateBuckets);
    skippedDedupeCandidateCount += skippedCandidateCount;
    const candidateGroupIndexes = new Set(
      candidateIndexes.flatMap((articleIndex) => {
        const groupIndex = groupIndexByArticle.get(articleIndex);
        return groupIndex === undefined ? [] : [groupIndex];
      }),
    );
    const viableGroups = [...candidateGroupIndexes].flatMap((groupIndex) => {
      const group = groups[groupIndex];
      const decisions = group.articleIndexes.map((leftIndex) => ({
        decision: duplicateDecision(profiles[leftIndex], profile),
        leftIndex,
      }));

      if (!decisions.every(({ decision }) => decision.duplicate)) {
        return [];
      }

      return [{
        decisions,
        groupIndex,
        score: Math.min(...decisions.map(({ decision }) => decision.score)),
      }];
    });
    const bestGroup = viableGroups.sort((left, right) => right.score - left.score)[0];

    if (bestGroup) {
      const group = groups[bestGroup.groupIndex];
      group.articleIndexes.push(rightIndex);
      group.duplicateEdges.push(
        ...bestGroup.decisions.map(({ decision, leftIndex }) => ({
          leftArticleId: articles[leftIndex].id,
          reason: decision.reason,
          rightArticleId: articles[rightIndex].id,
          score: Number(decision.score.toFixed(3)),
        })),
      );
      groupIndexByArticle.set(rightIndex, bestGroup.groupIndex);
    } else {
      groupIndexByArticle.set(rightIndex, groups.length);
      groups.push({ articleIndexes: [rightIndex], duplicateEdges: [] });
    }

    addProfileToCandidateBuckets(profile, rightIndex, candidateBuckets);
  }

  return {
    skippedDedupeCandidateCount,
    stories: groups.map(({ articleIndexes, duplicateEdges: edges }) => {
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
    Pick<
      StoryClusterRow,
      | "story_key"
      | "first_seen_at"
      | "confirmation_count"
      | "metadata"
      | "canonical_title"
      | "source"
      | "latest_summary"
      | "latest_duplicate_count"
    >
  >();
  const storyKeyBatches = chunkByEncodedLength(
    storyKeys,
    SUPABASE_FILTER_BATCH_MAX_COUNT,
    SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  );

  for (const [batchIndex, storyKeyBatch] of storyKeyBatches.entries()) {
    const { data, error } = await supabase
      .from("story_clusters")
      .select(
        "story_key, first_seen_at, confirmation_count, metadata, canonical_title, source, latest_summary, latest_duplicate_count",
      )
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

async function loadRecentStoryClusters(now: Date) {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(now.getTime() - HISTORICAL_MATCH_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("story_clusters")
    .select("*")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(2_000);

  if (error) throw error;
  return data || [];
}

function matchStoriesToHistory(stories: GroupedStory[], historicalClusters: StoryClusterRow[]) {
  const historicalProfiles = historicalClusters.map((cluster) => ({
    cluster,
    profile: buildDedupeProfile({
      canonicalUrl: cluster.canonical_url,
      category: cluster.category,
      id: cluster.id,
      publishedAt: cluster.latest_published_at || cluster.last_seen_at,
      source: cluster.source,
      summary: cluster.latest_summary,
      title: cluster.canonical_title,
    }),
  }));
  const usedClusterIds = new Set<string>();

  return stories.map((story) => {
    const historicalMatch = historicalProfiles
      .flatMap(({ cluster, profile }) => {
        if (usedClusterIds.has(cluster.id)) return [];
        const matching = story.profiles
          .map((currentProfile) => duplicateDecision(profile, currentProfile))
          .filter((decision) => decision.duplicate)
          .sort((left, right) => right.score - left.score)[0];

        return matching ? [{ cluster, reason: matching.reason, score: matching.score }] : [];
      })
      .sort((left, right) => right.score - left.score)[0];

    if (!historicalMatch) return story;
    usedClusterIds.add(historicalMatch.cluster.id);
    return { ...story, historicalMatch, storyKey: historicalMatch.cluster.story_key };
  });
}

async function persistStoryArticleAssociations(
  digestRunId: string,
  stories: GroupedStory[],
  savedClusters: Map<string, StoryClusterRow>,
) {
  const supabase = createSupabaseAdminClient();
  const clusterIds = stories.flatMap((story) => {
    const cluster = savedClusters.get(story.storyKey);
    return cluster ? [cluster.id] : [];
  });
  const { data: existingRows, error: existingError } = clusterIds.length
    ? await supabase
        .from("story_cluster_articles")
        .select("story_cluster_id, article_id, first_seen_at, first_seen_digest_run_id")
        .in("story_cluster_id", clusterIds)
    : { data: [], error: null };

  if (existingError) throw existingError;
  const existingByKey = new Map((existingRows || []).map((row) => [`${row.story_cluster_id}:${row.article_id}`, row]));
  const now = new Date().toISOString();
  const rows: StoryClusterArticleInsert[] = [];

  for (const story of stories) {
    const cluster = savedClusters.get(story.storyKey);
    const canonical = bestArticleForGroup(story.group);
    if (!cluster) continue;

    for (const article of story.group) {
      const edge = story.duplicateEdges
        .filter((candidate) => candidate.leftArticleId === article.id || candidate.rightArticleId === article.id)
        .sort((left, right) => right.score - left.score)[0];
      const existing = existingByKey.get(`${cluster.id}:${article.id}`);

      rows.push({
        algorithm_version: STORY_CLUSTERING_ALGORITHM_VERSION,
        article_id: article.id,
        first_seen_at: existing?.first_seen_at || now,
        first_seen_digest_run_id: existing?.first_seen_digest_run_id || digestRunId,
        is_canonical: false,
        last_seen_at: now,
        last_seen_digest_run_id: digestRunId,
        match_reason: story.historicalMatch
          ? `history:${story.historicalMatch.reason}`
          : edge?.reason || (article.id === canonical.id ? "new_story" : "group_member"),
        match_score: Number((story.historicalMatch?.score ?? edge?.score ?? 1).toFixed(3)),
        story_cluster_id: cluster.id,
      });
    }
  }

  for (const rowBatch of chunk(rows, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error } = await supabase.from("story_cluster_articles").upsert(rowBatch, {
      onConflict: "story_cluster_id,article_id",
    });
    if (error) throw error;
  }

  if (clusterIds.length) {
    const { error } = await supabase.from("story_cluster_articles").update({ is_canonical: false }).in("story_cluster_id", clusterIds);
    if (error) throw error;
  }

  for (const story of stories) {
    const cluster = savedClusters.get(story.storyKey);
    const canonical = bestArticleForGroup(story.group);
    if (!cluster) continue;
    const { error } = await supabase
      .from("story_cluster_articles")
      .update({ is_canonical: true })
      .eq("story_cluster_id", cluster.id)
      .eq("article_id", canonical.id);
    if (error) throw error;
  }
}

async function updateSourceStoryObservations(
  digestRunId: string,
  stories: GroupedStory[],
  clusters: Map<string, StoryClusterRow>,
) {
  const supabase = createSupabaseAdminClient();
  const sourceStats = new Map<string, { confirmed: Set<string>; stories: Set<string> }>();

  for (const story of stories) {
    const cluster = clusters.get(story.storyKey);
    if (!cluster) continue;
    const variants = sourceVariantsForGroup(story.group);
    for (const variant of variants) {
      if (!variant.sourceFeedUrl) continue;
      const stats = sourceStats.get(variant.sourceFeedUrl) || { confirmed: new Set(), stories: new Set() };
      stats.stories.add(cluster.id);
      if (variants.length >= 2) stats.confirmed.add(cluster.id);
      sourceStats.set(variant.sourceFeedUrl, stats);
    }
  }

  await Promise.all(
    [...sourceStats].map(async ([sourceUrl, stats]) => {
      const { error } = await supabase
        .from("source_run_observations")
        .update({ confirmation_story_count: stats.confirmed.size, unique_story_count: stats.stories.size })
        .eq("digest_run_id", digestRunId)
        .eq("source_url", sourceUrl);
      if (error) throw error;
    }),
  );
}

export const runStoryClusteringStage: StageRunner = async ({ digestRunId }) => {
  const articles = await loadRunArticles(digestRunId);
  const { skippedDedupeCandidateCount, stories } = groupArticlesIntoStories(articles);
  const groupedStories = matchStoriesToHistory(stories, await loadRecentStoryClusters(new Date()));
  const storyKeys = groupedStories.map(({ storyKey }) => storyKey);
  const existingStories = await loadExistingStoryClusters(storyKeys);
  const now = new Date().toISOString();
  const clusters: StoryClusterInsert[] = groupedStories.map(({ duplicateEdges, group, historicalMatch, profiles, storyKey }) => {
    const canonical = bestArticleForGroup(group);
    const existing = existingStories.get(storyKey);
    const sourceVariants = sourceVariantsForGroup(group);
    const summary = canonical.enriched_description || canonical.raw_summary || "";
    const changedFields = detectStoryChanges(existing || null, {
      canonicalTitle: canonical.title,
      source: canonical.source,
      sourceCount: sourceVariants.length,
      summary,
    });

    return {
      canonical_title: canonical.title,
      canonical_url: canonical.canonical_url,
      category: canonical.category,
      confirmation_count: Math.max(existing?.confirmation_count || 0, sourceVariants.length),
      first_seen_at: existing?.first_seen_at || canonical.first_seen_at || now,
      last_seen_at: now,
      latest_duplicate_count: sourceVariants.length,
      latest_published_at: canonical.last_seen_at,
      latest_summary: summary,
      metadata: {
        articleIds: group.map((article) => article.id),
        canonicalArticleId: canonical.id,
        dedupe: dedupeMetadata(profiles, duplicateEdges),
        digestRunId,
        historicalMatch: historicalMatch
          ? { clusterId: historicalMatch.cluster.id, reason: historicalMatch.reason, score: historicalMatch.score }
          : null,
        changedFields,
        sourceVariants,
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
  await persistStoryArticleAssociations(digestRunId, groupedStories, savedClusters);
  await updateSourceStoryObservations(digestRunId, groupedStories, savedClusters);
  const snapshots: StorySnapshotInsert[] = [];

  for (const { duplicateEdges, group, profiles, storyKey } of groupedStories) {
    const cluster = savedClusters.get(storyKey);
    const canonical = bestArticleForGroup(group);
    const existing = existingStories.get(storyKey);
    const sourceVariants = sourceVariantsForGroup(group);
    const summary = canonical.enriched_description || canonical.raw_summary || "";
    const changedFields = detectStoryChanges(existing || null, {
      canonicalTitle: canonical.title,
      source: canonical.source,
      sourceCount: sourceVariants.length,
      summary,
    });

    if (!cluster) {
      continue;
    }

    snapshots.push({
      digest_run_id: digestRunId,
      duplicate_count: sourceVariants.length,
      changed_fields: changedFields,
      metadata: {
        articleIds: group.map((article) => article.id),
        canonicalArticleId: canonical.id,
        canonicalUrl: canonical.canonical_url,
        category: canonical.category,
        dedupe: dedupeMetadata(profiles, duplicateEdges),
        changedFields,
        publishedAt: canonical.last_seen_at,
        source: canonical.source,
        sourceVariants,
        sourcePriority: jsonNumber(canonical.metadata, "sourcePriority"),
        summary,
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
      historicalMatchCount: groupedStories.filter((story) => story.historicalMatch).length,
      skippedDedupeCandidateCount,
      storyCount: snapshots.length,
    },
  };
};

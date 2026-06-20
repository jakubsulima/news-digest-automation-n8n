import "server-only";

import { createHash } from "node:crypto";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { loadRunArticles, type RunArticle } from "../run-articles";
import type { StageRunner } from "../types";
import { chunk, chunkByEncodedLength, jsonString, throwDatabaseError } from "../utils";
import {
  SUPABASE_FILTER_BATCH_MAX_COUNT,
  SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  SUPABASE_WRITE_BATCH_SIZE,
} from "../constants";

type ArticleRow = RunArticle;
type StoryClusterInsert = Database["public"]["Tables"]["story_clusters"]["Insert"];
type StoryClusterRow = Database["public"]["Tables"]["story_clusters"]["Row"];
type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];

const TITLE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "with",
  "from",
  "by",
  "is",
  "are",
  "after",
  "into",
  "over",
  "under",
  "as",
  "new",
  "how",
  "why",
  "what",
  "when",
  "this",
  "that",
]);

function titleTokens(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token));
}

function storyKeyForArticle(article: ArticleRow) {
  const tokens = titleTokens(article.title).slice(0, 10).join(" ");
  const basis = `${article.category}:${tokens || article.canonical_url}`;

  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

function bestArticleForGroup(articles: ArticleRow[]) {
  return [...articles].sort((left, right) => {
    const leftSummary = (left.enriched_description || left.raw_summary || "").length;
    const rightSummary = (right.enriched_description || right.raw_summary || "").length;

    return rightSummary - leftSummary;
  })[0];
}

function groupArticlesIntoStories(articles: ArticleRow[]) {
  const groups = new Map<string, ArticleRow[]>();

  for (const article of articles) {
    const storyKey = storyKeyForArticle(article);
    groups.set(storyKey, [...(groups.get(storyKey) || []), article]);
  }

  return [...groups.entries()].map(([storyKey, group]) => ({ group, storyKey }));
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
  const groupedStories = groupArticlesIntoStories(articles);
  const storyKeys = groupedStories.map(({ storyKey }) => storyKey);
  const existingStories = await loadExistingStoryClusters(storyKeys);
  const now = new Date().toISOString();
  const clusters: StoryClusterInsert[] = groupedStories.map(({ group, storyKey }) => {
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

  for (const { group, storyKey } of groupedStories) {
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
        publishedAt: canonical.last_seen_at,
        source: canonical.source,
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
      storyCount: snapshots.length,
    },
  };
};

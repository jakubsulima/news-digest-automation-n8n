import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import rssSources from "../../../config/rss-sources.json";
import type { Database, Json } from "./database.types";
import { getDigestRunById, sortDigestStages } from "./digest-runs";
import { createSupabaseAdminClient } from "./supabase";
import { decodeHtmlEntities, plainTextFromHtml } from "./text";

type DigestRun = Database["public"]["Tables"]["digest_runs"]["Row"];
type PipelineStageRun = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];
type ArticleInsert = Database["public"]["Tables"]["articles"]["Insert"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
type EnrichmentRecordInsert = Database["public"]["Tables"]["enrichment_records"]["Insert"];
type NewsItemInsert = Database["public"]["Tables"]["news_items"]["Insert"];
type SourceItemRow = Database["public"]["Tables"]["source_items"]["Row"];
type SourceItemInsert = Database["public"]["Tables"]["source_items"]["Insert"];
type StoryClusterInsert = Database["public"]["Tables"]["story_clusters"]["Insert"];
type StoryClusterRow = Database["public"]["Tables"]["story_clusters"]["Row"];
type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

const sourceConfigSchema = z.array(
  z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url(),
    priority: z.number().int().optional(),
  }),
);

type SourceConfig = z.infer<typeof sourceConfigSchema>[number];

type StageResult = {
  complete?: boolean;
  message?: string;
  metrics?: Json;
};

const USER_AGENT = "daily-news-digest/4.0 (+vercel-next)";
const FEED_FETCH_TIMEOUT_MS = 15_000;
const MAX_RAW_ITEM_XML_LENGTH = 20_000;
const ARTICLE_FETCH_TIMEOUT_MS = 12_000;
const ENRICH_TOP_N = 12;
const ENRICHMENT_BATCH_SIZE = 2;
const PUBLISH_TOP_N = 30;
const RUNNING_STAGE_STALE_MS = 90_000;
const SUPABASE_FILTER_BATCH_MAX_COUNT = 40;
const SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH = 6_000;
const SUPABASE_WRITE_BATCH_SIZE = 500;
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "at_campaign",
  "at_medium",
]);
const IMPORTANT_KEYWORDS = [
  "breach",
  "exploit",
  "vulnerability",
  "ransomware",
  "attack",
  "zero-day",
  "outage",
  "incident",
  "earnings",
  "ipo",
  "acquisition",
  "merger",
  "sanction",
  "inflation",
  "gdp",
  "layoffs",
  "funding",
  "tariff",
  "rate cut",
  "antitrust",
  "chip",
  "semiconductor",
  "cloud",
  "datacenter",
  "ai",
  "model",
  "launch",
  "security",
  "cyber",
];
const SCOPE_KEYWORDS = [
  "ai",
  "llm",
  "openai",
  "anthropic",
  "nvidia",
  "github",
  "developer",
  "software",
  "engineering",
  "api",
  "security",
  "cyber",
  "economy",
  "market",
  "markets",
  "business",
  "inflation",
  "gdp",
  "chip",
  "semiconductor",
  "cloud",
];
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

export type AdvanceDigestRunResult = {
  runId: string;
  status: DigestRun["status"];
  advancedStage: PipelineStageRun["stage_name"] | null;
  message: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    if (parts.length) {
      return parts.join(" ");
    }

    try {
      return JSON.stringify(record);
    } catch {
      return "Stage failed with a non-serializable error.";
    }
  }

  return typeof error === "string" && error.trim() ? error : "Stage failed.";
}

function throwDatabaseError(context: string, error: unknown): never {
  throw new Error(`${context}: ${errorMessage(error)}`);
}

function readSourceConfig() {
  return sourceConfigSchema.parse(rssSources);
}

function stripHtml(value: string) {
  return plainTextFromHtml(value);
}

function compactText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();

  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1).trim()}...` : compacted;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagText(xml: string, tagName: string) {
  const escaped = escapeRegExp(tagName);
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));

  return match ? stripHtml(match[1]) : "";
}

function tagAttribute(xml: string, tagName: string, attributeName: string) {
  const escapedTag = escapeRegExp(tagName);
  const escapedAttribute = escapeRegExp(attributeName);
  const tagMatch = xml.match(new RegExp(`<${escapedTag}\\s+([^>]*)\\/?>`, "i"));

  if (!tagMatch) {
    return "";
  }

  const attrMatch = tagMatch[1].match(new RegExp(`${escapedAttribute}=["']([^"']+)["']`, "i"));

  return attrMatch ? decodeHtmlEntities(attrMatch[1]).trim() : "";
}

function itemXmlBlocks(feedXml: string) {
  const blocks = [...feedXml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map((match) => match[0]);

  if (blocks.length) {
    return blocks;
  }

  return [...feedXml.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function normalizeUrl(value: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parsePublishedAt(value: string) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonString(value: Json, key: string) {
  const item = jsonObject(value)[key];

  return typeof item === "string" ? item.trim() : "";
}

function jsonStringArray(value: Json, key: string) {
  const item = jsonObject(value)[key];

  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
}

function jsonNumber(value: Json, key: string) {
  const item = jsonObject(value)[key];

  return typeof item === "number" && Number.isFinite(item) ? item : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function parseSourceItems(feedXml: string, source: SourceConfig, digestRunId: string): SourceItemInsert[] {
  const items: SourceItemInsert[] = [];

  for (const itemXml of itemXmlBlocks(feedXml)) {
    const title = tagText(itemXml, "title");
    const link = tagText(itemXml, "link") || tagAttribute(itemXml, "link", "href");
    const summary =
      tagText(itemXml, "description") ||
      tagText(itemXml, "summary") ||
      tagText(itemXml, "content") ||
      tagText(itemXml, "content:encoded");
    const publishedAt =
      parsePublishedAt(tagText(itemXml, "pubDate")) ||
      parsePublishedAt(tagText(itemXml, "published")) ||
      parsePublishedAt(tagText(itemXml, "updated")) ||
      parsePublishedAt(tagText(itemXml, "dc:date"));

    if (!title && !link) {
      continue;
    }

    items.push({
      category: source.category,
      digest_run_id: digestRunId,
      normalized_url: normalizeUrl(link),
      published_at: publishedAt,
      raw_payload: {
        guid: tagText(itemXml, "guid") || tagText(itemXml, "id") || null,
        link: link || null,
        publishedAt,
        rawXml: itemXml.slice(0, MAX_RAW_ITEM_XML_LENGTH),
        sourcePriority: source.priority ?? null,
        summary,
        title,
      },
      source_name: source.name,
      source_url: source.url,
    });
  }

  return items;
}

async function fetchSource(source: SourceConfig, digestRunId: string) {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${source.name}: HTTP ${response.status}`);
  }

  const feedXml = await response.text();
  const items = parseSourceItems(feedXml, source, digestRunId);

  return {
    items,
    sourceName: source.name,
  };
}

async function runSourceFetchStage(digestRunId: string): Promise<StageResult> {
  const sources = await readSourceConfig();
  const settled = await Promise.allSettled(sources.map((source) => fetchSource(source, digestRunId)));
  const sourceItems: SourceItemInsert[] = [];
  const sourceCounts: Record<string, number> = {};
  const errors: string[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourceItems.push(...result.value.items);
      sourceCounts[result.value.sourceName] = result.value.items.length;
      continue;
    }

    errors.push(result.reason instanceof Error ? result.reason.message : "Unknown source fetch error");
  }

  const supabase = createSupabaseAdminClient();
  const { error: deleteError } = await supabase.from("source_items").delete().eq("digest_run_id", digestRunId);

  if (deleteError) {
    throw deleteError;
  }

  if (sourceItems.length) {
    const { error: insertError } = await supabase.from("source_items").insert(sourceItems);

    if (insertError) {
      throw insertError;
    }
  }

  return {
    metrics: {
      errors,
      fetchedItemCount: sourceItems.length,
      sourceCounts,
      sourcesConfigured: sources.length,
      sourcesFailed: errors.length,
      sourcesSucceeded: settled.filter((result) => result.status === "fulfilled").length,
    },
  };
}

function articleUrlForSourceItem(item: SourceItemRow) {
  return item.normalized_url || normalizeUrl(jsonString(item.raw_payload, "link"));
}

function sourceItemToArticle(item: SourceItemRow, now: string): ArticleInsert | null {
  const canonicalUrl = articleUrlForSourceItem(item);
  const title = jsonString(item.raw_payload, "title");

  if (!canonicalUrl || !title) {
    return null;
  }

  return {
    canonical_url: canonicalUrl,
    category: item.category,
    first_seen_at: item.published_at || now,
    last_seen_at: now,
    metadata: {
      lastDigestRunId: item.digest_run_id,
      lastSourceItemId: item.id,
      sourceUrl: item.source_url,
    },
    raw_summary: jsonString(item.raw_payload, "summary"),
    source: item.source_name,
    title,
  };
}

function dedupeArticlesByUrl(articles: ArticleInsert[]) {
  const byUrl = new Map<string, ArticleInsert>();

  for (const article of articles) {
    const existing = byUrl.get(article.canonical_url);

    if (!existing) {
      byUrl.set(article.canonical_url, article);
      continue;
    }

    const existingSummaryLength = existing.raw_summary?.length ?? 0;
    const currentSummaryLength = article.raw_summary?.length ?? 0;

    if (currentSummaryLength > existingSummaryLength) {
      byUrl.set(article.canonical_url, {
        ...article,
        first_seen_at: existing.first_seen_at,
      });
    }
  }

  return [...byUrl.values()];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function chunkByEncodedLength(items: string[], maxCount: number, maxEncodedLength: number) {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentEncodedLength = 0;

  for (const item of items) {
    const itemEncodedLength = encodeURIComponent(item).length;
    const nextEncodedLength = currentEncodedLength + itemEncodedLength + (currentChunk.length ? 1 : 0);

    if (currentChunk.length && (currentChunk.length >= maxCount || nextEncodedLength > maxEncodedLength)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentEncodedLength = 0;
    }

    currentChunk.push(item);
    currentEncodedLength += itemEncodedLength + (currentChunk.length > 1 ? 1 : 0);
  }

  if (currentChunk.length) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function loadExistingArticles(canonicalUrls: string[]) {
  const supabase = createSupabaseAdminClient();
  const existing = new Map<string, Pick<ArticleRow, "canonical_url" | "first_seen_at">>();
  const urlBatches = chunkByEncodedLength(
    canonicalUrls,
    SUPABASE_FILTER_BATCH_MAX_COUNT,
    SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  );

  for (const [batchIndex, urlBatch] of urlBatches.entries()) {
    const { data, error } = await supabase
      .from("articles")
      .select("canonical_url, first_seen_at")
      .in("canonical_url", urlBatch);

    if (error) {
      throwDatabaseError(
        `load existing articles batch ${batchIndex + 1}/${urlBatches.length} (${urlBatch.length} urls)`,
        error,
      );
    }

    for (const row of data || []) {
      existing.set(row.canonical_url, row);
    }
  }

  return existing;
}

async function runArticleNormalizationStage(digestRunId: string): Promise<StageResult> {
  const supabase = createSupabaseAdminClient();
  const { data: sourceItems, error } = await supabase
    .from("source_items")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const now = new Date().toISOString();
  const parsedArticles = dedupeArticlesByUrl(
    (sourceItems || [])
      .map((item) => sourceItemToArticle(item, now))
      .filter((article): article is ArticleInsert => Boolean(article)),
  );
  const existingArticles = await loadExistingArticles(parsedArticles.map((article) => article.canonical_url));
  const articles = parsedArticles.map((article) => {
    const existing = existingArticles.get(article.canonical_url);

    return existing
      ? {
          ...article,
          first_seen_at: existing.first_seen_at,
        }
      : article;
  });

  for (const articleBatch of chunk(articles, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error: upsertError } = await supabase.from("articles").upsert(articleBatch, {
      onConflict: "canonical_url",
    });

    if (upsertError) {
      throwDatabaseError(`upsert articles batch (${articleBatch.length} articles)`, upsertError);
    }
  }

  return {
    metrics: {
      articleCount: articles.length,
      existingArticleCount: existingArticles.size,
      newArticleCount: articles.length - existingArticles.size,
      skippedSourceItemCount: (sourceItems || []).length - articles.length,
      sourceItemCount: sourceItems?.length ?? 0,
    },
  };
}

async function loadRunArticles(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .contains("metadata", { lastDigestRunId: digestRunId })
    .order("last_seen_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw error;
  }

  return data || [];
}

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

async function runStoryClusteringStage(digestRunId: string): Promise<StageResult> {
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
}

function articleImportanceScore(article: ArticleRow) {
  const text = `${article.title} ${article.raw_summary} ${article.enriched_description || ""} ${
    article.enriched_text || ""
  }`.toLowerCase();
  const keywordHits = IMPORTANT_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  const enrichedBonus = article.enriched_text && article.enriched_text.length > 900 ? 2 : 0;

  return Math.max(1, Math.min(10, 2 + keywordHits + enrichedBonus));
}

function articleTimestamp(article: ArticleRow) {
  const timestamp = Date.parse(article.last_seen_at || article.first_seen_at || article.created_at);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function chooseEnrichmentCandidates(articles: ArticleRow[]) {
  return [...articles]
    .filter((article) => article.enrichment_status !== "enriched")
    .sort((left, right) => {
      const scoreDiff = articleImportanceScore(right) - articleImportanceScore(left);

      return scoreDiff || articleTimestamp(right) - articleTimestamp(left);
    })
    .slice(0, ENRICH_TOP_N);
}

function extractHtmlDescription(html: string) {
  const description =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1] ||
    "";

  return stripHtml(description);
}

function extractArticleText(html: string) {
  return compactText(
    stripHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
    ),
    8000,
  );
}

async function fetchArticleEnrichment(article: ArticleRow) {
  try {
    const response = await fetch(article.canonical_url, {
      headers: {
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}`, status: "fetch_error" };
    }

    const html = await response.text();
    const description = extractHtmlDescription(html);
    const text = extractArticleText(html);

    return {
      description,
      status: description || text ? "enriched" : "empty",
      text,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Fetch failed",
      status: "fetch_error",
    };
  }
}

async function runEnrichmentStage(digestRunId: string, stage: PipelineStageRun): Promise<StageResult> {
  const articles = await loadRunArticles(digestRunId);
  const existingCandidateIds = jsonStringArray(stage.metrics, "candidateArticleIds");
  const candidateArticleIds = existingCandidateIds.length
    ? existingCandidateIds
    : chooseEnrichmentCandidates(articles).map((article) => article.id);
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const processedArticleIds = new Set(jsonStringArray(stage.metrics, "processedArticleIds"));
  const pendingArticleIds = candidateArticleIds.filter((articleId) => !processedArticleIds.has(articleId));
  const batchArticleIds = pendingArticleIds.slice(0, ENRICHMENT_BATCH_SIZE);
  const supabase = createSupabaseAdminClient();
  let enrichedCount = jsonNumber(stage.metrics, "enrichedCount");
  let errorCount = jsonNumber(stage.metrics, "errorCount");
  const records: EnrichmentRecordInsert[] = [];

  for (const articleId of batchArticleIds) {
    const article = articlesById.get(articleId);

    if (!article) {
      processedArticleIds.add(articleId);
      continue;
    }

    const result = await fetchArticleEnrichment(article);
    const fetchedAt = new Date().toISOString();

    if (result.status === "enriched") {
      enrichedCount += 1;
    }
    if (result.status === "fetch_error") {
      errorCount += 1;
    }

    const { error } = await supabase
      .from("articles")
      .update({
        enriched_description: "description" in result ? result.description || null : null,
        enriched_fetched_at: fetchedAt,
        enriched_text: "text" in result ? result.text || null : null,
        enriched_word_count: "text" in result && result.text ? result.text.split(/\s+/).length : 0,
        enrichment_status: result.status,
      })
      .eq("id", article.id);

    if (error) {
      throw error;
    }

    records.push({
      article_id: article.id,
      digest_run_id: digestRunId,
      error_message: "error" in result ? result.error || null : null,
      fetched_at: fetchedAt,
      metadata: {
        canonicalUrl: article.canonical_url,
      },
      status: result.status,
    });
    processedArticleIds.add(article.id);
  }

  if (records.length) {
    const { error } = await supabase.from("enrichment_records").upsert(records, {
      onConflict: "digest_run_id,article_id",
    });

    if (error) {
      throw error;
    }
  }

  const remainingCount = candidateArticleIds.filter((articleId) => !processedArticleIds.has(articleId)).length;
  const complete = remainingCount === 0;

  return {
    complete,
    message: complete
      ? `Enrichment completed for ${processedArticleIds.size} articles.`
      : `Enriched ${batchArticleIds.length} articles; ${remainingCount} remaining.`,
    metrics: {
      batchSize: batchArticleIds.length,
      candidateArticleIds,
      candidateCount: candidateArticleIds.length,
      enrichedCount,
      errorCount,
      pendingCount: remainingCount,
      processedArticleIds: uniqueStrings([...processedArticleIds]),
      processedCount: processedArticleIds.size,
    },
  };
}

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

async function runEditorialScoringStage(digestRunId: string): Promise<StageResult> {
  const snapshots = await loadRunSnapshots(digestRunId);
  const scored = snapshots
    .map((snapshot) => ({
      scores: scoreSnapshot(snapshot),
      snapshot,
    }))
    .sort((left, right) => right.scores.editorialScore - left.scores.editorialScore);
  const selectedIds = new Set(scored.slice(0, PUBLISH_TOP_N).map(({ snapshot }) => snapshot.id));
  const supabase = createSupabaseAdminClient();

  for (const { scores, snapshot } of scored) {
    const { error } = await supabase
      .from("story_snapshots")
      .update({
        confirmation_score: scores.confirmationScore,
        editorial_score: scores.editorialScore,
        impact_score: scores.impactScore,
        is_selected: selectedIds.has(snapshot.id),
        novelty_score: scores.noveltyScore,
        scope_fit_score: scores.scopeFitScore,
        urgency_score: scores.urgencyScore,
      })
      .eq("id", snapshot.id);

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
}

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

async function runReaderPublicationStage(digestRunId: string): Promise<StageResult> {
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
      summary: compactText(stripHtml(publishedSummary(snapshot)), 5000),
      title: stripHtml(title),
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
}

async function runFinalizationStage(digestRunId: string): Promise<StageResult> {
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
      cleanedSourceItemCount: sourceItemCount || 0,
      cleanedStorySnapshotCount: storyCount || 0,
      enrichmentRecordCount: enrichmentRecordCount || 0,
      publishedCount: publishedCount || 0,
      sourceItemCount: sourceItemCount || 0,
      storyCount: storyCount || 0,
    },
  };
}

async function runStageForRun(stage: PipelineStageRun, digestRunId: string): Promise<StageResult> {
  const stageName = stage.stage_name;

  if (stageName === "source_fetch") {
    return runSourceFetchStage(digestRunId);
  }

  if (stageName === "article_normalization") {
    return runArticleNormalizationStage(digestRunId);
  }

  if (stageName === "story_clustering") {
    return runStoryClusteringStage(digestRunId);
  }

  if (stageName === "enrichment") {
    return runEnrichmentStage(digestRunId, stage);
  }

  if (stageName === "editorial_scoring") {
    return runEditorialScoringStage(digestRunId);
  }

  if (stageName === "reader_publication") {
    return runReaderPublicationStage(digestRunId);
  }

  if (stageName === "finalization") {
    return runFinalizationStage(digestRunId);
  }

  throw new Error(`${stageName} stage is not ported to the hosted pipeline yet.`);
}

function runningStageIsStale(stage: PipelineStageRun, nowMs = Date.now()) {
  if (!stage.started_at) {
    return true;
  }

  const startedAtMs = Date.parse(stage.started_at);

  return Number.isNaN(startedAtMs) || nowMs - startedAtMs > RUNNING_STAGE_STALE_MS;
}

function queuedStage(stages: PipelineStageRun[]) {
  const sortedStages = sortDigestStages(stages);

  return sortedStages.find((stage) => stage.status === "queued") || null;
}

export async function advanceDigestRun(digestRunId: string): Promise<AdvanceDigestRunResult> {
  const run = await getDigestRunById(digestRunId);

  if (!run) {
    throw new Error("Digest run not found.");
  }

  if (run.status !== "queued" && run.status !== "running") {
    return {
      runId: run.id,
      status: run.status,
      advancedStage: null,
      message: `Run is already ${run.status}.`,
    };
  }

  const supabase = createSupabaseAdminClient();
  const runningStage = sortDigestStages(run.stages).find((stage) => stage.status === "running") || null;
  let stage: PipelineStageRun | null = null;

  if (runningStage && !runningStageIsStale(runningStage)) {
    return {
      runId: run.id,
      status: "running",
      advancedStage: runningStage.stage_name,
      message: `${runningStage.stage_name} is already running.`,
    };
  }

  if (runningStage) {
    const { data, error } = await supabase
      .from("pipeline_stage_runs")
      .update({
        error_message: null,
        finished_at: null,
        started_at: null,
        status: "queued",
      })
      .eq("id", runningStage.id)
      .eq("status", "running")
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    stage = data;
  }

  stage = stage || queuedStage(run.stages);

  if (!stage) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("digest_runs")
      .update({
        finished_at: now,
        status: "succeeded",
      })
      .eq("id", run.id)
      .in("status", ["queued", "running"]);

    if (error) {
      throw error;
    }

    return {
      runId: run.id,
      status: "succeeded",
      advancedStage: null,
      message: "Run finalized.",
    };
  }

  const now = new Date().toISOString();
  const { error: runError } = await supabase
    .from("digest_runs")
    .update({
      started_at: run.started_at ?? now,
      status: "running",
    })
    .eq("id", run.id)
    .in("status", ["queued", "running"]);

  if (runError) {
    throw runError;
  }

  let claimedStage: PipelineStageRun | null = stage;

  if (stage.status === "queued") {
    const { data, error: claimError } = await supabase
      .from("pipeline_stage_runs")
      .update({
        attempt_count: stage.attempt_count + 1,
        error_message: null,
        started_at: now,
        status: "running",
      })
      .eq("id", stage.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw claimError;
    }

    claimedStage = data;

    if (!claimedStage) {
      return {
        runId: run.id,
        status: "running",
        advancedStage: null,
        message: "No queued stage was claimed.",
      };
    }
  }

  try {
    const result = await runStageForRun(claimedStage, run.id);
    const finishedAt = new Date().toISOString();
    const stageComplete = result.complete !== false;
    const { error: stageError } = await supabase
      .from("pipeline_stage_runs")
      .update({
        finished_at: stageComplete ? finishedAt : null,
        metrics: result.metrics ?? {},
        status: stageComplete ? "succeeded" : "queued",
      })
      .eq("id", claimedStage.id)
      .eq("status", "running");

    if (stageError) {
      throw stageError;
    }

    if (!stageComplete) {
      return {
        runId: run.id,
        status: "running",
        advancedStage: claimedStage.stage_name,
        message: result.message || `${claimedStage.stage_name} is still running.`,
      };
    }

    if (claimedStage.stage_name === "finalization") {
      const { error: digestRunError } = await supabase
        .from("digest_runs")
        .update({
          error_message: null,
          finished_at: finishedAt,
          status: "succeeded",
        })
        .eq("id", run.id)
        .eq("status", "running");

      if (digestRunError) {
        throw digestRunError;
      }

      return {
        runId: run.id,
        status: "succeeded",
        advancedStage: claimedStage.stage_name,
        message: "Run finalized.",
      };
    }

    return {
      runId: run.id,
      status: "running",
      advancedStage: claimedStage.stage_name,
      message: result.message || `${claimedStage.stage_name} succeeded.`,
    };
  } catch (error) {
    const message = `${claimedStage.stage_name}: ${errorMessage(error)}`;
    const finishedAt = new Date().toISOString();
    const [{ error: stageError }, { error: digestRunError }] = await Promise.all([
      supabase
        .from("pipeline_stage_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", claimedStage.id)
        .eq("status", "running"),
      supabase
        .from("digest_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", run.id)
        .eq("status", "running"),
    ]);

    if (stageError) {
      throw stageError;
    }
    if (digestRunError) {
      throw digestRunError;
    }

    return {
      runId: run.id,
      status: "failed",
      advancedStage: claimedStage.stage_name,
      message,
    };
  }
}

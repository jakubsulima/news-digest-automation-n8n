import "server-only";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { fetchBoundedText } from "../../source-discovery/bounded-fetch";
import type { SourceDiscoveryDependencies } from "../../source-discovery/types";
import { plainTextFromHtml } from "../../text";
import { keywordHitCount } from "../../keyword-matching";
import { analyzeReadableContent } from "../../readable-content";
import { loadRunArticles, type RunArticle } from "../run-articles";
import {
  ARTICLE_FETCH_TIMEOUT_MS,
  ENRICH_TOP_N,
  ENRICHMENT_BATCH_SIZE,
  IMPORTANT_KEYWORDS,
  USER_AGENT,
} from "../constants";
import type { StageRunner } from "../types";
import { jsonNumber, jsonStringArray, uniqueStrings } from "../utils";

type ArticleRow = RunArticle;
type EnrichmentRecordInsert = Database["public"]["Tables"]["enrichment_records"]["Insert"];
type ArticleFetchDependencies = Pick<SourceDiscoveryDependencies, "fetchImpl" | "lookup">;
const READER_COPY_VERSION = 2;

function jsonRecord(value: Database["public"]["Tables"]["articles"]["Row"]["metadata"]) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function articleImportanceScore(article: ArticleRow) {
  const text = `${article.title} ${article.raw_summary} ${article.enriched_description || ""} ${
    article.enriched_text || ""
  }`;
  const keywordHits = keywordHitCount(text, IMPORTANT_KEYWORDS);
  const enrichedBonus = article.enriched_text && article.enriched_text.length > 900 ? 2 : 0;

  return Math.max(1, Math.min(10, 2 + keywordHits + enrichedBonus));
}

function articleTimestamp(article: ArticleRow) {
  const timestamp = Date.parse(article.last_seen_at || article.first_seen_at || article.created_at);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function chooseEnrichmentCandidates(articles: ArticleRow[]) {
  return [...articles]
    .filter(
      (article) =>
        article.enrichment_status !== "enriched" ||
        article.content_mode === "unknown" ||
        jsonNumber(article.metadata, "readerCopyVersion") < READER_COPY_VERSION,
    )
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

  return plainTextFromHtml(description);
}

function archivedArticleText(value: string) {
  const text = value.trim();

  return text.length > 200_000 ? `${text.slice(0, 199_999).trimEnd()}…` : text;
}

export async function fetchArticleEnrichment(
  article: ArticleRow,
  dependencies: ArticleFetchDependencies = {},
) {
  try {
    const { body: html } = await fetchBoundedText(article.canonical_url, {
      ...dependencies,
      timeoutMs: ARTICLE_FETCH_TIMEOUT_MS,
      userAgent: USER_AGENT,
    });
    const description = extractHtmlDescription(html);
    const pageAnalysis = analyzeReadableContent(html);
    const feedAnalysis = analyzeReadableContent(article.raw_summary);
    const analysis =
      pageAnalysis.mode === "readable" || feedAnalysis.mode !== "readable"
        ? pageAnalysis
        : { ...feedAnalysis, reason: "full_written_text_from_feed" };
    const text = archivedArticleText(analysis.text);

    return {
      analysis,
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

export const runEnrichmentStage: StageRunner = async ({ digestRunId, stage }) => {
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
  const fetchedBatch = await Promise.all(
    batchArticleIds.map(async (articleId) => {
      const article = articlesById.get(articleId);
      return article ? { article, articleId, result: await fetchArticleEnrichment(article) } : { article: null, articleId, result: null };
    }),
  );

  for (const { article, articleId, result } of fetchedBatch) {

    if (!article || !result) {
      processedArticleIds.add(articleId);
      continue;
    }

    const analysis = "analysis" in result ? result.analysis : null;
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
        content_mode: analysis?.mode || "unknown",
        content_mode_reason: analysis?.reason || ("error" in result ? result.error : null),
        enriched_description: "description" in result ? result.description || null : null,
        enriched_fetched_at: fetchedAt,
        enriched_text: "text" in result ? result.text || null : null,
        enriched_word_count: analysis?.wordCount || 0,
        enrichment_status: result.status,
        has_audio: analysis?.hasAudio || false,
        has_video: analysis?.hasVideo || false,
        metadata: {
          ...jsonRecord(article.metadata),
          readerCopyVersion: READER_COPY_VERSION,
        },
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
        contentMode: analysis?.mode || "unknown",
        contentModeReason: analysis?.reason || ("error" in result ? result.error : null),
        paragraphCount: analysis?.paragraphCount || 0,
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
};

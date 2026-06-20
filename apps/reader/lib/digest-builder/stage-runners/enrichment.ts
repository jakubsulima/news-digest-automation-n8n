import "server-only";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { plainTextFromHtml } from "../../text";
import { loadRunArticles, type RunArticle } from "../run-articles";
import {
  ARTICLE_FETCH_TIMEOUT_MS,
  ENRICH_TOP_N,
  ENRICHMENT_BATCH_SIZE,
  IMPORTANT_KEYWORDS,
  USER_AGENT,
} from "../constants";
import type { StageRunner } from "../types";
import { compactText, jsonNumber, jsonStringArray, uniqueStrings } from "../utils";

type ArticleRow = RunArticle;
type EnrichmentRecordInsert = Database["public"]["Tables"]["enrichment_records"]["Insert"];

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

  return plainTextFromHtml(description);
}

function extractArticleText(html: string) {
  return compactText(
    plainTextFromHtml(
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
};

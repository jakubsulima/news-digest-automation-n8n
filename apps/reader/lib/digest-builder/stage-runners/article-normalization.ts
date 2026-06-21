import "server-only";

import type { Database } from "../../database.types";
import { createSupabaseAdminClient } from "../../supabase";
import { normalizeUrl } from "../source-item-intake";
import type { StageRunner } from "../types";
import { chunk, chunkByEncodedLength, jsonNumber, jsonString, throwDatabaseError } from "../utils";
import {
  SUPABASE_FILTER_BATCH_MAX_COUNT,
  SUPABASE_FILTER_BATCH_MAX_ENCODED_LENGTH,
  SUPABASE_WRITE_BATCH_SIZE,
} from "../constants";

type ArticleInsert = Database["public"]["Tables"]["articles"]["Insert"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
type SourceItemRow = Database["public"]["Tables"]["source_items"]["Row"];

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
    last_seen_at: item.published_at || now,
    metadata: {
      lastDigestRunId: item.digest_run_id,
      lastSourceItemId: item.id,
      sourcePriority: jsonNumber(item.raw_payload, "sourcePriority"),
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

export const runArticleNormalizationStage: StageRunner = async ({ digestRunId }) => {
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
};

import "server-only";

import type { Database, Json } from "../../database.types";
import { isDigestBriefSchemaError } from "../../digest-brief";
import { getDigestRunById } from "../../digest-runs";
import { getDigestSettingsForRun } from "../../digest-settings";
import {
  fallbackDigestBrief,
  generateDigestBriefWithNvidia,
  type DigestBriefGenerationResult,
} from "../../ai-summary";
import { readingTimeMinutesForDigestBrief } from "../../digest-brief-text";
import { evidenceDetailsFromSignals } from "../../evidence";
import { createSupabaseAdminClient } from "../../supabase";
import { cleanArticleSummary, plainTextFromHtml } from "../../text";
import { SUPABASE_WRITE_BATCH_SIZE } from "../constants";
import type { StageRunner } from "../types";
import { chunk, compactText, jsonNumber, jsonString, jsonStringArray } from "../utils";

type NewsItemInsert = Database["public"]["Tables"]["news_items"]["Insert"];
type DigestSummaryInsert = Database["public"]["Tables"]["digest_summaries"]["Insert"];

const MAX_AI_BRIEF_ATTEMPTS = 3;

export function shouldRetryAiBriefGeneration(
  status: DigestBriefGenerationResult["status"],
  attempt: number,
) {
  return status === "retryable_failure" && attempt < MAX_AI_BRIEF_ATTEMPTS;
}

type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publishedSummary(snapshot: StorySnapshotRow) {
  return jsonString(snapshot.metadata, "summary") || jsonString(snapshot.metadata, "title") || "No summary available.";
}

function compactPublishedSummary({
  maxChars,
  summary,
  title,
}: {
  maxChars: number;
  summary: string;
  title: string;
}) {
  const cleanSummary = cleanArticleSummary(summary, title) || plainTextFromHtml(title);
  return compactText(cleanSummary, maxChars);
}

const NEWS_RETENTION_DAYS = 90;
const EVENT_RETENTION_DAYS = 180;

export function readerExternalIdForStory(storyClusterId: string) {
  return `story:${storyClusterId}`;
}

export function deletableExpiredNewsItemIds(
  staleIds: string[],
  savedIds: Iterable<string>,
  notedIds: Iterable<string> = [],
) {
  const saved = new Set(savedIds);
  const noted = new Set(notedIds);
  return staleIds.filter((id) => !saved.has(id) && !noted.has(id));
}

export function deriveTopicTags(title: string, category: string, practicalBucket: string) {
  const tags = [category, practicalBucket.replace(/_/g, " ")]
    .map((tag) => plainTextFromHtml(tag).trim().toLowerCase())
    .filter(Boolean);
  const titleKeywords = title
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => word.length >= 5)
    .slice(0, 5) || [];

  return Array.from(new Set([...tags, ...titleKeywords])).slice(0, 8);
}

export function deriveEntityTags(title: string) {
  return Array.from(
    new Set(
      title.match(/\b[\p{Lu}][\p{L}\p{N}-]{2,}(?:\s+[\p{Lu}][\p{L}\p{N}-]{2,})*/gu) || [],
    ),
  ).slice(0, 8);
}

async function cleanupExpiredReaderData() {
  const supabase = createSupabaseAdminClient();
  const newsCutoff = new Date(Date.now() - NEWS_RETENTION_DAYS * 86_400_000).toISOString();
  const eventCutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("news_items")
    .select("id")
    .lt("last_selected_at", newsCutoff)
    .limit(1000);

  if (error) {
    throw error;
  }

  const staleIds = (data || []).map((item) => item.id);
  const savedIds = new Set<string>();
  const notedIds = new Set<string>();

  for (const staleBatch of chunk(staleIds, SUPABASE_WRITE_BATCH_SIZE)) {
    const { data: savedStates, error: savedError } = await supabase
      .from("reader_item_states")
      .select("news_item_id")
      .in("news_item_id", staleBatch)
      .not("saved_at", "is", null);

    if (savedError) throw savedError;
    for (const state of savedStates || []) savedIds.add(state.news_item_id);

    const { data: notes, error: notesError } = await supabase
      .from("reader_notes")
      .select("news_item_id")
      .in("news_item_id", staleBatch);

    if (notesError) throw notesError;
    for (const note of notes || []) {
      if (note.news_item_id) notedIds.add(note.news_item_id);
    }
  }

  const deletableIds = deletableExpiredNewsItemIds(staleIds, savedIds, notedIds);

  for (const staleBatch of chunk(deletableIds, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error: deleteError } = await supabase.from("news_items").delete().in("id", staleBatch);

    if (deleteError) {
      throw deleteError;
    }
  }

  const { count: deletedEventCount, error: eventCleanupError } = await supabase
    .from("reader_feed_events")
    .delete({ count: "exact" })
    .lt("created_at", eventCutoff);

  if (eventCleanupError) throw eventCleanupError;

  return { deletedEventCount: deletedEventCount || 0, deletedNewsItemCount: deletableIds.length };
}

export const runReaderPublicationStage: StageRunner = async ({ digestRunId, stage }) => {
  const run = await getDigestRunById(digestRunId);
  const settings = await getDigestSettingsForRun(digestRunId);

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
    .limit(settings.publishTopN);

  if (error) {
    throw error;
  }

  const selectedSnapshots = snapshots || [];
  const clusterIds = selectedSnapshots.map((snapshot) => snapshot.story_cluster_id);
  const { data: existingItems, error: existingError } = clusterIds.length
    ? await supabase
        .from("news_items")
        .select("story_cluster_id, first_selected_at, last_material_change_at")
        .in("story_cluster_id", clusterIds)
    : { data: [], error: null };

  if (existingError) throw existingError;

  const existingByClusterId = new Map((existingItems || []).map((item) => [item.story_cluster_id, item]));

  const rows: NewsItemInsert[] = [];
  const selectedAt = new Date().toISOString();

  for (const snapshot of selectedSnapshots) {
    const canonicalUrl = jsonString(snapshot.metadata, "canonicalUrl");
    const title = jsonString(snapshot.metadata, "title") || canonicalUrl;
    const metadata = jsonRecord(snapshot.metadata);
    const scoreComponents = metadata.scoreComponents;
    const sourceVariants = Array.isArray(metadata.sourceVariants) ? metadata.sourceVariants : [];
    const contentModes = Array.isArray(metadata.contentModes)
      ? metadata.contentModes.filter((value): value is string => typeof value === "string")
      : [];
    const evidence = evidenceDetailsFromSignals({
      contentModes,
      explicitStatus: jsonRecord(metadata.evidence || {}).status,
      fullTextSourceCount: jsonNumber(jsonRecord(metadata.evidence || {}), "fullTextSourceCount"),
      hasReadableVariant: metadata.hasReadableVariant === true,
      sourceCount: Math.max(1, sourceVariants.length || snapshot.duplicate_count),
      sourceNames: sourceVariants.flatMap((variant) => {
        const source = jsonString(variant, "name");
        return source ? [source] : [];
      }),
    });
    const changedFields = jsonStringArray(snapshot.changed_fields);
    const practicalBucket = jsonString(snapshot.metadata, "practicalBucket") || "ignore";
    const existingItem = existingByClusterId.get(snapshot.story_cluster_id);
    const sourceSummary = publishedSummary(snapshot);
    const summary = compactPublishedSummary({
      maxChars: settings.summaryMaxChars,
      summary: sourceSummary,
      title,
    });

    rows.push({
      category: jsonString(snapshot.metadata, "category") || "general",
      changed_fields: changedFields,
      digest_date: run.report_date,
      editorial_score: snapshot.editorial_score,
      entity_tags: deriveEntityTags(title),
      external_id: readerExternalIdForStory(snapshot.story_cluster_id),
      first_selected_at: existingItem?.first_selected_at || selectedAt,
      importance_score: Math.max(0, Math.min(100, Math.round(snapshot.editorial_score))),
      last_material_change_at: changedFields.length
        ? selectedAt
        : existingItem?.last_material_change_at || null,
      last_selected_at: selectedAt,
      published_at: jsonString(snapshot.metadata, "publishedAt") || null,
      raw_payload: {
        digestRunId,
        contentModes,
        evidence,
        hasReadableVariant: evidence.fullTextSourceCount > 0,
        practicalBucket,
        recommendedAction: jsonString(snapshot.metadata, "recommendedAction"),
        score: {
          components:
            scoreComponents && typeof scoreComponents === "object" && !Array.isArray(scoreComponents)
              ? scoreComponents
              : {},
          editorial: snapshot.editorial_score,
          importance: Math.max(0, Math.min(100, Math.round(snapshot.editorial_score))),
        },
        storyClusterId: snapshot.story_cluster_id,
        whyInteresting: jsonString(snapshot.metadata, "whyInteresting"),
      },
      source: jsonString(snapshot.metadata, "source") || "Unknown",
      source_count: Math.max(1, sourceVariants.length || snapshot.duplicate_count),
      source_variants: sourceVariants,
      source_url: canonicalUrl,
      selection_score: jsonNumber(snapshot.metadata, "selectionScore") || jsonNumber(scoreComponents || {}, "selection") || snapshot.editorial_score,
      story_cluster_id: snapshot.story_cluster_id,
      summary,
      title: plainTextFromHtml(title),
      topic_tags: deriveTopicTags(title, jsonString(snapshot.metadata, "category") || "general", practicalBucket),
    });
  }

  if (rows.length) {
    const { error: upsertError } = await supabase.from("news_items").upsert(rows, {
      onConflict: "story_cluster_id",
    });

    if (upsertError) {
      throw upsertError;
    }

    await Promise.all(rows.map(async (row) => {
      if (!row.story_cluster_id) return;
      const { error: clusterTagError } = await supabase
        .from("story_clusters")
        .update({ entity_tags: row.entity_tags, topic_tags: row.topic_tags })
        .eq("id", row.story_cluster_id);
      if (clusterTagError) throw clusterTagError;
    }));
  }

  const briefingArticles = rows.map((row) => ({
    category: row.category,
    importanceScore: row.importance_score || 0,
    publishedAt: row.published_at || null,
    source: row.source,
    sourceCount: row.source_count || 1,
    summary: row.summary,
    title: row.title,
      whyInteresting: jsonString(row.raw_payload || {}, "whyInteresting") || null,
      evidenceStatus: row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? (() => {
            const evidence = (row.raw_payload as Record<string, Json | undefined>).evidence;
            return evidence && typeof evidence === "object" && !Array.isArray(evidence) && typeof evidence.status === "string"
              ? evidence.status
              : "limited";
          })()
        : "limited",
      fullTextSourceCount: row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? (() => {
            const evidence = (row.raw_payload as Record<string, Json | undefined>).evidence;
            return evidence && typeof evidence === "object" && !Array.isArray(evidence) && typeof evidence.fullTextSourceCount === "number"
              ? evidence.fullTextSourceCount
              : 0;
          })()
        : 0,
    }));
  const synthesisArticles = briefingArticles.flatMap((article, index) =>
    article.evidenceStatus === "limited" ? [] : [{ article, index }],
  );
  const briefInput = synthesisArticles.length ? synthesisArticles.map(({ article }) => article) : briefingArticles;
  const aiGeneration = settings.useAiSummaries && synthesisArticles.length
    ? await generateDigestBriefWithNvidia({
        attempt: stage.attempt_count,
        interestProfile: {
          feedTargets: settings.feedTargets,
          preferredKeywords: settings.preferredKeywords,
        },
        articles: briefInput,
      })
    : null;

  if (aiGeneration && shouldRetryAiBriefGeneration(aiGeneration.status, stage.attempt_count)) {
    return {
      complete: false,
      message: `AI briefing attempt ${stage.attempt_count}/${MAX_AI_BRIEF_ATTEMPTS} failed; reader publication will retry.`,
      metrics: {
        aiBriefAttempt: stage.attempt_count,
        aiBriefModel: aiGeneration.model,
        aiBriefStatus: aiGeneration.status,
        publishedCount: rows.length,
        settings: {
          publishTopN: settings.publishTopN,
          summaryMaxChars: settings.summaryMaxChars,
          useAiSummaries: settings.useAiSummaries,
        },
      },
    };
  }

  const brief = aiGeneration?.brief ?? fallbackDigestBrief(briefInput);
  const briefCoverageNote = synthesisArticles.length < briefingArticles.length
    ? `${brief.coverageNote} ${briefingArticles.length - synthesisArticles.length} ${briefingArticles.length - synthesisArticles.length === 1 ? "materiał" : "materiały"} o ograniczonym pokryciu pominięto w syntezie.`
    : brief.coverageNote;
  const publishedItems = rows.length
    ? await supabase
        .from("news_items")
        .select("id, story_cluster_id, source, title")
        .in(
          "story_cluster_id",
          rows.flatMap((row) => (row.story_cluster_id ? [row.story_cluster_id] : [])),
        )
    : { data: [], error: null };

  if (publishedItems.error) {
    throw publishedItems.error;
  }

  const publishedItemsByClusterId = new Map((publishedItems.data || []).map((item) => [item.story_cluster_id, item]));
  const referenceForArticleIndex = (articleIndex: number) => {
    const originalIndex = synthesisArticles.length ? synthesisArticles[articleIndex]?.index ?? -1 : articleIndex;
    const row = rows[originalIndex];
    const item = row?.story_cluster_id ? publishedItemsByClusterId.get(row.story_cluster_id) : null;

    return item
      ? {
          newsItemId: item.id,
          source: item.source,
          title: item.title,
        }
      : null;
  };
  const supportForArticleIndexes = (articleIndexes: number[]) => {
    const articles = articleIndexes.flatMap((articleIndex) => {
      const originalIndex = synthesisArticles.length ? synthesisArticles[articleIndex]?.index ?? -1 : articleIndex;
      return originalIndex >= 0 && rows[originalIndex] ? [rows[originalIndex]] : [];
    });
    const evidences = articles.map((row) => {
      const payload = row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, Json | undefined>
        : {};
      return payload.evidence && typeof payload.evidence === "object" && !Array.isArray(payload.evidence)
        ? payload.evidence as Record<string, Json | undefined>
        : {};
    });
    const hasFullText = evidences.some((evidence) => evidence.status === "full_text");
    const hasCorroboration = evidences.some((evidence) => evidence.status === "corroborated_summary");
    return {
      fullTextSourceCount: evidences.reduce((count, evidence) => count + (typeof evidence.fullTextSourceCount === "number" ? evidence.fullTextSourceCount : 0), 0),
      independentSourceCount: Math.max(1, ...articles.map((row) => row.source_count || 1)),
      status: hasFullText ? "full_text" as const : hasCorroboration ? "corroborated_summary" as const : "limited" as const,
    };
  };
  const highlights = brief.highlights.flatMap((highlight) => {
    const reference = referenceForArticleIndex(highlight.articleIndex);

    return reference
      ? [
          {
            ...reference,
            supportsSummary: brief.summaryArticleIndexes.includes(highlight.articleIndex),
            whatHappened: highlight.whatHappened,
            whyItMatters: highlight.whyItMatters,
          },
        ]
      : [];
  });
  const sections = brief.sections.flatMap((section) => {
    const paragraphs = section.paragraphs.flatMap((paragraph) => {
      const references = Array.from(new Set(paragraph.articleIndexes)).flatMap((articleIndex) => {
        const reference = referenceForArticleIndex(articleIndex);
        return reference ? [reference] : [];
      });

      return references.length
        ? [{ references, support: supportForArticleIndexes(paragraph.articleIndexes), text: paragraph.text }]
        : [];
    });

    return paragraphs.length ? [{ category: section.category, paragraphs, title: section.title }] : [];
  });
  const watchlist = brief.watchlist.map((item) => ({
    references: item.articleIndexes.flatMap((articleIndex) => {
      const reference = referenceForArticleIndex(articleIndex);
      return reference ? [reference] : [];
    }),
    signal: item.signal,
    why: item.why,
  }));
  const digestSummary: DigestSummaryInsert = {
    coverage_note: briefCoverageNote,
    digest_date: run.report_date,
    digest_run_id: digestRunId,
    highlights,
    reading_time_minutes: readingTimeMinutesForDigestBrief({
      coverageNote: briefCoverageNote,
      sections,
      summary: brief.summary,
      watchlist,
    }),
    sections,
    summary: brief.summary,
    watchlist,
  };
  const { error: digestSummaryError } = await supabase.from("digest_summaries").upsert(digestSummary, {
    onConflict: "digest_run_id",
  });

  if (digestSummaryError && !isDigestBriefSchemaError(digestSummaryError)) {
    throw digestSummaryError;
  }

  const cleanup = rows.length
    ? await cleanupExpiredReaderData()
    : { deletedEventCount: 0, deletedNewsItemCount: 0 };

  return {
    metrics: {
      deletedEventCount: cleanup.deletedEventCount,
      deletedStaleCount: cleanup.deletedNewsItemCount,
      digestBriefHighlightCount: highlights.length,
      digestBriefSectionCount: sections.length,
      aiBriefAttempt: aiGeneration ? stage.attempt_count : null,
      aiBriefModel: aiGeneration?.model ?? null,
      aiBriefStatus: aiGeneration?.status ?? "disabled_or_unsupported",
      publishedCount: rows.length,
      settings: {
        publishTopN: settings.publishTopN,
        summaryMaxChars: settings.summaryMaxChars,
        useAiSummaries: settings.useAiSummaries,
      },
    },
  };
};

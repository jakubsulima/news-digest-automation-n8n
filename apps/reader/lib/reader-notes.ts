import "server-only";

import type { Database, Json } from "./database.types";
import {
  READER_NOTE_CONTEXT_MAX_LENGTH,
  READER_NOTE_KINDS,
  READER_NOTE_MAX_LENGTH,
  READER_NOTE_QUOTE_MAX_LENGTH,
  READER_NOTE_STATUSES,
  type ReaderNote,
  type ReaderNoteKind,
  type ReaderNoteStatus,
} from "./reader-note-types";
import { createSupabaseAdminClient } from "./supabase";
import { plainTextFromHtml } from "./text";

export type CreateReaderNoteInput = {
  articleId: string | null;
  kind: ReaderNoteKind;
  newsItemId: string;
  noteText: string;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  quoteText: string | null;
};

export type UpdateReaderNoteInput = {
  kind?: ReaderNoteKind;
  noteText?: string;
  status?: ReaderNoteStatus;
};

export type ReaderNoteFilters = {
  kind?: ReaderNoteKind | null;
  query?: string | null;
  status?: ReaderNoteStatus | null;
};

type ReaderNoteRow = Database["public"]["Tables"]["reader_notes"]["Row"];
type NewsItemNoteSource = Pick<
  Database["public"]["Tables"]["news_items"]["Row"],
  | "entity_tags"
  | "id"
  | "published_at"
  | "raw_payload"
  | "source"
  | "source_url"
  | "story_cluster_id"
  | "summary"
  | "title"
  | "topic_tags"
>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KIND_SET = new Set<string>(READER_NOTE_KINDS);
const STATUS_SET = new Set<string>(READER_NOTE_STATUSES);

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function optionalBoundedText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized || null : undefined;
}

function jsonStringList(value: Json): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeForComparison(value: string) {
  return plainTextFromHtml(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function parseCreateReaderNoteInput(value: unknown): CreateReaderNoteInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const noteText = typeof input.noteText === "string" ? input.noteText.trim() : "";
  const quoteText = optionalBoundedText(input.quoteText, READER_NOTE_QUOTE_MAX_LENGTH);
  const quotePrefix = optionalBoundedText(input.quotePrefix, READER_NOTE_CONTEXT_MAX_LENGTH);
  const quoteSuffix = optionalBoundedText(input.quoteSuffix, READER_NOTE_CONTEXT_MAX_LENGTH);
  const articleId = input.articleId === undefined || input.articleId === null ? null : input.articleId;

  if (
    !isUuid(input.newsItemId) ||
    (articleId !== null && !isUuid(articleId)) ||
    typeof input.kind !== "string" ||
    !KIND_SET.has(input.kind) ||
    noteText.length > READER_NOTE_MAX_LENGTH ||
    quoteText === undefined ||
    quotePrefix === undefined ||
    quoteSuffix === undefined ||
    (!noteText && !quoteText)
  ) {
    return null;
  }

  return {
    articleId,
    kind: input.kind as ReaderNoteKind,
    newsItemId: input.newsItemId,
    noteText,
    quotePrefix,
    quoteSuffix,
    quoteText,
  };
}

export function parseUpdateReaderNoteInput(value: unknown): UpdateReaderNoteInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const update: UpdateReaderNoteInput = {};

  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !KIND_SET.has(input.kind)) return null;
    update.kind = input.kind as ReaderNoteKind;
  }
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !STATUS_SET.has(input.status)) return null;
    update.status = input.status as ReaderNoteStatus;
  }
  if (input.noteText !== undefined) {
    if (typeof input.noteText !== "string") return null;
    const noteText = input.noteText.trim();
    if (noteText.length > READER_NOTE_MAX_LENGTH) return null;
    update.noteText = noteText;
  }

  return Object.keys(update).length ? update : null;
}

export function noteMatchesQuery(note: ReaderNote, query: string) {
  const normalized = normalizeForComparison(query);
  if (!normalized) return true;
  return normalizeForComparison([
    note.noteText,
    note.quoteText || "",
    note.title,
    note.source,
    ...note.topicTags,
    ...note.entityTags,
  ].join(" ")).includes(normalized);
}

function readerNoteFromRow(row: ReaderNoteRow): ReaderNote {
  return {
    articleId: row.article_id,
    createdAt: row.created_at,
    entityTags: jsonStringList(row.entity_tags_snapshot),
    id: row.id,
    kind: row.kind,
    newsItemId: row.news_item_id,
    noteText: row.note_text,
    publishedAt: row.published_at_snapshot,
    quotePrefix: row.quote_prefix,
    quoteSuffix: row.quote_suffix,
    quoteText: row.quote_text,
    source: row.source_snapshot,
    sourceUrl: row.source_url_snapshot,
    status: row.status,
    storyClusterId: row.story_cluster_id,
    title: row.title_snapshot,
    topicTags: jsonStringList(row.topic_tags_snapshot),
    updatedAt: row.updated_at,
  };
}

async function loadArticleForNote(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  item: NewsItemNoteSource,
  articleId: string,
) {
  const [{ data: article, error: articleError }, { data: clusterLink, error: linkError }] = await Promise.all([
    supabase
      .from("articles")
      .select("id, canonical_url, source, raw_summary, enriched_text")
      .eq("id", articleId)
      .maybeSingle(),
    item.story_cluster_id
      ? supabase
          .from("story_cluster_articles")
          .select("article_id")
          .eq("story_cluster_id", item.story_cluster_id)
          .eq("article_id", articleId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (articleError || linkError) throw articleError || linkError;
  if (!article || (item.story_cluster_id && !clusterLink)) throw new Error("Article does not belong to this story.");
  return article;
}

export async function createReaderNote(userId: string, input: CreateReaderNoteInput) {
  const supabase = createSupabaseAdminClient();
  const { data: item, error: itemError } = await supabase
    .from("news_items")
    .select("id, story_cluster_id, title, summary, source, source_url, published_at, topic_tags, entity_tags, raw_payload")
    .eq("id", input.newsItemId)
    .maybeSingle();

  if (itemError) throw itemError;
  if (!item) throw new Error("News item not found.");

  const article = input.articleId ? await loadArticleForNote(supabase, item, input.articleId) : null;
  if (input.quoteText) {
    const itemMaterial = [item.title, item.summary, JSON.stringify(item.raw_payload)].join(" ");
    const material = article ? [article.enriched_text || "", article.raw_summary, itemMaterial].join(" ") : itemMaterial;
    if (!normalizeForComparison(material).includes(normalizeForComparison(input.quoteText))) {
      throw new Error("Selected quote is no longer available in this article.");
    }
  }

  const row: Database["public"]["Tables"]["reader_notes"]["Insert"] = {
    article_id: article?.id || null,
    entity_tags_snapshot: item.entity_tags,
    kind: input.kind,
    news_item_id: item.id,
    note_text: input.noteText,
    published_at_snapshot: item.published_at,
    quote_prefix: input.quotePrefix,
    quote_suffix: input.quoteSuffix,
    quote_text: input.quoteText,
    source_snapshot: article?.source || item.source,
    source_url_snapshot: article?.canonical_url || item.source_url,
    story_cluster_id: item.story_cluster_id,
    title_snapshot: plainTextFromHtml(item.title),
    topic_tags_snapshot: item.topic_tags,
    user_id: userId,
  };
  const { data, error } = await supabase.from("reader_notes").insert(row).select("*").single();
  if (error) throw error;
  return readerNoteFromRow(data);
}

export async function getReaderNotes(userId: string, filters: ReaderNoteFilters = {}) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("reader_notes")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);

  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw error;
  const notes = (data || []).map(readerNoteFromRow);
  return filters.query ? notes.filter((note) => noteMatchesQuery(note, filters.query!)) : notes;
}

export async function getReaderNoteCounts(userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_notes")
    .select("news_item_id")
    .eq("user_id", userId)
    .not("news_item_id", "is", null);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data || []) {
    if (row.news_item_id) counts.set(row.news_item_id, (counts.get(row.news_item_id) || 0) + 1);
  }
  return counts;
}

export async function getReaderNoteCount(userId: string, newsItemId: string) {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("reader_notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("news_item_id", newsItemId);
  if (error) throw error;
  return count || 0;
}

export async function updateReaderNote(userId: string, noteId: string, input: UpdateReaderNoteInput) {
  const supabase = createSupabaseAdminClient();
  const update: Database["public"]["Tables"]["reader_notes"]["Update"] = {};
  if (input.kind !== undefined) update.kind = input.kind;
  if (input.noteText !== undefined) update.note_text = input.noteText;
  if (input.status !== undefined) update.status = input.status;
  const { data, error } = await supabase
    .from("reader_notes")
    .update(update)
    .eq("id", noteId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Reader note not found.");
  return readerNoteFromRow(data);
}

export async function deleteReaderNote(userId: string, noteId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Reader note not found.");
}

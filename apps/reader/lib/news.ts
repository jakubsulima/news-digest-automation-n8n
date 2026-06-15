import "server-only";

import { createSupabaseAdminClient } from "./supabase";

export type NewsItemWithState = {
  id: string;
  externalId: string;
  digestDate: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  category: string;
  importanceScore: number | null;
  publishedAt: string | null;
  readAt: string | null;
  savedAt: string | null;
  archivedAt: string | null;
};

export async function getReaderNewsItems(userId: string): Promise<NewsItemWithState[]> {
  const supabase = createSupabaseAdminClient();

  const [{ data: items, error: itemError }, { data: states, error: stateError }] = await Promise.all([
    supabase
      .from("news_items")
      .select(
        "id, external_id, digest_date, title, summary, source, source_url, category, importance_score, published_at",
      )
      .order("digest_date", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase
      .from("reader_item_states")
      .select("news_item_id, read_at, saved_at, archived_at")
      .eq("user_id", userId),
  ]);

  if (itemError) {
    throw itemError;
  }
  if (stateError) {
    throw stateError;
  }

  const statesByItemId = new Map((states || []).map((state) => [state.news_item_id, state]));

  return (items || []).map((item) => {
    const state = statesByItemId.get(item.id);
    return {
      id: item.id,
      externalId: item.external_id,
      digestDate: item.digest_date,
      title: item.title,
      summary: item.summary,
      source: item.source,
      sourceUrl: item.source_url,
      category: item.category,
      importanceScore: item.importance_score,
      publishedAt: item.published_at,
      readAt: state?.read_at ?? null,
      savedAt: state?.saved_at ?? null,
      archivedAt: state?.archived_at ?? null,
    };
  });
}

export async function getReaderNewsItem(itemId: string, userId: string): Promise<NewsItemWithState | null> {
  const supabase = createSupabaseAdminClient();

  const [{ data: item, error: itemError }, { data: state, error: stateError }] = await Promise.all([
    supabase
      .from("news_items")
      .select(
        "id, external_id, digest_date, title, summary, source, source_url, category, importance_score, published_at",
      )
      .eq("id", itemId)
      .single(),
    supabase
      .from("reader_item_states")
      .select("news_item_id, read_at, saved_at, archived_at")
      .eq("user_id", userId)
      .eq("news_item_id", itemId)
      .maybeSingle(),
  ]);

  if (itemError) {
    if (itemError.code === "PGRST116") {
      return null;
    }
    throw itemError;
  }
  if (stateError) {
    throw stateError;
  }

  return {
    id: item.id,
    externalId: item.external_id,
    digestDate: item.digest_date,
    title: item.title,
    summary: item.summary,
    source: item.source,
    sourceUrl: item.source_url,
    category: item.category,
    importanceScore: item.importance_score,
    publishedAt: item.published_at,
    readAt: state?.read_at ?? null,
    savedAt: state?.saved_at ?? null,
    archivedAt: state?.archived_at ?? null,
  };
}

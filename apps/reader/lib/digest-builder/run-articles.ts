import "server-only";

import type { Database } from "../database.types";
import { createSupabaseAdminClient } from "../supabase";

export type RunArticle = Database["public"]["Tables"]["articles"]["Row"];

export async function loadRunArticles(digestRunId: string): Promise<RunArticle[]> {
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

export async function loadRunArticlesByIds(articleIds: string[]): Promise<RunArticle[]> {
  if (!articleIds.length) return [];
  const supabase = createSupabaseAdminClient();
  const rows: RunArticle[] = [];
  for (let offset = 0; offset < articleIds.length; offset += 200) {
    const { data, error } = await supabase.from("articles").select("*").in("id", articleIds.slice(offset, offset + 200));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

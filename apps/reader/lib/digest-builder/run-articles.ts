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

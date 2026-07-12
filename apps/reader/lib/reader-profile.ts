import "server-only";

import { createSupabaseAdminClient } from "./supabase";

export async function getReaderLastVisit(userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_profiles")
    .select("last_feed_visited_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.last_feed_visited_at ?? null;
}

export async function recordReaderVisit(userId: string, visitedAt = new Date().toISOString()) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("reader_profiles").upsert(
    { last_feed_visited_at: visitedAt, user_id: userId },
    { onConflict: "user_id" },
  );

  if (error) throw error;
  return visitedAt;
}

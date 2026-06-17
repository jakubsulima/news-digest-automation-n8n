import "server-only";

import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type ReaderItemStateField = "read_at" | "saved_at" | "archived_at";

export async function setReaderItemState(
  userId: string,
  newsItemId: string,
  field: ReaderItemStateField,
  enabled: boolean,
) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const row: Database["public"]["Tables"]["reader_item_states"]["Insert"] = {
    news_item_id: newsItemId,
    user_id: userId,
  };

  row[field] = enabled ? now : null;

  const { error } = await supabase.from("reader_item_states").upsert(row, {
    onConflict: "news_item_id,user_id",
  });

  if (error) {
    throw error;
  }
}

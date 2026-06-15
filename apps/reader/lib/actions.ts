"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentReader } from "./auth";
import type { Database } from "./database.types";
import { advanceDigestRun as advanceDigestRunStage } from "./digest-stage-executor";
import { getActiveDigestRun, startOrGetActiveDigestRun } from "./digest-runs";
import { requireCurrentOperator } from "./operator";
import { createSupabaseAdminClient } from "./supabase";

type StateField = "read_at" | "saved_at" | "archived_at";

async function setItemState(newsItemId: string, field: StateField, enabled: boolean) {
  const user = await requireCurrentReader();
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const row: Database["public"]["Tables"]["reader_item_states"]["Insert"] = {
    news_item_id: newsItemId,
    user_id: user.id,
  };

  row[field] = enabled ? now : null;

  const { error } = await supabase.from("reader_item_states").upsert(row, {
    onConflict: "news_item_id,user_id",
  });

  if (error) {
    throw error;
  }

  revalidatePath("/");
}

export async function toggleRead(newsItemId: string, currentValue: boolean) {
  await setItemState(newsItemId, "read_at", !currentValue);
}

export async function toggleSaved(newsItemId: string, currentValue: boolean) {
  await setItemState(newsItemId, "saved_at", !currentValue);
}

export async function toggleArchived(newsItemId: string, currentValue: boolean) {
  await setItemState(newsItemId, "archived_at", !currentValue);
}

export async function startDigestRun() {
  const operator = await requireCurrentOperator();
  await startOrGetActiveDigestRun(operator.id);
  revalidatePath("/");
}

export async function advanceDigestRun() {
  await requireCurrentOperator();
  const run = await getActiveDigestRun();

  if (!run) {
    return;
  }

  await advanceDigestRunStage(run.id);
  revalidatePath("/");
}

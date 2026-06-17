"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentReader } from "./auth";
import { advanceDigestRun as advanceDigestRunStage } from "./digest-stage-executor";
import { getActiveDigestRun, retryFailedDigestRun, startOrGetActiveDigestRun } from "./digest-runs";
import { requireCurrentOperator } from "./operator";
import { setReaderItemState, type ReaderItemStateField } from "./reader-item-states";

async function setItemState(newsItemId: string, field: ReaderItemStateField, enabled: boolean) {
  const user = await requireCurrentReader();
  await setReaderItemState(user.id, newsItemId, field, enabled);
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

export async function retryDigestRun(digestRunId: string) {
  await requireCurrentOperator();
  await retryFailedDigestRun(digestRunId);
  revalidatePath("/");
}

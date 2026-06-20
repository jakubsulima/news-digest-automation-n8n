"use server";

import { revalidatePath } from "next/cache";

import { retryFailedDigestRun } from "./digest-runs";
import { requireCurrentOperator } from "./operator";

export async function retryDigestRun(digestRunId: string) {
  await requireCurrentOperator();
  await retryFailedDigestRun(digestRunId);
  revalidatePath("/");
}

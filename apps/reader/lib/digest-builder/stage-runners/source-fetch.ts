import "server-only";

import { getReaderSourcesForRun } from "../../reader-sources";
import { createSupabaseAdminClient } from "../../supabase";
import { fetchSourceItemsForRun } from "../source-item-intake";
import type { StageRunner } from "../types";

export const runSourceFetchStage: StageRunner = async ({ digestRunId }) => {
  const sources = await getReaderSourcesForRun();
  const { metrics, sourceItems } = await fetchSourceItemsForRun({ digestRunId, sources });
  const supabase = createSupabaseAdminClient();
  const { error: deleteError } = await supabase.from("source_items").delete().eq("digest_run_id", digestRunId);

  if (deleteError) {
    throw deleteError;
  }

  if (sourceItems.length) {
    const { error: insertError } = await supabase.from("source_items").insert(sourceItems);

    if (insertError) {
      throw insertError;
    }
  }

  return { metrics };
};

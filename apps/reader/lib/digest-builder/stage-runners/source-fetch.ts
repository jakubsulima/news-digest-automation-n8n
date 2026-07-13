import "server-only";

import { getReaderSourcesForRun } from "../../reader-sources";
import { createSupabaseAdminClient } from "../../supabase";
import { fetchSourceItemsForRun } from "../source-item-intake";
import type { StageRunner } from "../types";

export const runSourceFetchStage: StageRunner = async ({ digestRunId }) => {
  const sources = await getReaderSourcesForRun();
  const { metrics, sourceItems, sourceObservations } = await fetchSourceItemsForRun({ digestRunId, sources });
  const supabase = createSupabaseAdminClient();
  const [{ error: deleteError }, { error: observationDeleteError }] = await Promise.all([
    supabase.from("source_items").delete().eq("digest_run_id", digestRunId),
    supabase.from("source_run_observations").delete().eq("digest_run_id", digestRunId),
  ]);

  if (deleteError) {
    throw deleteError;
  }
  if (observationDeleteError) {
    throw observationDeleteError;
  }

  if (sourceItems.length) {
    const { error: insertError } = await supabase.from("source_items").insert(sourceItems);

    if (insertError) {
      throw insertError;
    }
  }

  if (sourceObservations.length) {
    const { error: observationError } = await supabase.from("source_run_observations").insert(sourceObservations);

    if (observationError) {
      throw observationError;
    }
  }

  return { metrics };
};

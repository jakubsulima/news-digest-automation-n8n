import "server-only";

import { z } from "zod";

import rssSources from "../../../../../config/rss-sources.json";
import { createSupabaseAdminClient } from "../../supabase";
import { fetchSourceItemsForRun } from "../source-item-intake";
import type { StageRunner } from "../types";

const sourceConfigSchema = z.array(
  z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url(),
    priority: z.number().int().optional(),
  }),
);

function readSourceConfig() {
  return sourceConfigSchema.parse(rssSources);
}

export const runSourceFetchStage: StageRunner = async ({ digestRunId }) => {
  const sources = readSourceConfig();
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

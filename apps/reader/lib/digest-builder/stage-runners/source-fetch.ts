import "server-only";

import { getReaderSourcesForRun } from "../../reader-sources";
import {
  getLastSuccessfulSourcePortfolio,
  getOrCreateSourcePortfolio,
  type PortfolioSource,
} from "../../source-portfolio";
import { createSupabaseAdminClient } from "../../supabase";
import { fetchSourceItemsForRun } from "../source-item-intake";
import type { StageRunner } from "../types";

export const runSourceFetchStage: StageRunner = async ({ digestRunId }) => {
  let sources: PortfolioSource[];
  let portfolioFallback = false;
  let portfolioMode: "manual" | "advisory" | "automatic" = "manual";
  let proposedChangeCount = 0;

  try {
    const portfolio = await getOrCreateSourcePortfolio(digestRunId);
    sources = portfolio.sources;
    portfolioMode = portfolio.mode;
    proposedChangeCount = portfolio.decisions.filter(
      (decision) => decision.proposedSelected !== decision.legacyEnabled,
    ).length;
    if (!sources.length) throw new Error("Source Portfolio returned no fetchable sources.");
  } catch (error) {
    portfolioFallback = true;
    const previous = await getLastSuccessfulSourcePortfolio().catch(() => null);
    sources = previous?.sources || (await getReaderSourcesForRun()).map((source) => ({
      ...source,
      portfolioRole: "selected",
    }));
  }

  const { metrics, sourceItems, sourceObservations } = await fetchSourceItemsForRun({ digestRunId, sources });
  const publishableSourceIds = new Set(
    sources.filter((source) => source.portfolioRole !== "probe").map((source) => source.id),
  );
  const publishableSourceItems = sourceItems.filter(
    (item) => !item.reader_source_id || publishableSourceIds.has(item.reader_source_id),
  );
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

  if (publishableSourceItems.length) {
    const { error: insertError } = await supabase.from("source_items").insert(publishableSourceItems);

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

  return {
    metrics: {
      ...metrics,
      portfolioFallback,
      portfolioMode,
      probeItemCount: sourceItems.length - publishableSourceItems.length,
      proposedChangeCount,
    },
  };
};

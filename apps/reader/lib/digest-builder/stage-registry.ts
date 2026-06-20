import "server-only";

import { runArticleNormalizationStage } from "./stage-runners/article-normalization";
import { runEditorialScoringStage } from "./stage-runners/editorial-scoring";
import { runEnrichmentStage } from "./stage-runners/enrichment";
import { runFinalizationStage } from "./stage-runners/finalization";
import { runReaderPublicationStage } from "./stage-runners/reader-publication";
import { runSourceFetchStage } from "./stage-runners/source-fetch";
import { runStoryClusteringStage } from "./stage-runners/story-clustering";
import type { PipelineStageRun, StageResult, StageRunner } from "./types";

const STAGE_RUNNERS: Record<PipelineStageRun["stage_name"], StageRunner> = {
  article_normalization: runArticleNormalizationStage,
  editorial_scoring: runEditorialScoringStage,
  enrichment: runEnrichmentStage,
  finalization: runFinalizationStage,
  reader_publication: runReaderPublicationStage,
  source_fetch: runSourceFetchStage,
  story_clustering: runStoryClusteringStage,
};

export async function runStageForRun(stage: PipelineStageRun, digestRunId: string): Promise<StageResult> {
  const runner = STAGE_RUNNERS[stage.stage_name];

  if (!runner) {
    throw new Error(`${stage.stage_name} stage is not ported to the hosted pipeline yet.`);
  }

  return runner({ digestRunId, stage });
}

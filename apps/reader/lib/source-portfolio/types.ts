import type { ReaderSource } from "../reader-sources";
import type { DigestFeedTargets, SourcePortfolioMode } from "../digest-settings";

export type SourcePortfolioMetrics = {
  confirmationValue: number;
  fetchPenalty: number;
  freshYield: number;
  healthyProbeCount: number;
  readerValue: number;
  redundancyPenalty: number;
  reliability: number;
  runCount: number;
  selectionValue: number;
  uniqueYield: number;
};

export type SourcePortfolioInput = {
  categoryMinimums: DigestFeedTargets;
  explorationCount: number;
  maxChangeRatio: number;
  mode: SourcePortfolioMode;
  previousSelectedIds?: Set<string>;
  probeCount: number;
  sourceBudget: number;
  sources: Array<ReaderSource & { metrics: SourcePortfolioMetrics }>;
};

export type SourcePortfolioDecision = {
  actualSelected: boolean;
  confidence: number;
  legacyEnabled: boolean;
  proposedSelected: boolean;
  reasons: string[];
  role: "selected" | "explore" | "probe" | "skipped";
  score: number;
  scoreComponents: Record<string, number>;
  sourceId: string;
};

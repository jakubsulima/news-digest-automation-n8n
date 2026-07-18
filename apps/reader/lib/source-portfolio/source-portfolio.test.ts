import { describe, expect, it } from "vitest";

import {
  buildSourcePortfolio,
  evaluateSourceAutopilotGate,
  type SourcePortfolioInput,
} from "./index";

const neutralMetrics = {
  confirmationValue: 50,
  fetchPenalty: 0,
  freshYield: 50,
  healthyProbeCount: 0,
  readerValue: 50,
  redundancyPenalty: 0,
  reliability: 50,
  runCount: 0,
  selectionValue: 50,
  uniqueYield: 50,
};
const discoveryMetadata = {
  feedType: "unknown" as const,
  language: "unknown",
  lastValidatedAt: null,
  validationStatus: "unverified" as const,
};

function input(overrides: Partial<SourcePortfolioInput> = {}): SourcePortfolioInput {
  return {
    categoryMinimums: { ai: 2, business: 0, geopolitics: 0, security: 0, software: 0 },
    explorationCount: 1,
    maxChangeRatio: 0.2,
    mode: "advisory",
    probeCount: 1,
    sourceBudget: 2,
    sources: [
      { ...discoveryMetadata, category: "AI", enabled: true, id: "always", metrics: neutralMetrics, name: "Always", priority: 5, selectionMode: "always_on", url: "https://always.test/feed" },
      { ...discoveryMetadata, category: "AI", enabled: false, id: "auto", metrics: { ...neutralMetrics, runCount: 10, reliability: 100, uniqueYield: 100 }, name: "Auto", priority: 3, selectionMode: "auto", url: "https://auto.test/feed" },
      { ...discoveryMetadata, category: "AI", enabled: false, id: "blocked", metrics: neutralMetrics, name: "Blocked", priority: 3, selectionMode: "blocked", url: "https://blocked.test/feed" },
    ],
    ...overrides,
  };
}

describe("Source Portfolio", () => {
  it("keeps low-evidence scores neutral and respects hard source modes", () => {
    const { decisions } = buildSourcePortfolio(input());
    expect(decisions.find((decision) => decision.sourceId === "always")).toMatchObject({
      confidence: 0,
      proposedSelected: true,
      score: 50,
    });
    expect(decisions.find((decision) => decision.sourceId === "blocked")?.proposedSelected).toBe(false);
  });

  it("does not change actual input in advisory mode", () => {
    const { decisions } = buildSourcePortfolio(input());
    expect(decisions.filter((decision) => decision.actualSelected).map((decision) => decision.sourceId)).toEqual(["always"]);
    expect(decisions.find((decision) => decision.sourceId === "auto")).toMatchObject({
      actualSelected: false,
      proposedSelected: true,
    });
  });

  it("limits automatic churn and creates bounded probes", () => {
    const { decisions } = buildSourcePortfolio(input({
      mode: "automatic",
      previousSelectedIds: new Set(["always", "blocked"]),
    }));
    expect(decisions.filter((decision) => decision.actualSelected)).toHaveLength(2);
    expect(decisions.filter((decision) => decision.role === "probe").length).toBeLessThanOrEqual(1);
  });

  it("is deterministic and only explores after three healthy probes", () => {
    const options = input({
      categoryMinimums: { ai: 1, business: 0, geopolitics: 0, security: 0, software: 0 },
      mode: "automatic",
      sources: [
        input().sources[0],
        {
          ...input().sources[1],
          metrics: { ...input().sources[1].metrics, healthyProbeCount: 3 },
        },
        { ...input().sources[2], enabled: false, selectionMode: "auto" },
      ],
    });
    const first = buildSourcePortfolio(options);
    const second = buildSourcePortfolio(options);

    expect(first).toEqual(second);
    expect(first.decisions.find((decision) => decision.sourceId === "auto")?.role).toBe("explore");
    expect(first.decisions.filter((decision) => decision.role === "explore")).toHaveLength(1);
  });
});

describe("Source Portfolio autopilot gate", () => {
  it("requires ten healthy automatic runs within the rollout tolerances", () => {
    const baseline = [{ categoryCoverage: 5, fetchFailureRate: 0.1, runId: "baseline", topPublisherConcentration: 0.3, uniqueSelectedStories: 20 }];
    const automatic = Array.from({ length: 10 }, (_, index) => ({
      categoryCoverage: 5,
      fetchFailureRate: 0.1,
      runId: `auto-${index}`,
      topPublisherConcentration: 0.4,
      uniqueSelectedStories: 19,
    }));

    expect(evaluateSourceAutopilotGate(automatic, baseline)).toMatchObject({ passed: true });
    expect(evaluateSourceAutopilotGate(automatic.slice(0, 9), baseline)).toMatchObject({ passed: false });
  });
});

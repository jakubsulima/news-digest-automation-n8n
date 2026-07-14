import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sourceQualityFromObservations } from "./source-quality";

function observation(overrides: Record<string, unknown> = {}) {
  return {
    confirmation_story_count: 2,
    eligible_item_count: 10,
    parsed_item_count: 20,
    selected_story_count: 3,
    source_name: "Source",
    source_url: "https://example.test/feed",
    status: "succeeded" as const,
    unique_story_count: 5,
    ...overrides,
  };
}

describe("source quality", () => {
  it("waits for enough runs before recommending changes", () => {
    expect(sourceQualityFromObservations([observation(), observation()]).label).toBe("Collecting data");
  });

  it("separates reliability, yield, selection, and confirmation dimensions", () => {
    const insight = sourceQualityFromObservations(Array.from({ length: 6 }, () => observation()), 12);

    expect(insight).toMatchObject({
      confirmationValue: 40,
      freshYield: 50,
      label: "Often selected",
      reliability: 100,
      selectionValue: 60,
      uniqueYield: 50,
    });
  });

  it("only considers pausing after repeated failures", () => {
    const insight = sourceQualityFromObservations(
      Array.from({ length: 8 }, (_, index) => observation({ status: index < 2 ? "succeeded" : "failed" })),
    );

    expect(insight.recommendation).toBe("consider_pausing");
  });
});

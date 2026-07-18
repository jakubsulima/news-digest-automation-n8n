import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readerValueBySourceIdentity, sourceQualityFromObservations } from "./source-quality";

function observation(overrides: Record<string, unknown> = {}) {
  return {
    confirmation_story_count: 2,
    eligible_item_count: 10,
    parsed_item_count: 20,
    selected_story_count: 3,
    source_name: "Source",
    reader_source_id: "source-1",
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

  it("attributes direct source value by stable identity and divides shared story value", () => {
    const storySources = [
      { contribution_type: "canonical" as const, reader_source_id: "source-1", story_cluster_id: "story-1" },
      { contribution_type: "confirmation" as const, reader_source_id: "source-2", story_cluster_id: "story-1" },
    ];
    const common = {
      interaction_origin: "direct" as const,
      metadata: {},
      story_cluster_id: "story-1",
    };
    const values = readerValueBySourceIdentity([
      { ...common, event_type: "source_open", metadata: { readerSourceId: "source-2" } },
      { ...common, event_type: "save" },
      { ...common, event_type: "read", interaction_origin: "bulk" },
      { ...common, event_type: "feedback", metadata: { feedback: "more", readerSourceId: "source-1", reason: "source" } },
    ], storySources);

    expect(values.get("source-1")).toBe(3.5);
    expect(values.get("source-2")).toBe(2.5);
  });
});

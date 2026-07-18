import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { explicitPreferenceSignalForItem } from "./preference-signals";

const item = {
  category: "AI / Software",
  entity_tags: ["OpenAI", "Microsoft"],
  id: "news-1",
  source: "Example Source",
  source_variants: [{ readerSourceId: "source-1" }],
  story_cluster_id: "story-1",
  topic_tags: ["agents", "developer tools"],
};

describe("Preference Signals", () => {
  it("targets independent topic, entity and stable source dimensions", () => {
    expect(explicitPreferenceSignalForItem(item, "topic", "more")).toMatchObject({
      dimension: "topic",
      target: "agents",
    });
    expect(explicitPreferenceSignalForItem(item, "entity", "less")).toMatchObject({
      dimension: "entity",
      target: "OpenAI",
    });
    expect(explicitPreferenceSignalForItem(item, "source", "less")).toMatchObject({
      dimension: "source",
      reader_source_id: "source-1",
      target: "Example Source",
    });
  });

  it("keeps repetition and quality scoped to the durable story", () => {
    expect(explicitPreferenceSignalForItem(item, "repetitive", "less")?.target).toBe("story-1");
    expect(explicitPreferenceSignalForItem(item, "quality", "less")?.target).toBe("story-1");
  });
});

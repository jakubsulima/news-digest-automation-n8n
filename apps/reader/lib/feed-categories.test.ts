import { describe, expect, it } from "vitest";

import { itemMatchesReaderFeed, normalizeReaderFeedId, readerFeedForCategory } from "./feed-categories";

describe("feed categories", () => {
  it("normalizes unknown feed ids to all", () => {
    expect(normalizeReaderFeedId("geopolitics")).toBe("geopolitics");
    expect(normalizeReaderFeedId("unknown")).toBe("all");
    expect(normalizeReaderFeedId(["security"])).toBe("security");
  });

  it("groups detailed source categories into reader feeds", () => {
    expect(readerFeedForCategory("Świat / Geopolityka / Europa")).toBe("geopolitics");
    expect(readerFeedForCategory("Świat / Biznes / Makro")).toBe("business");
    expect(readerFeedForCategory("AI / Open Source")).toBe("ai");
    expect(readerFeedForCategory("Software / Engineering")).toBe("software");
    expect(readerFeedForCategory("Cyberbezpieczeństwo PL")).toBe("security");
  });

  it("matches only items in the selected category feed", () => {
    expect(itemMatchesReaderFeed("Cybersecurity Global", "security")).toBe(true);
    expect(itemMatchesReaderFeed("Cybersecurity Global", "geopolitics")).toBe(false);
    expect(itemMatchesReaderFeed("Cybersecurity Global", "all")).toBe(true);
  });
});

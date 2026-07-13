import { describe, expect, it } from "vitest";

import { keywordHitCount, matchingKeywords, textMatchesAnyKeyword } from "./keyword-matching";

describe("keyword matching", () => {
  it("matches full words without matching fragments inside unrelated words", () => {
    expect(textMatchesAnyKeyword("The company disclosed new capital spending.", ["api"])).toBe(false);
    expect(textMatchesAnyKeyword("The pharmacy opened a new location.", ["arm"])).toBe(false);
    expect(textMatchesAnyKeyword("The statement said demand remained stable.", ["ai"])).toBe(false);
    expect(textMatchesAnyKeyword("The SEC published a filing.", ["sec"])).toBe(true);
  });

  it("matches phrases across punctuation and hyphens", () => {
    expect(matchingKeywords("An actively-exploited zero-day needs an emergency patch.", [
      "zero day",
      "emergency patch",
    ])).toEqual(["zero day", "emergency patch"]);
  });

  it("normalizes case and counts each configured signal once", () => {
    expect(keywordHitCount("OpenAI released an API. The API is public.", ["openai", "API", "api"])).toBe(2);
  });
});

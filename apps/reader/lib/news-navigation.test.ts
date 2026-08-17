import { describe, expect, it } from "vitest";

import { newsDetailHref, newsListHref, normalizeNewsListHref } from "./news-navigation";

describe("news navigation", () => {
  it("keeps non-default feed controls in the list URL", () => {
    expect(newsListHref({ feed: "ai", period: "history", sort: "latest", view: "saved" }))
      .toBe("/news?feed=ai&view=saved&sort=latest&period=history");
  });

  it("removes defaults and unsupported return URL values", () => {
    expect(normalizeNewsListHref("/news?feed=unknown&view=unread&extra=value"))
      .toBe("/news?view=unread");
    expect(normalizeNewsListHref("https://example.com/news?feed=ai")).toBe("/news");
  });

  it("includes a safe list return URL in detail links", () => {
    expect(newsDetailHref("story/id", "/news?feed=security&sort=top"))
      .toBe("/news/story%2Fid?from=%2Fnews%3Ffeed%3Dsecurity%26sort%3Dtop");
  });
});

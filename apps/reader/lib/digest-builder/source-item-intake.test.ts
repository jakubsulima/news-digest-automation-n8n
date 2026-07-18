import { describe, expect, it, vi } from "vitest";

import { fetchSourceItemsForRun, parseSourceFeed, type SourceConfig } from "./source-item-intake";

const source: SourceConfig = {
  category: "security",
  name: "Example Feed",
  priority: 7,
  url: "https://feeds.example.test/rss",
};

function rawPayload(item: ReturnType<typeof parseSourceFeed>[number]) {
  return item.raw_payload as Record<string, unknown>;
}

describe("parseSourceFeed", () => {
  it("parses RSS items into Source Items", () => {
    const items = parseSourceFeed(
      `<rss><channel><item>
        <title>Launch &amp; breach</title>
        <link>https://example.com/story?utm_source=x&id=1#section</link>
        <description><![CDATA[<p>Summary &amp; context</p>]]></description>
        <guid>story-1</guid>
        <pubDate>Fri, 19 Jun 2026 10:15:00 GMT</pubDate>
      </item></channel></rss>`,
      source,
      "run-1",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: "security",
      digest_run_id: "run-1",
      normalized_url: "https://example.com/story?id=1",
      published_at: "2026-06-19T10:15:00.000Z",
      source_name: "Example Feed",
      source_url: "https://feeds.example.test/rss",
    });
    expect(rawPayload(items[0])).toMatchObject({
      guid: "story-1",
      link: "https://example.com/story?utm_source=x&id=1#section",
      sourcePriority: 7,
      summary: "Summary & context",
      title: "Launch & breach",
    });
  });

  it("parses Atom entries with link href attributes", () => {
    const items = parseSourceFeed(
      `<feed><entry>
        <title>Atom story</title>
        <link href="https://example.com/atom?fbclid=abc&amp;item=2#top" />
        <summary>Atom summary</summary>
        <id>atom-2</id>
        <updated>2026-06-19T12:00:00Z</updated>
      </entry></feed>`,
      source,
      "run-2",
    );

    expect(items).toHaveLength(1);
    expect(items[0].normalized_url).toBe("https://example.com/atom?item=2");
    expect(items[0].published_at).toBe("2026-06-19T12:00:00.000Z");
    expect(rawPayload(items[0])).toMatchObject({
      guid: "atom-2",
      link: "https://example.com/atom?fbclid=abc&item=2#top",
      summary: "Atom summary",
      title: "Atom story",
    });
  });

  it("keeps full feed content when the description is only a teaser", () => {
    const fullContent = "Full public feed paragraph with useful reporting and context. ".repeat(20);
    const items = parseSourceFeed(
      `<rss><channel><item>
        <title>Feed story</title>
        <link>https://example.com/feed-story</link>
        <description>Short teaser</description>
        <content:encoded><![CDATA[<p>${fullContent}</p>]]></content:encoded>
      </item></channel></rss>`,
      source,
      "run-full-content",
    );

    expect(rawPayload(items[0]).summary).toContain("Full public feed paragraph");
    expect(String(rawPayload(items[0]).summary).length).toBeGreaterThan(500);
  });

  it("strips Hacker News metadata-only summaries", () => {
    const items = parseSourceFeed(
      `<rss><channel><item>
        <title>Data centers become the face of AI backlash</title>
        <link>https://www.axios.com/2026/06/22/ai-data-center-backlash-poll</link>
        <description><![CDATA[
          <p><a href="https://www.axios.com/2026/06/22/ai-data-center-backlash-poll">Data centers become the face of AI backlash</a></p>
          <p>Article URL: <a href="https://www.axios.com/2026/06/22/ai-data-center-backlash-poll">https://www.axios.com/2026/06/22/ai-data-center-backlash-poll</a></p>
          <p>Comments URL: <a href="https://news.ycombinator.com/item?id=48627730">https://news.ycombinator.com/item?id=48627730</a></p>
          <p>Points: 1</p>
          <p># Comments: 0</p>
        ]]></description>
      </item></channel></rss>`,
      { ...source, name: "Hacker News", url: "https://hnrss.org/newest" },
      "run-hn",
    );

    expect(items).toHaveLength(1);
    expect(rawPayload(items[0]).summary).toBe("");
  });

  it("uses null for invalid dates", () => {
    const items = parseSourceFeed(
      `<rss><channel><item>
        <title>Dated story</title>
        <link>https://example.com/dated</link>
        <pubDate>not a date</pubDate>
      </item></channel></rss>`,
      source,
      "run-3",
    );

    expect(items[0].published_at).toBeNull();
    expect(rawPayload(items[0]).publishedAt).toBeNull();
  });

  it("skips items only when both title and link are missing", () => {
    const items = parseSourceFeed(
      `<rss><channel>
        <item><description>ignored</description></item>
        <item><title>Title only</title></item>
        <item><link>https://example.com/link-only</link></item>
      </channel></rss>`,
      source,
      "run-4",
    );

    expect(items).toHaveLength(2);
    expect(rawPayload(items[0]).title).toBe("Title only");
    expect(rawPayload(items[1]).link).toBe("https://example.com/link-only");
  });
});

describe("fetchSourceItemsForRun", () => {
  const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];

  it("keeps successful Source Items and reports failed feeds", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);

      if (value.includes("good")) {
        return new Response(
          `<rss><channel><item>
            <title>Good</title>
            <link>https://example.com/good</link>
            <pubDate>Sat, 20 Jun 2026 09:00:00 GMT</pubDate>
          </item></channel></rss>`,
          {
          status: 200,
          },
        );
      }

      return new Response("", { status: 503 });
    });

    const result = await fetchSourceItemsForRun({
      digestRunId: "run-5",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup,
      now: new Date("2026-06-20T12:00:00.000Z"),
      sources: [
        { ...source, name: "Good Source", url: "https://feeds.example.test/good" },
        { ...source, name: "Bad Source", url: "https://feeds.example.test/bad" },
      ],
    });

    expect(result.sourceItems).toHaveLength(1);
    expect(result.metrics).toEqual({
      errors: ["Bad Source: HTTP 503"],
      fetchedItemCount: 1,
      fetchedWarsawDates: ["2026-06-20", "2026-06-19"],
      parsedItemCount: 1,
      skippedOldItemCount: 0,
      skippedUndatedItemCount: 0,
      sourceCounts: {
        "Good Source": 1,
      },
      sourcesConfigured: 2,
      sourcesFailed: 1,
      sourcesSucceeded: 1,
    });
  });

  it("keeps only items published today or yesterday in Warsaw time", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        `<rss><channel>
          <item>
            <title>Today</title>
            <link>https://example.com/today</link>
            <pubDate>Sat, 20 Jun 2026 08:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Yesterday</title>
            <link>https://example.com/yesterday</link>
            <pubDate>Fri, 19 Jun 2026 18:30:00 GMT</pubDate>
          </item>
          <item>
            <title>Old</title>
            <link>https://example.com/old</link>
            <pubDate>Thu, 18 Jun 2026 18:30:00 GMT</pubDate>
          </item>
          <item>
            <title>Undated</title>
            <link>https://example.com/undated</link>
          </item>
        </channel></rss>`,
        {
          status: 200,
        },
      ));

    const result = await fetchSourceItemsForRun({
      digestRunId: "run-6",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup,
      now: new Date("2026-06-20T12:00:00.000Z"),
      sources: [{ ...source, name: "Recent Source", url: "https://feeds.example.test/recent" }],
    });

    expect(result.sourceItems.map((item) => rawPayload(item).title)).toEqual(["Today", "Yesterday"]);
    expect(result.metrics).toMatchObject({
      fetchedItemCount: 2,
      fetchedWarsawDates: ["2026-06-20", "2026-06-19"],
      parsedItemCount: 4,
      skippedOldItemCount: 1,
      skippedUndatedItemCount: 1,
      sourceCounts: {
        "Recent Source": 2,
      },
    });
  });

  it("rejects a runtime feed redirect to a private address", async () => {
    const result = await fetchSourceItemsForRun({
      digestRunId: "run-7",
      fetchImpl: async () => new Response(null, {
        headers: { location: "http://127.0.0.1/internal" },
        status: 302,
      }),
      lookup: publicLookup,
      now: new Date("2026-06-20T12:00:00.000Z"),
      sources: [{ ...source, name: "Redirect Source", url: "https://feeds.example.test/redirect" }],
    });

    expect(result.metrics.sourcesFailed).toBe(1);
    expect(result.metrics.errors[0]).toMatch(/private|local|reserved/i);
  });

  it("rejects a runtime feed response above the bounded size", async () => {
    const result = await fetchSourceItemsForRun({
      digestRunId: "run-8",
      fetchImpl: async () => new Response(null, {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        status: 200,
      }),
      lookup: publicLookup,
      now: new Date("2026-06-20T12:00:00.000Z"),
      sources: [{ ...source, name: "Large Source", url: "https://feeds.example.test/large" }],
    });

    expect(result.metrics.sourcesFailed).toBe(1);
    expect(result.metrics.errors[0]).toMatch(/2 MB limit/i);
  });
});

import type { Database } from "../database.types";
import { getWarsawDate } from "../date-utils";
import { cleanArticleSummary, decodeHtmlEntities, plainTextFromHtml } from "../text";
import { FEED_FETCH_TIMEOUT_MS, USER_AGENT } from "./constants";

type SourceItemInsert = Database["public"]["Tables"]["source_items"]["Insert"];

export type SourceConfig = {
  name: string;
  category: string;
  url: string;
  priority?: number;
};

type FetchSourceItemsForRunOptions = {
  digestRunId: string;
  sources: SourceConfig[];
  fetchImpl?: typeof fetch;
  now?: Date;
};

const MAX_RAW_ITEM_XML_LENGTH = 20_000;
const SOURCE_ITEM_LOOKBACK_DAYS = 1;
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "at_campaign",
  "at_medium",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagText(xml: string, tagName: string) {
  const escaped = escapeRegExp(tagName);
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));

  return match ? plainTextFromHtml(match[1]) : "";
}

function tagAttribute(xml: string, tagName: string, attributeName: string) {
  const escapedTag = escapeRegExp(tagName);
  const escapedAttribute = escapeRegExp(attributeName);
  const tagMatch = xml.match(new RegExp(`<${escapedTag}\\s+([^>]*)\\/?>`, "i"));

  if (!tagMatch) {
    return "";
  }

  const attrMatch = tagMatch[1].match(new RegExp(`${escapedAttribute}=["']([^"']+)["']`, "i"));

  return attrMatch ? decodeHtmlEntities(attrMatch[1]).trim() : "";
}

function itemXmlBlocks(feedXml: string) {
  const blocks = [...feedXml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map((match) => match[0]);

  if (blocks.length) {
    return blocks;
  }

  return [...feedXml.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

export function normalizeUrl(value: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parsePublishedAt(value: string) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function addCalendarDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));

  return date.toISOString().slice(0, 10);
}

function recentWarsawDates(now = new Date(), lookbackDays = SOURCE_ITEM_LOOKBACK_DAYS) {
  const dates: string[] = [];
  const today = getWarsawDate(now);

  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    dates.push(addCalendarDays(today, -offset));
  }

  return new Set(dates);
}

function publishedAtIsRecent(publishedAt: string | null, allowedWarsawDates: Set<string>) {
  if (!publishedAt) {
    return false;
  }

  return allowedWarsawDates.has(getWarsawDate(new Date(publishedAt)));
}

function parseSourceFeedWithStats(
  feedXml: string,
  source: SourceConfig,
  digestRunId: string,
  allowedWarsawDates?: Set<string>,
) {
  const items: SourceItemInsert[] = [];
  let parsedItemCount = 0;
  let skippedOldItemCount = 0;
  let skippedUndatedItemCount = 0;

  for (const itemXml of itemXmlBlocks(feedXml)) {
    parsedItemCount += 1;
    const title = tagText(itemXml, "title");
    const link = tagText(itemXml, "link") || tagAttribute(itemXml, "link", "href");
    const rawSummary =
      tagText(itemXml, "description") ||
      tagText(itemXml, "summary") ||
      tagText(itemXml, "content") ||
      tagText(itemXml, "content:encoded");
    const summary = cleanArticleSummary(rawSummary, title);
    const publishedAt =
      parsePublishedAt(tagText(itemXml, "pubDate")) ||
      parsePublishedAt(tagText(itemXml, "published")) ||
      parsePublishedAt(tagText(itemXml, "updated")) ||
      parsePublishedAt(tagText(itemXml, "dc:date"));

    if (!title && !link) {
      continue;
    }

    if (allowedWarsawDates && !publishedAtIsRecent(publishedAt, allowedWarsawDates)) {
      if (publishedAt) {
        skippedOldItemCount += 1;
      } else {
        skippedUndatedItemCount += 1;
      }

      continue;
    }

    items.push({
      category: source.category,
      digest_run_id: digestRunId,
      normalized_url: normalizeUrl(link),
      published_at: publishedAt,
      raw_payload: {
        guid: tagText(itemXml, "guid") || tagText(itemXml, "id") || null,
        link: link || null,
        publishedAt,
        rawXml: itemXml.slice(0, MAX_RAW_ITEM_XML_LENGTH),
        sourcePriority: source.priority ?? null,
        summary,
        title,
      },
      source_name: source.name,
      source_url: source.url,
    });
  }

  return {
    items,
    parsedItemCount,
    skippedOldItemCount,
    skippedUndatedItemCount,
  };
}

export function parseSourceFeed(feedXml: string, source: SourceConfig, digestRunId: string): SourceItemInsert[] {
  return parseSourceFeedWithStats(feedXml, source, digestRunId).items;
}

async function fetchSource(
  source: SourceConfig,
  digestRunId: string,
  fetchImpl: typeof fetch,
  allowedWarsawDates: Set<string>,
) {
  const response = await fetchImpl(source.url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${source.name}: HTTP ${response.status}`);
  }

  const feedXml = await response.text();
  const result = parseSourceFeedWithStats(feedXml, source, digestRunId, allowedWarsawDates);

  return {
    ...result,
    sourceName: source.name,
  };
}

export async function fetchSourceItemsForRun({
  digestRunId,
  sources,
  fetchImpl = fetch,
  now = new Date(),
}: FetchSourceItemsForRunOptions) {
  const allowedWarsawDates = recentWarsawDates(now);
  const settled = await Promise.allSettled(
    sources.map((source) => fetchSource(source, digestRunId, fetchImpl, allowedWarsawDates)),
  );
  const sourceItems: SourceItemInsert[] = [];
  const sourceCounts: Record<string, number> = {};
  const errors: string[] = [];
  let parsedItemCount = 0;
  let skippedOldItemCount = 0;
  let skippedUndatedItemCount = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourceItems.push(...result.value.items);
      parsedItemCount += result.value.parsedItemCount;
      skippedOldItemCount += result.value.skippedOldItemCount;
      skippedUndatedItemCount += result.value.skippedUndatedItemCount;
      sourceCounts[result.value.sourceName] = result.value.items.length;
      continue;
    }

    errors.push(result.reason instanceof Error ? result.reason.message : "Unknown source fetch error");
  }

  return {
    metrics: {
      errors,
      fetchedItemCount: sourceItems.length,
      fetchedWarsawDates: [...allowedWarsawDates],
      parsedItemCount,
      skippedOldItemCount,
      skippedUndatedItemCount,
      sourceCounts,
      sourcesConfigured: sources.length,
      sourcesFailed: errors.length,
      sourcesSucceeded: settled.filter((result) => result.status === "fulfilled").length,
    },
    sourceItems,
  };
}

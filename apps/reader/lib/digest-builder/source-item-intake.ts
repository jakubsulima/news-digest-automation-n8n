import type { Database } from "../database.types";
import { getWarsawDate } from "../date-utils";
import { fetchBoundedText } from "../source-discovery/bounded-fetch";
import type { DnsLookup } from "../source-discovery/types";
import { cleanArticleSummary, decodeHtmlEntities, plainTextFromHtml } from "../text";
import { FEED_FETCH_TIMEOUT_MS, USER_AGENT } from "./constants";

type SourceItemInsert = Database["public"]["Tables"]["source_items"]["Insert"];
type SourceRunObservationInsert = Database["public"]["Tables"]["source_run_observations"]["Insert"];

export type SourceConfig = {
  id?: string;
  name: string;
  category: string;
  url: string;
  priority?: number;
  portfolioRole?: "selected" | "explore" | "probe";
};

type FetchSourceItemsForRunOptions = {
  digestRunId: string;
  sources: SourceConfig[];
  fetchImpl?: typeof fetch;
  lookup?: DnsLookup;
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function databaseSourceId(value: string | undefined) {
  return value && UUID_PATTERN.test(value) ? value : null;
}

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
    const summary = ["description", "summary", "content", "content:encoded"]
      .map((tag) => cleanArticleSummary(tagText(itemXml, tag), title))
      .sort((left, right) => right.length - left.length)[0] || "";
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
        readerSourceId: databaseSourceId(source.id),
        portfolioRole: source.portfolioRole ?? "selected",
        sourcePriority: source.priority ?? null,
        summary,
        title,
      },
      source_name: source.name,
      source_url: source.url,
      reader_source_id: databaseSourceId(source.id),
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
  fetchImpl: typeof fetch | undefined,
  lookup: DnsLookup | undefined,
  allowedWarsawDates: Set<string>,
) {
  const startedAt = Date.now();
  let feedXml: string;
  try {
    feedXml = (await fetchBoundedText(source.url, {
      fetchImpl,
      lookup,
      timeoutMs: FEED_FETCH_TIMEOUT_MS,
      userAgent: USER_AGENT,
    })).body;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1];
    throw new Error(httpStatus ? `${source.name}: HTTP ${httpStatus}` : `${source.name}: ${message}`);
  }
  const result = parseSourceFeedWithStats(feedXml, source, digestRunId, allowedWarsawDates);

  return {
    ...result,
    durationMs: Date.now() - startedAt,
    sourceName: source.name,
  };
}

function sourceErrorKind(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1];

  if (httpStatus) return `http_${httpStatus}`;
  if (/timeout|aborted/i.test(message)) return "timeout";
  return "network_or_parse_error";
}

export async function fetchSourceItemsForRun({
  digestRunId,
  sources,
  fetchImpl,
  lookup,
  now = new Date(),
}: FetchSourceItemsForRunOptions) {
  const allowedWarsawDates = recentWarsawDates(now);
  const settled = await Promise.all(
    sources.map(async (source) => {
      const startedAt = Date.now();

      try {
        return {
          result: await fetchSource(source, digestRunId, fetchImpl, lookup, allowedWarsawDates),
          source,
          status: "fulfilled" as const,
        };
      } catch (error) {
        return {
          durationMs: Date.now() - startedAt,
          error,
          source,
          status: "rejected" as const,
        };
      }
    }),
  );
  const sourceItems: SourceItemInsert[] = [];
  const sourceObservations: SourceRunObservationInsert[] = [];
  const sourceCounts: Record<string, number> = {};
  const errors: string[] = [];
  let parsedItemCount = 0;
  let skippedOldItemCount = 0;
  let skippedUndatedItemCount = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourceItems.push(...result.result.items);
      parsedItemCount += result.result.parsedItemCount;
      skippedOldItemCount += result.result.skippedOldItemCount;
      skippedUndatedItemCount += result.result.skippedUndatedItemCount;
      sourceCounts[result.result.sourceName] = result.result.items.length;
      sourceObservations.push({
        category: result.source.category,
        digest_run_id: digestRunId,
        duration_ms: result.result.durationMs,
        eligible_item_count: result.result.items.length,
        parsed_item_count: result.result.parsedItemCount,
        reader_source_id: databaseSourceId(result.source.id),
        metadata: { portfolioRole: result.source.portfolioRole ?? "selected" },
        skipped_old_item_count: result.result.skippedOldItemCount,
        skipped_undated_item_count: result.result.skippedUndatedItemCount,
        source_name: result.source.name,
        source_url: result.source.url,
        status: "succeeded",
      });
      continue;
    }

    const message = result.error instanceof Error ? result.error.message : "Unknown source fetch error";
    errors.push(message);
    sourceObservations.push({
      category: result.source.category,
      digest_run_id: digestRunId,
      duration_ms: result.durationMs,
      error_kind: sourceErrorKind(result.error),
      reader_source_id: databaseSourceId(result.source.id),
      metadata: { portfolioRole: result.source.portfolioRole ?? "selected" },
      source_name: result.source.name,
      source_url: result.source.url,
      status: "failed",
    });
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
    sourceObservations,
    sourceItems,
  };
}

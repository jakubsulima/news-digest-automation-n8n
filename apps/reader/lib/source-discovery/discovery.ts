import { parseSourceFeed } from "../digest-builder/source-item-intake";
import { decodeHtmlEntities, plainTextFromHtml } from "../text";
import { fetchBoundedText } from "./bounded-fetch";
import type { SourceDiscoveryDependencies, SourceDiscoveryProposal } from "./types";

const COMMON_FEED_PATHS = ["/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml"];

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";
}

function alternateFeedUrls(html: string, baseUrl: string) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap((match) => {
    const tag = match[0];
    const rel = attribute(tag, "rel").toLowerCase();
    const type = attribute(tag, "type").toLowerCase();
    const href = attribute(tag, "href");
    if (!rel.split(/\s+/).includes("alternate") || !href || !/(rss|atom)\+xml/.test(type)) return [];
    try {
      return [new URL(decodeHtmlEntities(href), baseUrl).toString()];
    } catch {
      return [];
    }
  });
}

function feedType(body: string): "rss" | "atom" | null {
  if (/<feed\b/i.test(body)) return "atom";
  if (/<rss\b|<rdf:RDF\b|<channel\b/i.test(body)) return "rss";
  return null;
}

function tagText(body: string, tag: string) {
  const match = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? plainTextFromHtml(match[1]).trim() : "";
}

function detectLanguage(body: string) {
  const declared = tagText(body, "language") || body.match(/(?:xml:lang|lang)=["']([a-zA-Z-]{2,35})["']/i)?.[1] || "";
  if (declared) return declared.toLowerCase().slice(0, 35);
  const text = plainTextFromHtml(body.slice(0, 100_000)).toLowerCase();
  const polish = (text.match(/[ąćęłńóśźż]/g) || []).length + (text.match(/\b(oraz|jest|się|dla|przez|który)\b/g) || []).length;
  const english = (text.match(/\b(the|and|with|from|that|this|for)\b/g) || []).length;
  return polish > english ? "pl" : english > 2 ? "en" : "unknown";
}

function suggestCategory(body: string) {
  const text = plainTextFromHtml(body.slice(0, 200_000)).toLowerCase();
  const score = (words: string[]) => words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
  const categories = [
    { category: "Cybersecurity", score: score(["security", "vulnerability", "cyber", "breach", "cve", "ransomware"]) },
    { category: "AI / Technology", score: score(["artificial intelligence", " ai ", "llm", "model", "openai", "machine learning"]) },
    { category: "Business / Markets", score: score(["business", "market", "economy", "finance", "earnings", "bank"]) },
    { category: "World / Geopolitics", score: score(["world", "government", "war", "europe", "china", "policy", "election"]) },
    { category: "Software / Engineering", score: score(["software", "developer", "github", "release", "framework", "cloud"]) },
  ].sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));
  return categories[0].score > 0 ? categories[0].category : "General";
}

function normalizeFeedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.toString();
}

function proposalFromFeed(
  inputUrl: string,
  feedUrl: string,
  body: string,
  type: "rss" | "atom",
  redirectCount: number,
  alternateCandidateCount: number,
  existingFeedUrls: Set<string>,
): SourceDiscoveryProposal {
  const normalizedFeedUrl = normalizeFeedUrl(feedUrl);
  const items = parseSourceFeed(body, {
    category: "General",
    name: "Discovery sample",
    url: normalizedFeedUrl,
  }, "00000000-0000-4000-8000-000000000000").slice(0, 50);
  if (!items.length) throw new Error("The candidate feed contains no parseable RSS or Atom items.");
  const itemUrls = items.flatMap((item) => item.normalized_url ? [item.normalized_url] : []);
  const duplicateCount = itemUrls.length - new Set(itemUrls).size;
  const duplicateRatio = itemUrls.length ? duplicateCount / itemUrls.length : 0;
  const host = new URL(normalizedFeedUrl).hostname.toLowerCase();
  const name = tagText(body, "title") || host;

  return {
    alreadyExists: existingFeedUrls.has(normalizedFeedUrl),
    canonicalHost: host,
    category: suggestCategory(body),
    diagnostics: {
      alternateCandidateCount,
      duplicateRatio,
      inputUrl,
      redirectCount,
      sampleItemCount: items.length,
    },
    feedType: type,
    feedUrl: normalizedFeedUrl,
    language: detectLanguage(body),
    name: name.slice(0, 200),
    sampleItemCount: items.length,
  };
}

export async function discoverSource(
  rawUrl: string,
  existingFeedUrls: Set<string> = new Set(),
  dependencies: SourceDiscoveryDependencies = {},
) {
  const input = await fetchBoundedText(rawUrl, dependencies);
  const inputType = feedType(input.body);
  if (inputType) {
    return proposalFromFeed(rawUrl, input.finalUrl, input.body, inputType, input.redirectCount, 0, existingFeedUrls);
  }
  const origin = new URL(input.finalUrl).origin;
  const alternates = alternateFeedUrls(input.body, input.finalUrl);
  const candidates = [...new Set([
    ...alternates,
    ...COMMON_FEED_PATHS.map((path) => new URL(path, origin).toString()),
  ])].slice(0, 10);
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const result = await fetchBoundedText(candidate, dependencies);
      const type = feedType(result.body);
      if (!type) {
        failures.push(`${candidate}: not RSS/Atom`);
        continue;
      }
      return proposalFromFeed(
        rawUrl,
        result.finalUrl,
        result.body,
        type,
        input.redirectCount + result.redirectCount,
        alternates.length,
        existingFeedUrls,
      );
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No valid RSS or Atom feed was found. Checked ${candidates.length} candidates.${failures[0] ? ` First failure: ${failures[0]}` : ""}`);
}

import { createHash } from "node:crypto";

import type { Json } from "./database.types";
import { readingTimeMinutesForDigestBrief } from "./digest-brief-text";
import type { DigestBriefArticle, NvidiaDigestBrief } from "./ai-summary";

export const DIGEST_BRIEF_PROMPT_VERSION = "digest-brief-v2";
export const MAX_BRIEF_ARTICLES = 10;
const MAX_INPUT_CHARS = 48_000;

export type FrozenBriefArticle = DigestBriefArticle & {
  evidence: Json;
  index: number;
  newsItemId: string;
  storyClusterId: string;
};

export type BriefInputV1 = {
  articles: FrozenBriefArticle[];
  interestProfile: { feedTargets: Record<string, number>; preferredKeywords: string[] };
  omitted: { insufficientEvidence: number; overLimit: number };
  promptVersion: typeof DIGEST_BRIEF_PROMPT_VERSION;
  version: 1;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildBriefInput(input: Omit<BriefInputV1, "promptVersion" | "version">) {
  const eligible = input.articles.filter((article) => {
    const evidence = article.evidence && typeof article.evidence === "object" && !Array.isArray(article.evidence)
      ? article.evidence as Record<string, Json | undefined> : {};
    return evidence.status !== "limited";
  });
  const selected = eligible.slice(0, MAX_BRIEF_ARTICLES).map((article, index) => ({
    ...article,
    index,
    summary: article.summary.slice(0, 2_500),
    title: article.title.slice(0, 300),
    whyInteresting: article.whyInteresting?.slice(0, 600) ?? null,
  }));
  const payload: BriefInputV1 = {
    articles: selected,
    interestProfile: {
      feedTargets: input.interestProfile.feedTargets,
      preferredKeywords: input.interestProfile.preferredKeywords.slice(0, 50).map((value) => value.slice(0, 100)),
    },
    omitted: {
      insufficientEvidence: input.articles.length - eligible.length,
      overLimit: Math.max(0, eligible.length - MAX_BRIEF_ARTICLES),
    },
    promptVersion: DIGEST_BRIEF_PROMPT_VERSION,
    version: 1,
  };
  const serialized = canonical(payload);
  if (serialized.length > MAX_INPUT_CHARS) throw new Error("Frozen briefing input exceeds its size limit.");
  return { hash: createHash("sha256").update(serialized).digest("hex"), payload };
}

export function materializeBrief(brief: NvidiaDigestBrief, input: BriefInputV1) {
  const reference = (index: number) => {
    const article = input.articles[index];
    return article ? { newsItemId: article.newsItemId, source: article.source, title: article.title } : null;
  };
  const highlights = brief.highlights.flatMap((item) => {
    const linked = reference(item.articleIndex);
    return linked ? [{ ...linked, supportsSummary: brief.summaryArticleIndexes.includes(item.articleIndex), whatHappened: item.whatHappened, whyItMatters: item.whyItMatters }] : [];
  });
  const sections = brief.sections.flatMap((section) => {
    const paragraphs = section.paragraphs.flatMap((paragraph) => {
      const references = [...new Set(paragraph.articleIndexes)].flatMap((index) => {
        const linked = reference(index); return linked ? [linked] : [];
      });
      return references.length ? [{ text: paragraph.text, references }] : [];
    });
    return paragraphs.length ? [{ category: section.category, paragraphs, title: section.title }] : [];
  });
  const watchlist = brief.watchlist.map((item) => ({
    references: item.articleIndexes.flatMap((index) => { const linked = reference(index); return linked ? [linked] : []; }),
    signal: item.signal,
    why: item.why,
  }));
  const coverageNote = `${brief.coverageNote}${input.omitted.insufficientEvidence ? ` ${input.omitted.insufficientEvidence} materiałów o ograniczonym pokryciu pominięto w syntezie.` : ""}`;
  return {
    coverageNote,
    highlights,
    readingTimeMinutes: readingTimeMinutesForDigestBrief({ coverageNote, sections, summary: brief.summary, watchlist }),
    sections,
    summary: brief.summary,
    watchlist,
  };
}

export type CachedArticle = {
  articleId: string;
  fetchedAt: string | null;
  source: string;
  text: string;
  url: string;
  wordCount: number;
};

export type CachedArticleCandidate = {
  canonical_url: string;
  content_mode: string;
  enriched_fetched_at: string | null;
  enriched_text: string | null;
  enriched_word_count: number;
  id: string;
  raw_summary: string;
  source: string;
};

function readerCopy(candidate: CachedArticleCandidate) {
  if (candidate.content_mode === "readable" && candidate.enriched_text?.trim()) {
    return {
      candidate,
      text: candidate.enriched_text.trim(),
      wordCount: candidate.enriched_word_count,
    };
  }

  const feedAnalysis = analyzeReadableContent(candidate.raw_summary);

  return feedAnalysis.mode === "readable"
    ? { candidate, text: feedAnalysis.text, wordCount: feedAnalysis.wordCount }
    : null;
}

export function selectCachedArticle(
  candidates: CachedArticleCandidate[],
  preferredUrl: string,
): CachedArticle | null {
  const readable = candidates.flatMap((candidate) => {
    const copy = readerCopy(candidate);
    return copy ? [copy] : [];
  });
  const preferred = readable.filter(({ candidate }) => candidate.canonical_url === preferredUrl);
  const candidate = (preferred.length ? preferred : readable).sort((left, right) => {
    const wordCountDifference = right.wordCount - left.wordCount;
    const textLengthDifference = right.text.length - left.text.length;

    return wordCountDifference || textLengthDifference;
  })[0];

  if (!candidate) return null;

  return {
    articleId: candidate.candidate.id,
    fetchedAt: candidate.candidate.enriched_fetched_at,
    source: candidate.candidate.source,
    text: candidate.text,
    url: candidate.candidate.canonical_url,
    wordCount: candidate.wordCount,
  };
}
import { analyzeReadableContent } from "./readable-content";

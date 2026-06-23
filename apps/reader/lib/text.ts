const ENTITY_BY_NAME: Record<string, string> = {
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  apos: "'",
};

const FEED_METADATA_PATTERNS = [
  /\bArticle URL:\s+\S+/gi,
  /\bComments URL:\s+\S+/gi,
  /\bPoints:\s+\d+/gi,
  /#\s*Comments:\s+\d+/gi,
];

function decodeCodePoint(value: number) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith("#x")) {
        return decodeCodePoint(Number.parseInt(normalized.slice(2), 16)) || match;
      }

      if (normalized.startsWith("#")) {
        return decodeCodePoint(Number.parseInt(normalized.slice(1), 10)) || match;
      }

      return ENTITY_BY_NAME[normalized] ?? match;
    });
}

export function plainTextFromHtml(value: string) {
  let text = value;

  for (let index = 0; index < 2; index += 1) {
    text = decodeHtmlEntities(text).replace(/<[^>]+>/g, " ");
  }

  return text.replace(/\s+/g, " ").trim();
}

function normalizedPlainText(value: string) {
  return plainTextFromHtml(value).toLocaleLowerCase("en-US");
}

export function cleanArticleSummary(summary: string, title = "") {
  let text = plainTextFromHtml(summary);

  for (const pattern of FEED_METADATA_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  text = text.replace(/\s+/g, " ").trim();

  if (title && normalizedPlainText(text) === normalizedPlainText(title)) {
    return "";
  }

  return text;
}

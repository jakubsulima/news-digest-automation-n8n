function normalizedTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .match(/[\p{Letter}\p{Number}]+/gu) ?? [];
}

function containsTokenSequence(tokens: readonly string[], sequence: readonly string[]) {
  if (!sequence.length || sequence.length > tokens.length) {
    return false;
  }

  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }

  return false;
}

export function matchingKeywords(text: string, keywords: readonly string[]) {
  const tokens = normalizedTokens(text);
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const normalizedKeyword = normalizedTokens(keyword).join(" ");

    if (!normalizedKeyword || seen.has(normalizedKeyword)) {
      continue;
    }

    seen.add(normalizedKeyword);
    if (containsTokenSequence(tokens, normalizedKeyword.split(" "))) {
      matches.push(keyword.trim().toLocaleLowerCase("und"));
    }
  }

  return matches;
}

export function textMatchesAnyKeyword(text: string, keywords: readonly string[]) {
  return matchingKeywords(text, keywords).length > 0;
}

export function keywordHitCount(text: string, keywords: readonly string[]) {
  return matchingKeywords(text, keywords).length;
}

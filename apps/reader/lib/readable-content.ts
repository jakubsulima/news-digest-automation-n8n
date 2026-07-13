import { plainTextFromHtml } from "./text";

type ContentMode = "unknown" | "readable" | "audio_only" | "video_only" | "insufficient_text";

type ReadableContentAnalysis = {
  hasAudio: boolean;
  hasVideo: boolean;
  mode: ContentMode;
  paragraphCount: number;
  reason: string;
  text: string;
  wordCount: number;
};

const NON_CONTENT_ELEMENTS = [
  "script",
  "style",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "svg",
  "noscript",
  "template",
];

function stripNonContentElements(html: string) {
  return NON_CONTENT_ELEMENTS.reduce(
    (result, tag) => result.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " "),
    html,
  );
}

function longestElementBody(html: string, tag: "article" | "main" | "body") {
  const matches = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))];

  return matches
    .map((match) => match[1])
    .sort((left, right) => plainTextFromHtml(right).length - plainTextFromHtml(left).length)[0];
}

function contentHtml(html: string) {
  const cleaned = stripNonContentElements(html);
  return longestElementBody(cleaned, "article") || longestElementBody(cleaned, "main") || longestElementBody(cleaned, "body") || cleaned;
}

function meaningfulParagraphCount(html: string) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].filter(
    (match) => plainTextFromHtml(match[1]).trim().length >= 40,
  ).length;
}

function readableText(html: string) {
  const blocks = [...html.matchAll(/<(?:h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|p|li|blockquote)>/gi)]
    .map((match) => plainTextFromHtml(match[1]))
    .filter(Boolean);

  return (blocks.length ? blocks.join("\n\n") : plainTextFromHtml(html)).trim();
}

function countWords(text: string) {
  return text.match(/[\p{Letter}\p{Number}]+/gu)?.length ?? 0;
}

function containsAudioSignal(html: string) {
  return /<audio\b|type=["']audio\/|(?:spotify|soundcloud|megaphone|omny|podbean|audioboom)\.com|(?:audio|podcast)[-_ ]player|data-audio/iu.test(
    html,
  );
}

function containsVideoSignal(html: string) {
  return /<video\b|type=["']video\/|(?:youtube|youtu\.be|vimeo)\.com|(?:video)[-_ ]player|data-video/iu.test(html);
}

function containsAccessWallSignal(html: string) {
  const text = plainTextFromHtml(html);

  return /(?:subscribe|sign in|log in|register)\s+(?:now\s+)?to\s+(?:continue|keep reading|read|unlock)|already (?:a )?subscriber|subscriber-only|dla subskrybentów|zaloguj się,? aby|wykup (?:dostęp|subskrypcję)/iu.test(
    text,
  );
}

export function analyzeReadableContent(html: string): ReadableContentAnalysis {
  const selectedHtml = contentHtml(html);
  const text = readableText(selectedHtml).slice(0, 200_000);
  const wordCount = countWords(text);
  const paragraphCount = meaningfulParagraphCount(selectedHtml);
  const hasAudio = containsAudioSignal(html);
  const hasVideo = containsVideoSignal(html);
  const hasAccessWall = containsAccessWallSignal(selectedHtml);
  const hasFullWrittenContent =
    wordCount >= 170 ||
    (wordCount >= 120 && paragraphCount >= 2) ||
    (wordCount >= 90 && paragraphCount >= 4 && text.length >= 700);

  if (hasFullWrittenContent && !hasAccessWall) {
    return {
      hasAudio,
      hasVideo,
      mode: "readable",
      paragraphCount,
      reason: hasAudio || hasVideo ? "full_text_with_optional_media" : "full_written_text",
      text,
      wordCount,
    };
  }

  if (hasAccessWall) {
    return {
      hasAudio,
      hasVideo,
      mode: "insufficient_text",
      paragraphCount,
      reason: "access_wall_detected",
      text,
      wordCount,
    };
  }

  if (hasAudio) {
    return {
      hasAudio,
      hasVideo,
      mode: "audio_only",
      paragraphCount,
      reason: "audio_player_without_full_written_text",
      text,
      wordCount,
    };
  }

  if (hasVideo) {
    return {
      hasAudio,
      hasVideo,
      mode: "video_only",
      paragraphCount,
      reason: "video_player_without_full_written_text",
      text,
      wordCount,
    };
  }

  return {
    hasAudio,
    hasVideo,
    mode: "insufficient_text",
    paragraphCount,
    reason: wordCount ? "too_little_written_content" : "no_written_content",
    text,
    wordCount,
  };
}

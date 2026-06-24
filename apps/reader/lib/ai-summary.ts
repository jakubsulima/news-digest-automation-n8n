import "server-only";

import { plainTextFromHtml } from "./text";

type NvidiaChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type NvidiaArticlePreview = {
  clickIf: string;
  practicalBucket: string;
  whatHappened: string;
  whyItMatters: string;
};

const DEFAULT_NVIDIA_API_URL = "https://api.nvcf.nvidia.com/v2/nim/v1/generate";
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";

export function hasNvidiaSummaryConfig() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

export async function shortenSummaryWithNvidia({
  maxChars,
  summary,
  title,
}: {
  maxChars: number;
  summary: string;
  title: string;
}) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return null;
  }

  const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_tokens: Math.max(80, Math.min(300, Math.ceil(maxChars / 3))),
      messages: [
        {
          role: "system",
          content:
            "Rewrite news summaries for a private daily digest. Keep concrete facts, names, dates, and numbers. Do not add analysis.",
        },
        {
          role: "user",
          content: `Title: ${title}\n\nSummary: ${summary}\n\nReturn one concise paragraph under ${maxChars} characters.`,
        },
      ],
      model: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
      stream: false,
      temperature: 0.2,
      top_p: 0.7,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
  const content = payload?.choices?.[0]?.message?.content;

  return content ? plainTextFromHtml(content).trim() : null;
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? plainTextFromHtml(value).trim() : null;
}

function parseStrictPreviewJson(content: string): NvidiaArticlePreview | null {
  const parsed = JSON.parse(content.trim()) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const preview = parsed as Record<string, unknown>;
  const whatHappened = requiredString(preview.whatHappened);
  const whyItMatters = requiredString(preview.whyItMatters);
  const clickIf = requiredString(preview.clickIf);
  const practicalBucket = requiredString(preview.practicalBucket);

  if (!whatHappened || !whyItMatters || !clickIf || !practicalBucket) {
    return null;
  }

  return {
    clickIf,
    practicalBucket,
    whatHappened,
    whyItMatters,
  };
}

export async function previewArticleWithNvidia({
  summary,
  title,
}: {
  summary: string;
  title: string;
}): Promise<NvidiaArticlePreview | null> {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "You write concise article previews for a private news reader. Return only strict JSON with no markdown, prose, or code fences. Do not invent facts.",
          },
          {
            role: "user",
            content: `Title: ${title}\n\nSummary: ${summary}\n\nReturn exactly this JSON shape with short, plain-English strings:\n{"whatHappened":"","whyItMatters":"","clickIf":"","practicalBucket":""}`,
          },
        ],
        model: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
        stream: false,
        temperature: 0.1,
        top_p: 0.7,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
    const content = payload?.choices?.[0]?.message?.content;

    return content ? parseStrictPreviewJson(content) : null;
  } catch {
    return null;
  }
}

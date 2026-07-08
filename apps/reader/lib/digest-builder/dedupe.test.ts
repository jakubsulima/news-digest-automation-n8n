import { describe, expect, it } from "vitest";

import { areLikelyDuplicateStories, buildDedupeProfile, duplicateDecision, titleFingerprint } from "./dedupe";

describe("story dedupe", () => {
  it("normalizes reordered title words into the same fingerprint", () => {
    expect(titleFingerprint("OpenAI launches new GPT-5 model")).toBe(
      titleFingerprint("New GPT-5 model launches from OpenAI"),
    );
  });

  it("detects the same story from different sources with paraphrased titles", () => {
    const left = buildDedupeProfile({
      category: "AI / Labs",
      id: "a",
      publishedAt: "2026-06-20T08:00:00.000Z",
      source: "Source A",
      summary: "OpenAI released GPT-5 with stronger coding and reasoning capabilities for developers.",
      title: "OpenAI launches GPT-5 with improved coding skills",
    });
    const right = buildDedupeProfile({
      category: "AI / Biznes / Rynek",
      id: "b",
      publishedAt: "2026-06-20T09:00:00.000Z",
      source: "Source B",
      summary: "The company introduced GPT-5, a new model focused on reasoning, coding, and developer workflows.",
      title: "GPT-5 released by OpenAI for coding and reasoning",
    });

    expect(duplicateDecision(left, right)).toMatchObject({
      duplicate: true,
    });
  });

  it("does not merge different stories that share a broad topic", () => {
    expect(
      areLikelyDuplicateStories(
        {
          category: "AI / Labs",
          id: "a",
          publishedAt: "2026-06-20T08:00:00.000Z",
          summary: "OpenAI released GPT-5 with stronger coding and reasoning capabilities.",
          title: "OpenAI launches GPT-5 with improved coding skills",
        },
        {
          category: "AI / Hardware / Rynek",
          id: "b",
          publishedAt: "2026-06-20T10:00:00.000Z",
          summary: "NVIDIA reported rising demand for AI accelerators and data center GPUs.",
          title: "NVIDIA shares rise as GPU demand grows",
        },
      ),
    ).toBe(false);
  });

  it("does not merge similar old stories outside the duplicate window", () => {
    expect(
      areLikelyDuplicateStories(
        {
          category: "security",
          id: "a",
          publishedAt: "2026-06-10T08:00:00.000Z",
          summary: "A critical Kubernetes vulnerability was patched after active exploitation.",
          title: "Critical Kubernetes flaw exploited in the wild",
        },
        {
          category: "security",
          id: "b",
          publishedAt: "2026-06-20T08:00:00.000Z",
          summary: "A critical Kubernetes vulnerability was patched after active exploitation.",
          title: "Critical Kubernetes flaw exploited in the wild",
        },
      ),
    ).toBe(false);
  });
});

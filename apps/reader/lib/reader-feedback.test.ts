import { describe, expect, it, vi } from "vitest";

import {
  buildFeedbackProfile,
  extractFeedbackKeywords,
  feedbackScoreAdjustment,
  parseFeedbackSentiment,
  parseFeedbackReason,
  selectImplicitPreferenceEvents,
} from "./reader-feedback";

describe("reader feedback scoring", () => {
  it("parses API feedback sentiment values", () => {
    expect(parseFeedbackSentiment("more")).toBe("more");
    expect(parseFeedbackSentiment("less")).toBe("less");
    expect(parseFeedbackSentiment(null)).toBeNull();
    expect(parseFeedbackSentiment("other")).toBeUndefined();
    expect(parseFeedbackReason("source")).toBe("source");
    expect(parseFeedbackReason("other")).toBeUndefined();
  });

  it("keeps source-only feedback from suppressing an entire topic", () => {
    const profile = buildFeedbackProfile([
      { category: "AI", reason: "source", sentiment: "less", source: "Noisy Source", summary: "NVIDIA models", title: "AI release" },
    ]);

    expect(feedbackScoreAdjustment(profile, { category: "AI", source: "Other Source", text: "NVIDIA models" })).toBe(0);
    expect(feedbackScoreAdjustment(profile, { category: "AI", source: "Noisy Source", text: "Different subject" })).toBe(-8);
  });

  it("decays preference influence with a 45-day half-life", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const recent = buildFeedbackProfile([
      { category: "AI", reason: "source", sentiment: "more", source: "Source", summary: "Summary", title: "Title", updatedAt: "2026-07-11T00:00:00.000Z" },
    ]);
    const old = buildFeedbackProfile([
      { category: "AI", reason: "source", sentiment: "more", source: "Source", summary: "Summary", title: "Title", updatedAt: "2026-05-27T00:00:00.000Z" },
    ]);
    const candidate = { category: "Business", source: "Source", text: "Unrelated" };

    expect(feedbackScoreAdjustment(old, candidate)).toBeCloseTo(feedbackScoreAdjustment(recent, candidate) / 2);
    vi.useRealTimers();
  });

  it("extracts stable keywords from feedback text", () => {
    expect(extractFeedbackKeywords("This NVIDIA security story is about a critical supply chain breach")).toEqual([
      "nvidia",
      "security",
      "story",
      "critical",
      "supply",
      "chain",
      "breach",
    ]);
  });

  it("keeps the strongest direct implicit signal per session, story, and day", () => {
    const common = {
      createdAt: "2026-07-11T10:00:00.000Z",
      interactionOrigin: "direct" as const,
      storyClusterId: "story-1",
    };
    const selected = selectImplicitPreferenceEvents([
      { ...common, eventType: "fast_read", sessionId: "session-1" },
      { ...common, eventType: "save", sessionId: "session-1" },
      { ...common, eventType: "read", sessionId: "session-2" },
      { ...common, eventType: "save", interactionOrigin: "bulk", sessionId: "session-3" },
      { ...common, eventType: "save", interactionOrigin: "automatic", sessionId: "session-4" },
    ]);

    expect(selected).toEqual([
      expect.objectContaining({ eventType: "save", interactionOrigin: "direct", sessionId: "session-1" }),
    ]);
  });

  it("treats legacy events without an origin as direct evidence", () => {
    const selected = selectImplicitPreferenceEvents([{
      createdAt: "2026-07-11T10:00:00.000Z",
      eventType: "source_open",
      interactionOrigin: null,
      sessionId: "legacy-session",
      storyClusterId: "story-1",
    }]);

    expect(selected).toHaveLength(1);
  });

  it("boosts matching source, feed, and keywords for positive feedback", () => {
    const profile = buildFeedbackProfile([
      {
        category: "AI / Open Source",
        sentiment: "more",
        source: "Hugging Face Blog",
        summary: "NVIDIA releases open model tooling",
        title: "NVIDIA model release",
      },
    ]);

    expect(
      feedbackScoreAdjustment(profile, {
        category: "AI / Biznes / Rynek",
        source: "Hugging Face Blog",
        text: "NVIDIA model demand grows in open AI tooling",
      }),
    ).toBe(16);
  });

  it("penalizes matching source, feed, and keywords for negative feedback with caps", () => {
    const profile = buildFeedbackProfile([
      {
        category: "Software / IT",
        sentiment: "less",
        source: "Example Source",
        summary: "Framework release release release release release",
        title: "Framework update",
      },
      {
        category: "Software / IT",
        sentiment: "less",
        source: "Other Source",
        summary: "Framework release update tooling",
        title: "Tooling update",
      },
    ]);

    expect(
      feedbackScoreAdjustment(profile, {
        category: "Software / Engineering",
        source: "Example Source",
        text: "Framework release update tooling notes",
      }),
    ).toBe(-29);
  });
});

import { describe, expect, it } from "vitest";

import { analyzeReadableContent } from "./readable-content";

const paragraph = (seed: string) => `<p>${`${seed} useful written reporting with concrete context and details. `.repeat(12)}</p>`;

describe("readable article classification", () => {
  it("rejects an audio player with only a short teaser", () => {
    const result = analyzeReadableContent(`
      <html><body><main><h1>Daily briefing</h1><p>Listen to today's full story.</p>
      <audio controls src="briefing.mp3"></audio></main></body></html>
    `);

    expect(result).toMatchObject({ hasAudio: true, mode: "audio_only" });
  });

  it("keeps a written article that also offers optional audio", () => {
    const result = analyzeReadableContent(`
      <html><body><article><audio controls src="story.mp3"></audio>
      ${paragraph("First")}${paragraph("Second")}</article></body></html>
    `);

    expect(result).toMatchObject({ hasAudio: true, mode: "readable" });
  });

  it("rejects empty video pages and short teaser pages", () => {
    expect(analyzeReadableContent(`<main><iframe src="https://youtube.com/embed/abc"></iframe></main>`).mode).toBe(
      "video_only",
    );
    expect(analyzeReadableContent("<main><p>A very short news teaser.</p></main>").mode).toBe("insufficient_text");
  });

  it("prefers the article body over long navigation boilerplate", () => {
    const result = analyzeReadableContent(`
      <body><nav>${"Navigation item ".repeat(300)}</nav><article>${paragraph("Report")}${paragraph("Analysis")}</article></body>
    `);

    expect(result.mode).toBe("readable");
    expect(result.text).not.toContain("Navigation item");
  });

  it("preserves paragraph boundaries for the cached reader view", () => {
    const result = analyzeReadableContent(`
      <article>${paragraph("First section")}${paragraph("Second section")}</article>
    `);

    expect(result.text).toContain("\n\n");
  });

  it("does not treat text hidden behind an access wall as a reader copy", () => {
    const result = analyzeReadableContent(`
      <article>${paragraph("Preview")}${paragraph("Background")}
      <p>Subscribe to continue reading.</p></article>
    `);

    expect(result).toMatchObject({ mode: "insufficient_text", reason: "access_wall_detected" });
  });
});

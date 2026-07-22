import { describe, expect, it } from "vitest";

import type { ReaderNote } from "./reader-note-types";
import { noteMatchesQuery, parseCreateReaderNoteInput, parseUpdateReaderNoteInput } from "./reader-notes";

const newsItemId = "0f61a512-8b52-4f9a-9d89-dffdf4db93d6";

describe("reader notes", () => {
  it("accepts a quote without a comment", () => {
    expect(parseCreateReaderNoteInput({ kind: "knowledge", newsItemId, noteText: "", quoteText: "Important fact" }))
      .toMatchObject({ kind: "knowledge", noteText: "", quoteText: "Important fact" });
  });

  it("rejects empty and oversized note input", () => {
    expect(parseCreateReaderNoteInput({ kind: "thought", newsItemId, noteText: "" })).toBeNull();
    expect(parseCreateReaderNoteInput({ kind: "thought", newsItemId, noteText: "x".repeat(10_001) })).toBeNull();
  });

  it("accepts only supported updates", () => {
    expect(parseUpdateReaderNoteInput({ status: "done" })).toEqual({ status: "done" });
    expect(parseUpdateReaderNoteInput({ status: "deleted" })).toBeNull();
    expect(parseUpdateReaderNoteInput({})).toBeNull();
  });

  it("searches comments, quotes, stories, sources, topics, and entities", () => {
    const note: ReaderNote = {
      articleId: null,
      createdAt: "2026-07-20T10:00:00Z",
      entityTags: ["OpenAI"],
      id: "note-1",
      kind: "research",
      newsItemId,
      noteText: "Sprawdzić wpływ na rynek",
      publishedAt: null,
      quotePrefix: null,
      quoteSuffix: null,
      quoteText: "Nowy model zwiększa wydajność.",
      source: "Example Source",
      sourceUrl: "https://example.com/story",
      status: "open",
      storyClusterId: null,
      title: "Nowy model AI",
      topicTags: ["inference"],
      updatedAt: "2026-07-20T10:00:00Z",
    };

    expect(noteMatchesQuery(note, "openai")).toBe(true);
    expect(noteMatchesQuery(note, "wydajność")).toBe(true);
    expect(noteMatchesQuery(note, "energia")).toBe(false);
  });
});

export const READER_NOTE_KINDS = ["knowledge", "research", "thought"] as const;
export const READER_NOTE_STATUSES = ["open", "done"] as const;
export const READER_NOTE_MAX_LENGTH = 10_000;
export const READER_NOTE_QUOTE_MAX_LENGTH = 4_000;
export const READER_NOTE_CONTEXT_MAX_LENGTH = 200;

export type ReaderNoteKind = (typeof READER_NOTE_KINDS)[number];
export type ReaderNoteStatus = (typeof READER_NOTE_STATUSES)[number];

export const READER_NOTE_KIND_LABELS = {
  knowledge: "Ważna wiedza",
  research: "Do zgłębienia",
  thought: "Własna myśl",
} satisfies Record<ReaderNoteKind, string>;

export type ReaderNote = {
  articleId: string | null;
  createdAt: string;
  entityTags: string[];
  id: string;
  kind: ReaderNoteKind;
  newsItemId: string | null;
  noteText: string;
  publishedAt: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  quoteText: string | null;
  source: string;
  sourceUrl: string;
  status: ReaderNoteStatus;
  storyClusterId: string | null;
  title: string;
  topicTags: string[];
  updatedAt: string;
};

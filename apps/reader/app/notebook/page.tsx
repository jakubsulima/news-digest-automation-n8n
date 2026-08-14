import { Search } from "lucide-react";
import Link from "next/link";

import { NotebookNotes } from "@/components/notebook-notes";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireCurrentReader } from "@/lib/auth";
import {
  READER_NOTE_KINDS,
  READER_NOTE_STATUSES,
  type ReaderNoteKind,
  type ReaderNoteStatus,
} from "@/lib/reader-note-types";
import { getReaderNotes } from "@/lib/reader-notes";
import { localize } from "@/lib/reader-locale";
import { getReaderLocale } from "@/lib/reader-locale-server";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

const KIND_OPTIONS: Array<{ id: ReaderNoteKind | null; labels: readonly [string, string] }> = [
  { id: null, labels: ["Wszystkie", "All"] },
  { id: "knowledge", labels: ["Ważna wiedza", "Key knowledge"] },
  { id: "research", labels: ["Do zgłębienia", "Research"] },
  { id: "thought", labels: ["Własne myśli", "Own thoughts"] },
];

const STATUS_OPTIONS: Array<{ id: ReaderNoteStatus | null; labels: readonly [string, string] }> = [
  { id: "open", labels: ["Otwarte", "Open"] },
  { id: "done", labels: ["Zakończone", "Done"] },
  { id: null, labels: ["Każdy status", "Any status"] },
];

type NotebookPageProps = {
  searchParams?: Promise<{ kind?: string | string[]; page?: string | string[]; q?: string | string[]; status?: string | string[] }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function notebookHref({ kind, page = 1, query, status }: { kind: ReaderNoteKind | null; page?: number; query: string; status: ReaderNoteStatus | null }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (kind) params.set("kind", kind);
  if (status === null) params.set("status", "all");
  else if (status !== "open") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const encoded = params.toString();
  return encoded ? `/notebook?${encoded}` : "/notebook";
}

export default async function NotebookPage({ searchParams }: NotebookPageProps) {
  const user = await requireCurrentReader();
  const locale = await getReaderLocale();
  const params = await searchParams;
  const query = first(params?.q)?.trim().slice(0, 200) || "";
  const rawKind = first(params?.kind);
  const rawStatus = first(params?.status);
  const kind = READER_NOTE_KINDS.includes(rawKind as ReaderNoteKind) ? rawKind as ReaderNoteKind : null;
  const status = rawStatus === "all" ? null : READER_NOTE_STATUSES.includes(rawStatus as ReaderNoteStatus) ? rawStatus as ReaderNoteStatus : "open";
  const requestedPage = Number.parseInt(first(params?.page) || "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const allNotes = await getReaderNotes(user.id, { kind, query, status });
  const pageCount = Math.max(1, Math.ceil(allNotes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const notes = allNotes.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <>
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <PageHeader
        backHref={null}
        title={localize(locale, "Notatnik", "Notebook")}
        description={localize(locale, "Wiedza, pytania i wnioski zapisane z newsów.", "Knowledge, questions, and conclusions saved from news stories.")}
      />

      <section className="-mx-4 grid gap-3 border-y bg-card/60 p-4 md:mx-0 md:rounded-xl md:border md:p-3 md:shadow-sm" aria-label={localize(locale, "Filtry notatnika", "Notebook filters")}>
        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" action="/notebook">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <input type="hidden" name="status" value={status || "all"} />
          <Input name="q" defaultValue={query} maxLength={200} placeholder={localize(locale, "Szukaj w notatkach, cytatach i tematach…", "Search notes, quotes, and topics…")} aria-label={localize(locale, "Szukaj w notatkach", "Search notes")} />
          <Button type="submit"><Search aria-hidden="true" /> {localize(locale, "Szukaj", "Search")}</Button>
        </form>
        <div className="grid gap-2 border-t pt-3">
          <nav className="flex flex-wrap gap-1.5" aria-label={localize(locale, "Rodzaj notatki", "Note type")}>
            {KIND_OPTIONS.map((option) => (
              <Link
                key={option.id || "all"}
                href={notebookHref({ kind: option.id, query, status })}
                className={buttonVariants({ variant: kind === option.id ? "default" : "outline", size: "sm" })}
              >
                {localize(locale, option.labels[0], option.labels[1])}
              </Link>
            ))}
          </nav>
          <nav className="flex flex-wrap gap-1.5" aria-label={localize(locale, "Status notatki", "Note status")}>
            {STATUS_OPTIONS.map((option) => (
              <Link
                key={option.id || "all"}
                href={notebookHref({ kind, query, status: option.id })}
                className={buttonVariants({ variant: status === option.id ? "secondary" : "ghost", size: "sm" })}
              >
                {localize(locale, option.labels[0], option.labels[1])}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <NotebookNotes key={`${query}:${kind || "all"}:${status || "all"}:${currentPage}`} initialNotes={notes} />

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between" aria-label={localize(locale, "Strony notatnika", "Notebook pages")}>
          {currentPage > 1 ? <Link className={buttonVariants({ variant: "outline" })} href={notebookHref({ kind, page: currentPage - 1, query, status })}>{localize(locale, "Poprzednia", "Previous")}</Link> : <span />}
          <span className="text-sm text-muted-foreground">{localize(locale, `Strona ${currentPage} z ${pageCount}`, `Page ${currentPage} of ${pageCount}`)}</span>
          {currentPage < pageCount ? <Link className={buttonVariants({ variant: "outline" })} href={notebookHref({ kind, page: currentPage + 1, query, status })}>{localize(locale, "Następna", "Next")}</Link> : <span />}
        </nav>
      ) : null}
    </main>
    <MobileBottomNav />
    </>
  );
}

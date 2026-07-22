import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";

import { NotebookNotes } from "@/components/notebook-notes";
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

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

const KIND_OPTIONS: Array<{ id: ReaderNoteKind | null; label: string }> = [
  { id: null, label: "Wszystkie" },
  { id: "knowledge", label: "Ważna wiedza" },
  { id: "research", label: "Do zgłębienia" },
  { id: "thought", label: "Własne myśli" },
];

const STATUS_OPTIONS: Array<{ id: ReaderNoteStatus | null; label: string }> = [
  { id: "open", label: "Otwarte" },
  { id: "done", label: "Zakończone" },
  { id: null, label: "Każdy status" },
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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-center gap-3">
        <Link className={buttonVariants({ variant: "outline", size: "icon-lg" })} href="/" title="Wróć" aria-label="Wróć">
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Notatnik</h1>
          <p className="text-sm text-muted-foreground">Wiedza, pytania i wnioski zapisane z newsów.</p>
        </div>
      </header>

      <section className="grid gap-3 rounded-xl border bg-card p-3" aria-label="Filtry notatnika">
        <form className="flex gap-2" action="/notebook">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <input type="hidden" name="status" value={status || "all"} />
          <Input name="q" defaultValue={query} maxLength={200} placeholder="Szukaj w notatkach, cytatach i tematach…" aria-label="Szukaj w notatkach" />
          <Button type="submit"><Search aria-hidden="true" /> Szukaj</Button>
        </form>
        <nav className="flex flex-wrap gap-1.5" aria-label="Rodzaj notatki">
          {KIND_OPTIONS.map((option) => (
            <Link
              key={option.id || "all"}
              href={notebookHref({ kind: option.id, query, status })}
              className={buttonVariants({ variant: kind === option.id ? "default" : "outline", size: "sm" })}
            >
              {option.label}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1.5" aria-label="Status notatki">
          {STATUS_OPTIONS.map((option) => (
            <Link
              key={option.id || "all"}
              href={notebookHref({ kind, query, status: option.id })}
              className={buttonVariants({ variant: status === option.id ? "secondary" : "ghost", size: "sm" })}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </section>

      <NotebookNotes key={`${query}:${kind || "all"}:${status || "all"}:${currentPage}`} initialNotes={notes} />

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Strony notatnika">
          {currentPage > 1 ? <Link className={buttonVariants({ variant: "outline" })} href={notebookHref({ kind, page: currentPage - 1, query, status })}>Poprzednia</Link> : <span />}
          <span className="text-sm text-muted-foreground">Strona {currentPage} z {pageCount}</span>
          {currentPage < pageCount ? <Link className={buttonVariants({ variant: "outline" })} href={notebookHref({ kind, page: currentPage + 1, query, status })}>Następna</Link> : <span />}
        </nav>
      ) : null}
    </main>
  );
}

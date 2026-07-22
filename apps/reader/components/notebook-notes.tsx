"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Check, ExternalLink, Loader2, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  READER_NOTE_KIND_LABELS,
  READER_NOTE_KINDS,
  READER_NOTE_MAX_LENGTH,
  type ReaderNote,
} from "@/lib/reader-note-types";
import { cn } from "@/lib/utils";

type NotebookNotesProps = { initialNotes: ReaderNote[] };

export function NotebookNotes({ initialNotes }: NotebookNotesProps) {
  const [notes, setNotes] = useState(initialNotes);

  function replaceNote(nextNote: ReaderNote) {
    setNotes((current) => current.map((note) => note.id === nextNote.id ? nextNote : note));
  }

  if (!notes.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>Brak notatek pasujących do tego widoku.</p>
          <Link className={cn(buttonVariants({ variant: "outline" }), "mt-4")} href="/">Wróć do newsów</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {notes.map((note) => (
        <NotebookNoteCard
          key={note.id}
          note={note}
          onDelete={() => setNotes((current) => current.filter((candidate) => candidate.id !== note.id))}
          onUpdate={replaceNote}
        />
      ))}
    </div>
  );
}

type NotebookNoteCardProps = {
  note: ReaderNote;
  onDelete: () => void;
  onUpdate: (note: ReaderNote) => void;
};

function NotebookNoteCard({ note, onDelete, onUpdate }: NotebookNoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState(note.noteText);
  const [kind, setKind] = useState(note.kind);
  const [pending, setPending] = useState<"delete" | "save" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patchNote(update: Record<string, unknown>, action: "save" | "status") {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        body: JSON.stringify(update),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; note?: ReaderNote } | null;
      if (!response.ok || !payload?.note) throw new Error(payload?.error || "Nie udało się zaktualizować notatki.");
      onUpdate(payload.note);
      setNoteText(payload.note.noteText);
      setKind(payload.note.kind);
      setEditing(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Nie udało się zaktualizować notatki.");
    } finally {
      setPending(null);
    }
  }

  async function deleteNote() {
    setPending("delete");
    setError(null);
    try {
      const response = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { error?: string; ok?: boolean } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Nie udało się usunąć notatki.");
      onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Nie udało się usunąć notatki.");
      setPending(null);
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{READER_NOTE_KIND_LABELS[note.kind]}</Badge>
            <Badge variant="outline">{note.status === "open" ? "Otwarte" : "Zakończone"}</Badge>
            <span className="text-xs text-muted-foreground">{note.source}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={note.status === "open" ? "Oznacz jako zakończone" : "Otwórz ponownie"}
              aria-label={note.status === "open" ? "Oznacz jako zakończone" : "Otwórz ponownie"}
              disabled={pending !== null}
              onClick={() => void patchNote({ status: note.status === "open" ? "done" : "open" }, "status")}
            >
              {pending === "status" ? <Loader2 className="animate-spin" aria-hidden="true" /> : note.status === "open" ? <Check aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" title="Edytuj" aria-label="Edytuj" onClick={() => setEditing((value) => !value)}>
              {editing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            </Button>
            <DeleteNoteDialog pending={pending === "delete"} onConfirm={() => void deleteNote()} />
          </div>
        </div>
        <CardTitle>
          {note.newsItemId ? <Link href={`/news/${note.newsItemId}`} className="hover:underline">{note.title}</Link> : note.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {note.quoteText ? (
          <blockquote className="border-l-2 border-primary/35 pl-3 text-sm leading-6 text-muted-foreground">{note.quoteText}</blockquote>
        ) : null}

        {editing ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void patchNote({ kind, noteText }, "save");
            }}
          >
            <div className="flex flex-wrap gap-1.5" aria-label="Rodzaj notatki">
              {READER_NOTE_KINDS.map((candidate) => (
                <Button key={candidate} type="button" size="sm" variant={kind === candidate ? "default" : "outline"} onClick={() => setKind(candidate)}>
                  {READER_NOTE_KIND_LABELS[candidate]}
                </Button>
              ))}
            </div>
            <Textarea value={noteText} maxLength={READER_NOTE_MAX_LENGTH} onChange={(event) => setNoteText(event.target.value)} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending !== null || (!noteText.trim() && !note.quoteText)}>
                {pending === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null} Zapisz
              </Button>
            </div>
          </form>
        ) : note.noteText ? (
          <p className="whitespace-pre-wrap text-sm leading-6">{note.noteText}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <div className="flex flex-wrap gap-1">
            {[...note.topicTags, ...note.entityTags].slice(0, 8).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
          <a className={buttonVariants({ variant: "outline", size: "sm" })} href={note.sourceUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" /> Źródło
          </a>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function DeleteNoteDialog({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className="inline-flex size-7 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10" aria-label="Usuń notatkę" title="Usuń notatkę">
        <Trash2 aria-hidden="true" className="size-4" />
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/45" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Popup className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-2xl outline-none">
            <AlertDialog.Title className="text-lg font-semibold">Usunąć notatkę?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">Tej operacji nie można cofnąć.</AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close className={buttonVariants({ variant: "outline" })}>Anuluj</AlertDialog.Close>
              <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />} Usuń
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

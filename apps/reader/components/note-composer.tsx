"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

import { useLocalize } from "@/components/reader-locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  READER_NOTE_KIND_LABELS,
  READER_NOTE_MAX_LENGTH,
  type ReaderNote,
  type ReaderNoteKind,
} from "@/lib/reader-note-types";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: Array<{ descriptions: readonly [string, string]; id: ReaderNoteKind; labels: readonly [string, string] }> = [
  { descriptions: ["Fakt lub informacja do zachowania", "A fact or detail worth keeping"], id: "knowledge", labels: [READER_NOTE_KIND_LABELS.knowledge, "Key knowledge"] },
  { descriptions: ["Pytanie wymagające dalszego researchu", "A question for further research"], id: "research", labels: [READER_NOTE_KIND_LABELS.research, "Research"] },
  { descriptions: ["Twój wniosek albo pomysł", "Your conclusion or idea"], id: "thought", labels: [READER_NOTE_KIND_LABELS.thought, "Own thought"] },
];

export type ReaderQuoteSelection = {
  prefix: string | null;
  suffix: string | null;
  text: string;
};

type NoteComposerProps = {
  articleId?: string | null;
  initialKind?: ReaderNoteKind;
  newsItemId: string;
  onCreated?: (note: ReaderNote) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  quote?: ReaderQuoteSelection | null;
};

export function NoteComposer({
  articleId = null,
  initialKind = "thought",
  newsItemId,
  onCreated,
  onOpenChange,
  open,
  quote = null,
}: NoteComposerProps) {
  return open ? (
    <NoteComposerDialog
      articleId={articleId}
      initialKind={initialKind}
      newsItemId={newsItemId}
      onCreated={onCreated}
      onOpenChange={onOpenChange}
      quote={quote}
    />
  ) : null;
}

type NoteComposerDialogProps = Omit<NoteComposerProps, "open">;

function NoteComposerDialog({
  articleId,
  initialKind = "thought",
  newsItemId,
  onCreated,
  onOpenChange,
  quote,
}: NoteComposerDialogProps) {
  const l = useLocalize();
  const [kind, setKind] = useState<ReaderNoteKind>(initialKind);
  const [noteText, setNoteText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submitNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (!noteText.trim() && !quote?.text)) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/notes", {
        body: JSON.stringify({
          articleId,
          kind,
          newsItemId,
          noteText,
          quotePrefix: quote?.prefix || null,
          quoteSuffix: quote?.suffix || null,
          quoteText: quote?.text || null,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; note?: ReaderNote } | null;
      if (!response.ok || !payload?.note) throw new Error(payload?.error || l("Nie udało się zapisać notatki.", "Could not save the note."));
      onCreated?.(payload.note);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : l("Nie udało się zapisać notatki.", "Could not save the note."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <Dialog.Popup
            initialFocus={textareaRef}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background p-4 shadow-2xl outline-none transition data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:max-w-xl sm:rounded-2xl sm:p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">{l("Dodaj do notatnika", "Add to notebook")}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {l("Zachowaj wiedzę, pytanie albo własny wniosek razem ze źródłem.", "Save knowledge, a question, or your own conclusion together with its source.")}
                </Dialog.Description>
              </div>
              <Dialog.Close className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted" aria-label={l("Zamknij", "Close")}>
                <X aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>

            <form className="mt-4 grid gap-4" onSubmit={submitNote}>
              {quote?.text ? (
                <blockquote className="max-h-36 overflow-y-auto border-l-2 border-primary/40 pl-3 text-sm leading-6 text-muted-foreground">
                  {quote.text}
                </blockquote>
              ) : null}

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">{l("Rodzaj notatki", "Note type")}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {KIND_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={kind === option.id}
                      className={cn(
                        "rounded-lg border p-2 text-left transition-colors hover:bg-muted/50",
                        kind === option.id && "border-primary bg-accent",
                      )}
                      onClick={() => setKind(option.id)}
                    >
                      <span className="block text-sm font-medium">{l(option.labels[0], option.labels[1])}</span>
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{l(option.descriptions[0], option.descriptions[1])}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1.5 text-sm font-medium">
                {l("Twoja notatka", "Your note")} {quote?.text ? <span className="font-normal text-muted-foreground">{l("(opcjonalna)", "(optional)")}</span> : null}
                <Textarea
                  ref={textareaRef}
                  value={noteText}
                  maxLength={READER_NOTE_MAX_LENGTH}
                  placeholder={kind === "research" ? l("Co chcesz sprawdzić lub zrozumieć?", "What do you want to investigate or understand?") : l("Zapisz swoją myśl…", "Write down your thought…")}
                  onChange={(event) => setNoteText(event.target.value)}
                />
              </label>

              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{l("Anuluj", "Cancel")}</Button>
                <Button type="submit" disabled={pending || (!noteText.trim() && !quote?.text)}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  {l("Zapisz notatkę", "Save note")}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

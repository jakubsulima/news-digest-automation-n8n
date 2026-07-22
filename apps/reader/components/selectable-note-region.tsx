"use client";

import { Highlighter } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { NoteComposer, type ReaderQuoteSelection } from "@/components/note-composer";
import { Button } from "@/components/ui/button";
import { READER_NOTE_CONTEXT_MAX_LENGTH, READER_NOTE_QUOTE_MAX_LENGTH } from "@/lib/reader-note-types";

type SelectableNoteRegionProps = {
  articleId?: string | null;
  children: ReactNode;
  newsItemId: string;
};

function selectionContext(selection: Selection, range: Range): ReaderQuoteSelection | null {
  const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, READER_NOTE_QUOTE_MAX_LENGTH);
  if (!text) return null;
  const startText = range.startContainer.textContent || "";
  const endText = range.endContainer.textContent || "";
  return {
    prefix:
      startText
        .slice(Math.max(0, range.startOffset - READER_NOTE_CONTEXT_MAX_LENGTH), range.startOffset)
        .replace(/\s+/g, " ")
        .trim() || null,
    suffix:
      endText
        .slice(range.endOffset, range.endOffset + READER_NOTE_CONTEXT_MAX_LENGTH)
        .replace(/\s+/g, " ")
        .trim() || null,
    text,
  };
}

export function SelectableNoteRegion({ articleId = null, children, newsItemId }: SelectableNoteRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<ReaderQuoteSelection | null>(null);
  const [open, setOpen] = useState(false);

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !regionRef.current) {
      setQuote(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    if (!regionRef.current.contains(ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor)) {
      setQuote(null);
      return;
    }
    setQuote(selectionContext(selection, range));
  }

  return (
    <div ref={regionRef} className="grid gap-5" onPointerUp={captureSelection} onKeyUp={captureSelection}>
      {children}
      {quote ? (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <Button className="shadow-lg" size="lg" type="button" onClick={() => setOpen(true)}>
            <Highlighter aria-hidden="true" /> Zapisz zaznaczenie
          </Button>
        </div>
      ) : null}
      <NoteComposer
        articleId={articleId}
        initialKind="knowledge"
        newsItemId={newsItemId}
        open={open}
        quote={quote}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            window.getSelection()?.removeAllRanges();
            setQuote(null);
          }
        }}
      />
    </div>
  );
}

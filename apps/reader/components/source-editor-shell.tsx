"use client";

import { ChevronDown, Rss } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { SourceEnabledToggle } from "@/components/source-enabled-toggle";
import { cn } from "@/lib/utils";

export function SourceEditorShell({
  category,
  children,
  defaultEnabled,
  enabledFieldName,
  sourceName,
  status,
  url,
}: {
  category: string;
  children: ReactNode;
  defaultEnabled: boolean;
  enabledFieldName: string;
  sourceName: string;
  status?: ReactNode;
  url: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border bg-background/70 transition-[background-color,border-color,box-shadow] duration-300">
      <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2">
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={open}
          className="grid w-full min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-0.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground" aria-hidden="true">
            <Rss className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{sourceName}</span>
              {status}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{category} · {url}</span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>

        <SourceEnabledToggle
          defaultEnabled={defaultEnabled}
          name={enabledFieldName}
          sourceName={sourceName}
        />
      </div>

      <div
        id={contentId}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid min-w-0 gap-3 border-t bg-muted/10 p-3">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

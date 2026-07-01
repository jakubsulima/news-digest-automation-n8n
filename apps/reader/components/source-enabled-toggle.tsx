"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export function SourceEnabledToggle({
  defaultEnabled,
  name,
}: {
  defaultEnabled: boolean;
  name: string;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);

  return (
    <>
      <input type="hidden" name={name} value={enabled ? "on" : "off"} />
      <button
        type="button"
        aria-pressed={enabled}
        className={cn(
          "inline-flex h-7 min-w-12 items-center justify-center rounded-full border px-2.5 text-xs font-semibold transition-colors",
          enabled
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setEnabled((current) => !current);
        }}
      >
        {enabled ? "on" : "off"}
      </button>
    </>
  );
}

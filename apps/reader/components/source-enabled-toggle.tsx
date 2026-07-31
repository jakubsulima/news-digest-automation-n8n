"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export function SourceEnabledToggle({
  defaultEnabled,
  defaultSelectionMode,
  name,
  selectionModeName,
  sourceName,
}: {
  defaultEnabled: boolean;
  defaultSelectionMode: "auto" | "always_on" | "blocked";
  name: string;
  selectionModeName: string;
  sourceName: string;
}) {
  const [state, setState] = useState({
    enabled: defaultEnabled,
    selectionMode: defaultSelectionMode,
  });

  return (
    <>
      <input type="hidden" name={name} value={state.enabled ? "on" : "off"} />
      <input type="hidden" name={selectionModeName} value={state.selectionMode} />
      <button
        type="button"
        aria-label={`${state.enabled ? "Disable" : "Enable"} ${sourceName}`}
        title={state.enabled ? "Active — click to disable" : "Off — click to enable"}
        role="switch"
        aria-checked={state.enabled}
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-full border px-2 transition-[color,background-color,border-color,box-shadow] duration-300 ease-out focus-visible:ring-3 focus-visible:ring-ring/40",
          state.enabled
            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200"
            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
        onClick={() => setState((current) => {
          const enabled = !current.enabled;
          return {
            enabled,
            selectionMode: enabled ? "always_on" : "blocked",
          };
        })}
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative h-4 w-7 overflow-hidden rounded-full transition-colors duration-300 ease-out",
            state.enabled ? "bg-emerald-500" : "bg-foreground/20",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 size-3 rounded-full bg-white ring-1 ring-black/10 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              state.enabled ? "translate-x-3" : "translate-x-0",
            )}
          />
        </span>
      </button>
    </>
  );
}

"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "reader-theme";

const THEME_OPTIONS: Array<{
  icon: typeof Sun;
  label: string;
  mode: ThemeMode;
}> = [
  { icon: Sun, label: "Light", mode: "light" },
  { icon: Moon, label: "Dark", mode: "dark" },
  { icon: Laptop, label: "System", mode: "system" },
];

function storedThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readThemeMode() {
  return storedThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function prefersDarkMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyThemeMode(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && prefersDarkMode());

  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";

  return dark;
}

export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolvedDark, setResolvedDark] = useState(false);

  useEffect(() => {
    const nextMode = readThemeMode();

    setMode(nextMode);
    setResolvedDark(applyThemeMode(nextMode));

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (readThemeMode() === "system") {
        setResolvedDark(applyThemeMode("system"));
      }
    };

    mediaQuery.addEventListener("change", syncSystemTheme);

    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, []);

  function updateMode(nextMode: ThemeMode) {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    setMode(nextMode);
    setResolvedDark(applyThemeMode(nextMode));
  }

  if (compact) {
    const nextMode: ThemeMode = resolvedDark ? "light" : "dark";
    const ActiveIcon = resolvedDark ? Moon : Sun;

    return (
      <Button
        className={className}
        type="button"
        variant="outline"
        size="icon-lg"
        title={`Switch to ${nextMode} mode`}
        aria-label={`Switch to ${nextMode} mode`}
        onClick={() => updateMode(nextMode)}
      >
        <ActiveIcon aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className={cn("grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-1", className)}>
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = mode === option.mode;

        return (
          <Button
            key={option.mode}
            type="button"
            variant={active ? "secondary" : "ghost"}
            className={cn("h-auto min-h-10 flex-col gap-1 px-2 py-2", active ? "shadow-sm" : null)}
            aria-pressed={active}
            onClick={() => updateMode(option.mode)}
          >
            <Icon aria-hidden="true" />
            <span className="text-xs">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useLocalize, useReaderLocale } from "@/components/reader-locale-provider";
import { Button } from "@/components/ui/button";
import { READER_LOCALE_COOKIE, type ReaderLocale } from "@/lib/reader-locale";
import { cn } from "@/lib/utils";

const LANGUAGE_OPTIONS: Array<{ label: string; locale: ReaderLocale; shortLabel: string }> = [
  { label: "Polski", locale: "pl", shortLabel: "PL" },
  { label: "English", locale: "en", shortLabel: "EN" },
];

export function LanguageToggle({ className }: { className?: string }) {
  const locale = useReaderLocale();
  const l = useLocalize();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function updateLocale(nextLocale: ReaderLocale) {
    if (nextLocale === locale) return;

    document.cookie = `${READER_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    startTransition(() => router.refresh());
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1", className)}>
      {LANGUAGE_OPTIONS.map((option) => (
        <Button
          key={option.locale}
          type="button"
          variant={locale === option.locale ? "secondary" : "ghost"}
          className={cn("min-h-10 gap-2 px-3", locale === option.locale && "shadow-sm")}
          aria-pressed={locale === option.locale}
          disabled={pending}
          onClick={() => updateLocale(option.locale)}
        >
          <Languages className="size-4" aria-hidden="true" />
          <span>{option.label}</span>
          <span className="text-[0.68rem] text-muted-foreground">{option.shortLabel}</span>
        </Button>
      ))}
      <span className="sr-only" aria-live="polite">
        {pending ? l("Zmienianie języka", "Changing language") : ""}
      </span>
    </div>
  );
}


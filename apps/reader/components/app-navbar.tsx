"use client";

import { List, LogOut, Newspaper, NotebookPen, Settings } from "lucide-react";
import Link from "next/link";

import { useLocalize } from "@/components/reader-locale-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useRememberedNewsHref } from "@/components/use-remembered-news-href";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppNavbarProps = {
  email: string;
  mobileContext?: string;
  signOut: () => Promise<void>;
};

const NAV_ITEMS = [
  { href: "/news", icon: List, labels: ["Newsy", "News"] },
  { href: "/notebook", icon: NotebookPen, labels: ["Notatnik", "Notebook"] },
  { href: "/settings", icon: Settings, labels: ["Ustawienia", "Settings"] },
] as const;

export function AppNavbar({ email, mobileContext, signOut }: AppNavbarProps) {
  const l = useLocalize();
  const newsHref = useRememberedNewsHref();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/92 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 shrink items-center gap-2 rounded-lg pr-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          title={`Daily News Digest · ${email}`}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-primary md:bg-primary md:text-primary-foreground md:shadow-sm">
            <Newspaper className="size-6 md:size-4" strokeWidth={2.15} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold leading-tight text-primary md:text-sm md:text-foreground">Daily News Digest</span>
            <span className="hidden max-w-40 truncate text-[0.68rem] text-muted-foreground md:block">{email}</span>
          </span>
        </Link>

        {mobileContext ? (
          <span className="ml-auto truncate pl-2 text-xs font-medium text-muted-foreground md:hidden">
            {mobileContext}
          </span>
        ) : null}

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label={l("Główna nawigacja", "Main navigation")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const label = l(item.labels[0], item.labels[1]);

            return (
              <Link
                key={item.href}
                href={item.href === "/news" ? newsHref : item.href}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-lg" }),
                  "md:w-auto md:px-3",
                )}
                title={label}
              >
                <Icon aria-hidden="true" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-1 border-l pl-2 md:flex">
          <ThemeToggle compact />
          <form action={signOut}>
            <Button variant="ghost" size="icon-lg" type="submit" title={l("Wyloguj się", "Sign out")} aria-label={l("Wyloguj się", "Sign out")}>
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

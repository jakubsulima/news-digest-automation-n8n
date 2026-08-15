"use client";

import { Newspaper, NotebookTabs, Settings, TextSearch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLocalize } from "@/components/reader-locale-provider";
import { cn } from "@/lib/utils";

const MOBILE_NAV_ITEMS = [
  { href: "/", icon: Newspaper, labels: ["Dzisiaj", "Today"], matches: (pathname: string) => pathname === "/" },
  { href: "/news", icon: TextSearch, labels: ["Newsy", "News"], matches: (pathname: string) => pathname.startsWith("/news") },
  { href: "/notebook", icon: NotebookTabs, labels: ["Notatnik", "Notebook"], matches: (pathname: string) => pathname.startsWith("/notebook") },
  { href: "/settings", icon: Settings, labels: ["Ustawienia", "Settings"], matches: (pathname: string) => pathname.startsWith("/settings") },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const l = useLocalize();

  if (pathname.startsWith("/login")) {
    return null;
  }

  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t bg-background/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label={l("Główna nawigacja", "Main navigation")}
    >
      <div className="mx-auto grid h-17 max-w-md grid-cols-4 px-1">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = item.matches(pathname);
          const Icon = item.icon;
          const label = l(item.labels[0], item.labels[1]);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[0.68rem] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                active && "text-primary",
              )}
            >
              <span
                className={cn(
                  "absolute inset-x-3 top-0 h-0.5 rounded-full bg-transparent transition-colors",
                  active && "bg-primary",
                )}
                aria-hidden="true"
              />
              <Icon className="size-6" strokeWidth={active ? 2.25 : 1.8} aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

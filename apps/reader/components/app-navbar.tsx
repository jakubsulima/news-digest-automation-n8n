import { LogOut, Newspaper, NotebookPen, Settings } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppNavbarProps = {
  email: string;
  signOut: () => Promise<void>;
};

const NAV_ITEMS = [
  { href: "/notebook", icon: NotebookPen, label: "Notebook" },
  { href: "/settings", icon: Settings, label: "Settings" },
] as const;

export function AppNavbar({ email, signOut }: AppNavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/92 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:h-16 sm:px-6">
        <Link
          href="#page-top"
          className="flex min-w-0 shrink items-center gap-2 rounded-lg pr-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          title={`Daily News Digest · ${email}`}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Newspaper className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold leading-tight">Daily News Digest</span>
            <span className="block max-w-40 truncate text-[0.68rem] text-muted-foreground">{email}</span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-lg" }),
                  "md:w-auto md:px-3",
                )}
                title={item.label}
              >
                <Icon aria-hidden="true" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 border-l pl-2">
          <ThemeToggle compact />
          <form action={signOut}>
            <Button variant="ghost" size="icon-lg" type="submit" title="Sign out" aria-label="Sign out">
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

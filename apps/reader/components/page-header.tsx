"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useLocalize } from "@/components/reader-locale-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  actions?: ReactNode;
  backHref?: string | null;
  backLabel?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  backHref = "/",
  backLabel,
  description,
  title,
}: PageHeaderProps) {
  const l = useLocalize();
  const resolvedBackLabel = backLabel ?? l("Wróć", "Back");

  return (
    <header className="flex flex-wrap items-start gap-3">
      {backHref ? (
        <Link
          className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "shrink-0 bg-card/80")}
          href={backHref}
          title={resolvedBackLabel}
          aria-label={resolvedBackLabel}
        >
          <ArrowLeft aria-hidden="true" />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1 pt-0.5">
        <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <div className="mt-1 text-sm leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
    </header>
  );
}

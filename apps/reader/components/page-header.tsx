import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  backHref = "/",
  backLabel = "Wróć",
  description,
  title,
}: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start gap-3">
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "shrink-0 bg-card/80")}
        href={backHref}
        title={backLabel}
        aria-label={backLabel}
      >
        <ArrowLeft aria-hidden="true" />
      </Link>
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

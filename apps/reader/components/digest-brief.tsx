"use client";

import { ArrowRight, ChevronRight, Clock3, ExternalLink, ListTree, Newspaper } from "lucide-react";
import Link from "next/link";

import { useLocalize, useReaderLocale } from "@/components/reader-locale-provider";
import { buttonVariants } from "@/components/ui/button";
import type { DigestBrief } from "@/lib/digest-brief";
import { localize, type ReaderLocale } from "@/lib/reader-locale";

type DigestBriefProps = {
  brief: DigestBrief;
};

const TECHNICAL_REASON_COPY: Record<string, readonly [string, string]> = {
  "build opportunity": ["Może tworzyć konkretną okazję produktową, integracyjną albo automatyzacyjną.", "It may create a concrete product, integration, or automation opportunity."],
  "competitive intelligence": ["Pomaga ocenić pozycjonowanie, dystrybucję i ruchy konkurencji.", "It helps assess competitors' positioning, distribution, and moves."],
  "geopolitical risk": ["Może wpłynąć na łańcuchy dostaw, energię, sankcje albo bezpieczeństwo.", "It may affect supply chains, energy, sanctions, or security."],
  "infrastructure outage": ["Dotyczy odporności infrastruktury i ryzyka przerw w działaniu usług.", "It concerns infrastructure resilience and the risk of service disruption."],
  "investment signal": ["Może być istotnym sygnałem dla przepływu kapitału i nastrojów rynkowych.", "It may be a meaningful signal for capital flows and market sentiment."],
  "market risk": ["Może wpłynąć na wyceny, budżety firm i decyzje klientów.", "It may affect valuations, company budgets, and customer decisions."],
  "product trend": ["Wskazuje trend, który warto uwzględnić w planach produktowych i technologicznych.", "It highlights a trend worth considering in product and technology plans."],
  "regulatory risk": ["Może zmienić zasady dostępu do rynku, danych, technologii albo zgodności.", "It may change the rules for market, data, technology, or compliance access."],
  "security risk": ["Pokazuje realne ryzyko bezpieczeństwa, które warto szybko ocenić.", "It signals a concrete security risk worth assessing quickly."],
};

function readerFriendlyWhy(value: string, locale: ReaderLocale) {
  const technicalReason = value.match(/^Selected as ([^:.;]+)/i)?.[1]?.toLowerCase();
  const copy = technicalReason ? TECHNICAL_REASON_COPY[technicalReason] : null;
  return copy ? localize(locale, copy[0], copy[1]) : technicalReason ? localize(locale, "To ważny sygnał, który może wymagać dalszej analizy.", "This is an important signal that may need further analysis.") : value;
}

function BriefHighlights({ highlights }: { highlights: DigestBrief["highlights"] }) {
  const locale = useReaderLocale();
  const l = useLocalize();

  return (
    <ol className="divide-y divide-border" aria-label={l("Najważniejsze newsy", "Top stories")}>
      {highlights.slice(0, 3).map((highlight) => (
        <li key={highlight.newsItemId}>
          <Link
            href={`/news/${highlight.newsItemId}`}
            className="group grid grid-cols-[1fr_auto] content-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/45 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40 md:px-5 md:py-4"
          >
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold md:mb-2">
                <span className="text-primary">{highlight.source}</span>
                <span className="text-muted-foreground" aria-hidden="true">·</span>
                <span className="text-amber-700 dark:text-amber-400">{l("Ważne", "Important")}</span>
              </div>
              <h3 className="line-clamp-2 min-w-0 max-w-full break-words text-base font-semibold leading-5 text-foreground transition-colors [overflow-wrap:anywhere] group-hover:text-primary sm:text-lg sm:leading-6">
                {highlight.title}
              </h3>
              <p className="mt-1.5 line-clamp-1 min-w-0 max-w-full break-words text-[0.82rem] leading-4 text-muted-foreground [overflow-wrap:anywhere] md:mt-2 md:line-clamp-2 md:text-sm md:leading-5">
                <span className="font-semibold text-foreground/75">{l("Dlaczego ważne: ", "Why it matters: ")}</span>
                {readerFriendlyWhy(highlight.whyItMatters, locale)}
              </p>
              <span className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground md:mt-3">
                <Newspaper className="size-4" strokeWidth={1.9} aria-hidden="true" />
                {highlight.source}
              </span>
            </div>
            <ChevronRight className="self-center size-6 text-primary transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function DigestBriefCard({ brief }: DigestBriefProps) {
  const l = useLocalize();

  return (
    <section className="-mx-4 overflow-hidden bg-background md:mx-0 md:rounded-2xl md:border md:bg-card md:shadow-sm" aria-label={l("Podsumowanie dnia", "Daily summary")}>
      <div className="border-b px-4 py-5 md:px-7 md:py-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ListTree className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{l("Pełne podsumowanie dnia", "Full daily briefing")}</h1>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {brief.readingTimeMinutes} min
          </span>
        </div>

        <p className="mt-5 max-w-3xl text-base leading-7 text-foreground/90 md:mt-6 md:text-[1.05rem] md:leading-8">
          {brief.summary}
        </p>
      </div>

      <div className="px-4 py-6 md:px-7 md:py-8">
        <div className="grid gap-8 md:gap-10">
          {brief.sections.map((section) => (
            <article key={`${section.category}-${section.title}`}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight md:text-xl">{section.title}</h2>
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{section.category}</span>
              </div>
              <div className="grid gap-4 text-[0.98rem] leading-7 text-foreground/90 md:text-base md:leading-8">
                {section.paragraphs.map((paragraph, index) => (
                  <div key={`${section.title}-${index}`}>
                    <p className="break-words [overflow-wrap:anywhere]">{paragraph.text}</p>
                    <ReferenceLinks references={paragraph.references} />
                  </div>
                ))}
              </div>
            </article>
          ))}

          {brief.watchlist.length ? (
            <section className="rounded-xl border border-primary/20 bg-primary/[0.045] p-4 md:p-5" aria-labelledby="brief-watchlist-heading">
              <h2 id="brief-watchlist-heading" className="text-lg font-semibold tracking-tight md:text-xl">
                {l("Co obserwować", "What to watch")}
              </h2>
              <ul className="mt-4 grid gap-4">
                {brief.watchlist.map((item, index) => (
                  <li key={`${item.signal}-${index}`} className="grid gap-1.5">
                    <p className="font-semibold leading-6">{item.signal}</p>
                    <p className="text-sm leading-6 text-foreground/80">{item.why}</p>
                    <ReferenceLinks references={item.references} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="border-t pt-4 text-xs leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground/70">{l("Ograniczenia materiału: ", "Material limits: ")}</span>
            {brief.coverageNote}
          </p>
        </div>

        {brief.highlights.length ? (
          <section className="-mx-4 mt-8 border-t md:-mx-7 md:mt-10" aria-labelledby="brief-highlights-heading">
            <h2 id="brief-highlights-heading" className="px-4 pb-2 pt-5 text-lg font-semibold md:px-7 md:pt-6">
              {l("Najważniejsze", "Top stories")}
            </h2>
            <BriefHighlights highlights={brief.highlights} />
            <div className="hidden border-t px-4 py-4 md:block md:px-7">
              <Link
                href="/news"
                className={buttonVariants({ variant: "outline", size: "lg", className: "h-11 w-full md:w-auto" })}
              >
                {l("Wszystkie newsy", "All news")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function ReferenceLinks({ references }: { references: DigestBrief["sections"][number]["paragraphs"][number]["references"] }) {
  const l = useLocalize();

  if (!references.length) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs leading-5 text-muted-foreground" aria-label={l("Źródła akapitu", "Paragraph sources")}>
      <span className="font-semibold text-foreground/60">{l("Źródła:", "Sources:")}</span>
      {references.map((reference) => (
        <Link
          key={reference.newsItemId}
          href={`/news/${reference.newsItemId}`}
          title={reference.title}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/80 bg-background px-2 py-0.5 transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="max-w-[15rem] truncate">{reference.source}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

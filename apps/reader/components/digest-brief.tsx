import { Clock3, Eye, Sparkles, Telescope } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DigestBrief, DigestBriefReference } from "@/lib/digest-brief";

type DigestBriefProps = {
  brief: DigestBrief;
};

function SourceLinks({ references }: { references: DigestBriefReference[] }) {
  if (!references.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" aria-label="Materiały źródłowe">
      <span>Materiały:</span>
      {references.map((reference, index) => (
        <span key={reference.newsItemId}>
          <Link
            href={`/news/${reference.newsItemId}`}
            className="font-medium text-foreground/75 underline decoration-border underline-offset-2 hover:text-primary"
            title={reference.title}
          >
            {reference.source}
          </Link>
          {index < references.length - 1 ? "," : null}
        </span>
      ))}
    </div>
  );
}

function BriefHighlights({ highlights }: { highlights: DigestBrief["highlights"] }) {
  return (
    <ol className="grid gap-3" aria-label="Najważniejsze zmiany">
      {highlights.map((highlight, index) => (
        <li key={highlight.newsItemId} className="grid grid-cols-[1.75rem_1fr] gap-2.5">
          <span
            className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="grid gap-1">
            <p className="text-sm font-medium leading-6 text-foreground">{highlight.whatHappened}</p>
            <p className="text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground/80">Dlaczego to ważne: </span>
              {highlight.whyItMatters}
            </p>
            <Link
              href={`/news/${highlight.newsItemId}`}
              className="w-fit text-xs font-medium text-primary hover:underline"
            >
              {highlight.source} · przeczytaj materiał
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DigestBriefCard({ brief }: DigestBriefProps) {
  return (
    <section aria-label="Pięciominutowy briefing sytuacyjny">
      <Card className="border-primary/20 bg-gradient-to-br from-accent/45 via-card to-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <CardTitle>Briefing sytuacyjny</CardTitle>
            <Badge variant="outline">{brief.digestDate}</Badge>
            <Badge variant="secondary">
              <Clock3 data-icon="inline-start" aria-hidden="true" />
              {brief.readingTimeMinutes} min
            </Badge>
          </div>
          <CardDescription>
            Synteza najważniejszych zmian, ich znaczenia i sygnałów do obserwowania.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-6">
          <section className="grid gap-2" aria-labelledby="brief-overview-heading">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-primary" aria-hidden="true" />
              <h2 id="brief-overview-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                Obraz dnia
              </h2>
            </div>
            <p className="text-[0.95rem] leading-7 text-foreground">{brief.summary}</p>
          </section>

          {brief.highlights.length ? (
            <section className="grid gap-3 border-t border-border/70 pt-5" aria-labelledby="brief-highlights-heading">
              <h2 id="brief-highlights-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                Najważniejsze zmiany
              </h2>
              <BriefHighlights highlights={brief.highlights} />
            </section>
          ) : null}

          {brief.sections.length ? (
            <section className="grid gap-3 border-t border-border/70 pt-5" aria-labelledby="brief-sections-heading">
              <h2 id="brief-sections-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                Sytuacja w Twoich obszarach
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {brief.sections.map((section) => (
                  <article key={`${section.category}-${section.title}`} className="grid content-start gap-2 rounded-lg border bg-background/50 p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold leading-snug">{section.title}</h3>
                      <Badge variant="outline">{section.category}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{section.situation}</p>
                    <SourceLinks references={section.references} />
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {brief.watchlist.length ? (
            <section className="grid gap-3 border-t border-border/70 pt-5" aria-labelledby="brief-watch-heading">
              <div className="flex items-center gap-2">
                <Telescope className="size-4 text-primary" aria-hidden="true" />
                <h2 id="brief-watch-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                  Co obserwować dalej
                </h2>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {brief.watchlist.map((item) => (
                  <li key={item.signal} className="grid content-start gap-1 rounded-lg bg-muted/45 p-3">
                    <p className="text-sm font-medium leading-5">{item.signal}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{item.why}</p>
                    <SourceLinks references={item.references} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground/70">Granice briefingu: </span>
            {brief.coverageNote}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

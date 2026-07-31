import { Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DigestBrief } from "@/lib/digest-brief";

type DigestBriefProps = {
  brief: DigestBrief;
};

function BriefHighlights({ highlights }: { highlights: DigestBrief["highlights"] }) {
  return (
    <ol className="grid gap-2" aria-label="Najważniejsze wiadomości">
      {highlights.map((highlight) => (
        <li key={highlight.newsItemId} className="grid gap-0.5 border-l-2 border-primary/35 pl-3">
          <Link href={`/news/${highlight.newsItemId}`} className="text-sm font-medium leading-snug hover:underline">
            {highlight.title}
          </Link>
          <p className="text-xs leading-5 text-muted-foreground">{highlight.whyItMatters}</p>
          <span className="text-xs text-muted-foreground">{highlight.source}</span>
        </li>
      ))}
    </ol>
  );
}

export function DigestBriefCard({ brief }: DigestBriefProps) {
  const primaryHighlights = brief.highlights.slice(0, 3);
  const remainingHighlights = brief.highlights.slice(3);

  return (
    <section aria-label="Daily briefing">
      <Card className="border-primary/20 bg-gradient-to-br from-accent/45 via-card to-card shadow-sm">
        <CardHeader className="pb-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <CardTitle>Poranny briefing</CardTitle>
            <Badge variant="outline">{brief.digestDate}</Badge>
          </div>
          <CardDescription>Co się wydarzyło i które informacje są najważniejsze.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm leading-6 text-foreground">{brief.summary}</p>
          {primaryHighlights.length ? <BriefHighlights highlights={primaryHighlights} /> : null}
          {remainingHighlights.length ? (
            <details className="group rounded-lg border bg-background/45 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                Pokaż jeszcze {remainingHighlights.length}
              </summary>
              <div className="pt-3">
                <BriefHighlights highlights={remainingHighlights} />
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

import { Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DigestBrief } from "@/lib/digest-brief";

type DigestBriefProps = {
  brief: DigestBrief;
};

export function DigestBriefCard({ brief }: DigestBriefProps) {
  return (
    <section aria-label="Daily briefing">
      <Card className="border-primary/20 bg-accent/30">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <CardTitle>Poranny briefing</CardTitle>
            <Badge variant="outline">{brief.digestDate}</Badge>
          </div>
          <CardDescription>Co się wydarzyło i które informacje są najważniejsze.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm leading-6 text-foreground">{brief.summary}</p>
          {brief.highlights.length ? (
            <ol className="grid gap-2" aria-label="Najważniejsze wiadomości">
              {brief.highlights.map((highlight) => (
                <li key={highlight.newsItemId} className="grid gap-0.5 border-l-2 border-primary/35 pl-3">
                  <Link href={`/news/${highlight.newsItemId}`} className="text-sm font-medium hover:underline">
                    {highlight.title}
                  </Link>
                  <p className="text-xs leading-5 text-muted-foreground">{highlight.whyItMatters}</p>
                  <span className="text-xs text-muted-foreground">{highlight.source}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

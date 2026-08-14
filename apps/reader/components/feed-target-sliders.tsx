"use client";

import { useState } from "react";

import { useLocalize } from "@/components/reader-locale-provider";
import type { DigestFeedTargets } from "@/lib/digest-settings";

type TargetConfig = {
  key: keyof DigestFeedTargets;
  labels: readonly [string, string];
  name: string;
};

const TARGETS: TargetConfig[] = [
  { key: "geopolitics", labels: ["Geopolityka", "Geopolitics"], name: "feedTargetGeopolitics" },
  { key: "business", labels: ["Biznes", "Business"], name: "feedTargetBusiness" },
  { key: "ai", labels: ["AI", "AI"], name: "feedTargetAi" },
  { key: "software", labels: ["Oprogramowanie", "Software"], name: "feedTargetSoftware" },
  { key: "security", labels: ["Bezpieczeństwo", "Security"], name: "feedTargetSecurity" },
];

export function FeedTargetSliders({ feedTargets }: { feedTargets: DigestFeedTargets }) {
  const l = useLocalize();
  const [values, setValues] = useState(feedTargets);
  const totalCapacity = Object.values(values).reduce((total, value) => total + value, 0);

  function updateTarget(key: keyof DigestFeedTargets, value: string) {
    setValues((current) => ({
      ...current,
      [key]: Number.parseInt(value, 10),
    }));
  }

  return (
    <div className="grid gap-3">
      {TARGETS.map((target) => (
        <label key={target.key} className="grid gap-2 rounded-lg border bg-muted/20 px-3 py-2">
          <span className="flex items-center justify-between gap-3 text-sm font-medium">
            <span>{l(target.labels[0], target.labels[1])}</span>
            <span className="tabular-nums text-muted-foreground">{l("Maks.", "Max.")} {values[target.key]}</span>
          </span>
          <input
            className="h-2 w-full accent-primary"
            type="range"
            name={target.name}
            min={0}
            max={50}
            value={values[target.key]}
            onChange={(event) => updateTarget(target.key, event.currentTarget.value)}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        {l(`Łącznie maksymalnie ${totalCapacity} newsów. Wartość 0 wyłącza kategorię, a wolne miejsca zajmują najwyżej ocenione materiały.`, `Up to ${totalCapacity} stories in total. A value of 0 disables a category, and the highest-rated stories fill any remaining slots.`)}
      </p>
    </div>
  );
}

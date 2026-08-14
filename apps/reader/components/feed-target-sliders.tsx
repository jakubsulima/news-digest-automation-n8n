"use client";

import { useState } from "react";

import type { DigestFeedTargets } from "@/lib/digest-settings";

type TargetConfig = {
  key: keyof DigestFeedTargets;
  label: string;
  name: string;
};

const TARGETS: TargetConfig[] = [
  { key: "geopolitics", label: "Geopolityka", name: "feedTargetGeopolitics" },
  { key: "business", label: "Biznes", name: "feedTargetBusiness" },
  { key: "ai", label: "AI", name: "feedTargetAi" },
  { key: "software", label: "Oprogramowanie", name: "feedTargetSoftware" },
  { key: "security", label: "Bezpieczeństwo", name: "feedTargetSecurity" },
];

export function FeedTargetSliders({ feedTargets }: { feedTargets: DigestFeedTargets }) {
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
            <span>{target.label}</span>
            <span className="tabular-nums text-muted-foreground">Maks. {values[target.key]}</span>
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
        Łącznie maksymalnie {totalCapacity} newsów. Wartość 0 wyłącza kategorię, a wolne miejsca zajmują najwyżej ocenione materiały.
      </p>
    </div>
  );
}

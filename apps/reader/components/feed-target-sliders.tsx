"use client";

import { useState } from "react";

import type { DigestFeedTargets } from "@/lib/digest-settings";

type TargetConfig = {
  key: keyof DigestFeedTargets;
  label: string;
  name: string;
};

const TARGETS: TargetConfig[] = [
  { key: "geopolitics", label: "Geopolitics", name: "feedTargetGeopolitics" },
  { key: "business", label: "Business", name: "feedTargetBusiness" },
  { key: "ai", label: "AI", name: "feedTargetAi" },
  { key: "software", label: "Software", name: "feedTargetSoftware" },
  { key: "security", label: "Security", name: "feedTargetSecurity" },
];

export function FeedTargetSliders({ feedTargets }: { feedTargets: DigestFeedTargets }) {
  const [values, setValues] = useState(feedTargets);

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
            <span className="tabular-nums text-muted-foreground">{values[target.key]}</span>
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
    </div>
  );
}

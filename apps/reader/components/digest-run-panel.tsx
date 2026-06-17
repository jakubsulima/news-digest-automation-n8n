"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, Circle, Loader2, Play, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StageStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type DigestStage = {
  id: string;
  stage_name: string;
  status: StageStatus;
  error_message: string | null;
};

type DigestRun = {
  id: string;
  report_date: string;
  status: RunStatus;
  stages: DigestStage[];
};

type DigestRunPanelProps = {
  initialRun: DigestRun | null;
  retrySlot?: ReactNode;
};

type ApiPayload<T> = Partial<T> & {
  ok: boolean;
  error?: string;
};

const STAGE_COPY: Record<string, { label: string; verb: string }> = {
  source_fetch: { label: "Sources", verb: "Gathering feeds" },
  article_normalization: { label: "Articles", verb: "Cleaning article data" },
  story_clustering: { label: "Stories", verb: "Grouping related stories" },
  enrichment: { label: "Enrichment", verb: "Reading top stories" },
  editorial_scoring: { label: "Scoring", verb: "Ranking the shortlist" },
  reader_publication: { label: "Publish", verb: "Preparing the feed" },
  finalization: { label: "Done", verb: "Finalizing" },
};

function formatRunStatus(status: RunStatus | null) {
  if (!status) {
    return "Ready";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isActiveRun(run: DigestRun | null) {
  return run?.status === "queued" || run?.status === "running";
}

function stageCopy(stageName: string) {
  return STAGE_COPY[stageName] ?? { label: stageName.replaceAll("_", " "), verb: "Working" };
}

async function readApiPayload<T>(response: Response, fallbackError: string): Promise<ApiPayload<T>> {
  const text = await response.text();

  if (!text) {
    return response.ok ? ({ ok: true } as ApiPayload<T>) : ({ ok: false, error: fallbackError } as ApiPayload<T>);
  }

  try {
    return JSON.parse(text) as ApiPayload<T>;
  } catch {
    return {
      ok: false,
      error: response.ok ? fallbackError : `${fallbackError} (${response.status})`,
    } as ApiPayload<T>;
  }
}

export function DigestRunPanel({ initialRun, retrySlot }: DigestRunPanelProps) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [isStarting, setIsStarting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const isAdvancingRef = useRef(false);
  const refreshedTerminalRunRef = useRef<string | null>(null);

  const sortedStages = useMemo(() => run?.stages ?? [], [run]);
  const displayStages = sortedStages.length
    ? sortedStages
    : Object.keys(STAGE_COPY).map((stageName) => ({
        error_message: null,
        id: stageName,
        stage_name: stageName,
        status: "queued" as StageStatus,
      }));
  const completedStageCount = displayStages.filter((stage) => stage.status === "succeeded").length;
  const failedStage = displayStages.find((stage) => stage.status === "failed") ?? null;
  const runningStage = displayStages.find((stage) => stage.status === "running") ?? null;
  const queuedStage = displayStages.find((stage) => stage.status === "queued") ?? null;
  const currentStage = failedStage ?? runningStage ?? queuedStage ?? displayStages.at(-1) ?? null;
  const currentCopy = currentStage ? stageCopy(currentStage.stage_name) : null;
  const active = isActiveRun(run);
  const progress = displayStages.length ? Math.round((completedStageCount / displayStages.length) * 100) : 0;

  const refreshRun = useCallback(async () => {
    const response = await fetch(`/api/digest-runs?ts=${Date.now()}`);
    const payload = await readApiPayload<{ run?: DigestRun | null }>(response, "Could not load digest run.");

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not load digest run.");
    }

    const nextRun = payload.run ?? null;
    const terminalRefreshKey =
      nextRun && (nextRun.status === "succeeded" || nextRun.status === "failed" || nextRun.status === "cancelled")
        ? `${nextRun.id}:${nextRun.status}`
        : null;

    setRun(nextRun);

    if (terminalRefreshKey && refreshedTerminalRunRef.current !== terminalRefreshKey) {
      refreshedTerminalRunRef.current = terminalRefreshKey;
      router.refresh();
    }

    return nextRun;
  }, [router]);

  const advanceRun = useCallback(async () => {
    if (isAdvancingRef.current) {
      return null;
    }

    isAdvancingRef.current = true;

    try {
      const response = await fetch("/api/digest-runs/advance", {
        method: "POST",
      });
      const payload = await readApiPayload<Record<string, never>>(response, "Could not advance digest run.");

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not advance digest run.");
      }

      return refreshRun();
    } finally {
      isAdvancingRef.current = false;
    }
  }, [refreshRun]);

  const startRun = useCallback(async () => {
    setIsStarting(true);
    setClientError(null);

    try {
      const response = await fetch("/api/digest-runs", { method: "POST" });
      const payload = await readApiPayload<{ run?: DigestRun }>(response, "Could not start digest run.");

      if (!response.ok || !payload.ok || !payload.run) {
        throw new Error(payload.error || "Could not start digest run.");
      }

      setRun(payload.run);
      await advanceRun();
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "Could not start digest run.");
    } finally {
      setIsStarting(false);
    }
  }, [advanceRun]);

  useEffect(() => {
    if (!active || clientError || isStarting) {
      return;
    }

    const timer = window.setInterval(() => {
      void advanceRun().catch((error) => {
        setClientError(error instanceof Error ? error.message : "Could not advance digest run.");
      });
    }, 2_000);

    return () => window.clearInterval(timer);
  }, [active, advanceRun, clientError, isStarting]);

  return (
    <section className="overflow-hidden border-y py-4" aria-label="Digest run">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Digest run</h2>
            <Badge variant={run?.status === "failed" ? "destructive" : active ? "secondary" : "outline"}>
              {formatRunStatus(run?.status ?? null)}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {currentCopy ? currentCopy.verb : "Ready for today"}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {`${completedStageCount}/${displayStages.length} stages`}
              </span>
            </div>

            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700"
                style={{ width: `${progress}%` }}
              />
              {active ? (
                <div className="absolute inset-y-0 w-1/3 animate-[digest-scan_1.4s_ease-in-out_infinite] bg-white/35" />
              ) : null}
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {displayStages.map((stage) => {
                const copy = stageCopy(stage.stage_name);
                const isCurrent = currentStage?.id === stage.id;
                const isDone = stage.status === "succeeded";
                const isFailed = stage.status === "failed";

                return (
                  <div
                    key={stage.id}
                    className={cn(
                      "flex min-h-16 flex-col justify-between rounded-lg border bg-card px-2 py-2 transition-colors",
                      isCurrent && active && "border-primary/50 bg-accent",
                      isDone && "border-primary/20",
                      isFailed && "border-destructive/30 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-medium">{copy.label}</span>
                      {isFailed ? (
                        <X className="size-3.5 text-destructive" aria-hidden="true" />
                      ) : isDone ? (
                        <Check className="size-3.5 text-primary" aria-hidden="true" />
                      ) : isCurrent && active ? (
                        <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
                      ) : (
                        <Circle className="size-3 text-muted-foreground/50" aria-hidden="true" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "mt-3 h-1 rounded-full",
                        isFailed ? "bg-destructive/70" : isDone ? "bg-primary" : isCurrent && active ? "bg-primary/50" : "bg-muted",
                      )}
                    />
                  </div>
                );
              })}
            </div>

            {clientError || failedStage?.error_message ? (
              <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {clientError || failedStage?.error_message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:justify-end">
          {run?.status === "failed" ? (
            retrySlot
          ) : active ? (
            <div className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium text-muted-foreground">
              <Sparkles className="size-4 animate-pulse text-primary" aria-hidden="true" />
              Running
            </div>
          ) : (
            <Button type="button" size="lg" onClick={startRun} disabled={isStarting}>
              {isStarting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              Run digest
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

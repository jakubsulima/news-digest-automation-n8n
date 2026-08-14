"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarDays, Check, Circle, Download, Loader2, RotateCcw, Sparkles, X } from "lucide-react";

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
  storyCount?: number;
};

type ApiPayload<T> = Partial<T> & {
  ok: boolean;
  error?: string;
};

const STAGE_COPY: Record<string, { label: string; verb: string }> = {
  source_fetch: { label: "Źródła", verb: "Pobieram źródła" },
  article_normalization: { label: "Artykuły", verb: "Porządkuję artykuły" },
  story_clustering: { label: "Tematy", verb: "Łączę powiązane newsy" },
  enrichment: { label: "Analiza", verb: "Czytam najważniejsze materiały" },
  editorial_scoring: { label: "Ocena", verb: "Układam najważniejsze newsy" },
  reader_publication: { label: "Publikacja", verb: "Przygotowuję Twój feed" },
  finalization: { label: "Gotowe", verb: "Kończę aktualizację" },
};
const ACTIVE_STATUS_REFRESH_MS = 4_000;

function formatRunStatus(status: RunStatus | null) {
  if (status === "queued") return "W kolejce";
  if (status === "running") return "W toku";
  if (status === "succeeded") return "Gotowe";
  if (status === "failed") return "Błąd";
  if (status === "cancelled") return "Anulowano";
  return "Gotowe";
}

function isActiveRun(run: DigestRun | null) {
  return run?.status === "queued" || run?.status === "running";
}

function stageCopy(stageName: string) {
  return STAGE_COPY[stageName] ?? { label: stageName.replaceAll("_", " "), verb: "Pracuję" };
}

function displayRunError(value: string | null | undefined) {
  if (!value) return null;
  if (value.includes("UND_ERR_HEADERS_OVERFLOW") || value.includes("request URL")) {
    return "Nie udało się przetworzyć wszystkich newsów. Ponów etap, aby kontynuować.";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 239).trimEnd()}…` : compact;
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

export function DigestRunPanel({ initialRun, retrySlot, storyCount }: DigestRunPanelProps) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [isStarting, setIsStarting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
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
  const visibleError = displayRunError(clientError || failedStage?.error_message);

  const refreshRun = useCallback(async () => {
    const response = await fetch("/api/digest-runs", { cache: "no-store" });
    const payload = await readApiPayload<{ run?: DigestRun | null }>(response, "Nie udało się odczytać stanu digestu.");

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Nie udało się odczytać stanu digestu.");
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
        cache: "no-store",
        method: "POST",
      });
      const payload = await readApiPayload<Record<string, never>>(response, "Nie udało się kontynuować pobierania.");

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Nie udało się kontynuować pobierania.");
      }

      setClientError(null);
      return null;
    } finally {
      isAdvancingRef.current = false;
    }
  }, []);

  const startRun = useCallback(async () => {
    setIsStarting(true);
    setClientError(null);

    try {
      const response = await fetch("/api/digest-runs", { method: "POST" });
      const payload = await readApiPayload<{ run?: DigestRun }>(response, "Nie udało się rozpocząć pobierania.");

      if (!response.ok || !payload.ok || !payload.run) {
        throw new Error(payload.error || "Nie udało się rozpocząć pobierania.");
      }

      setRun(payload.run);
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "Nie udało się rozpocząć pobierania.");
    } finally {
      setIsStarting(false);
    }
  }, []);

  const resetRun = useCallback(async () => {
    setIsResetting(true);
    setClientError(null);

    try {
      const response = await fetch("/api/digest-runs/reset", { method: "POST" });
      const payload = await readApiPayload<{ run?: DigestRun | null }>(response, "Nie udało się anulować pobierania.");

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Nie udało się anulować pobierania.");
      }

      setRun(payload.run ?? null);
      router.refresh();
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "Nie udało się anulować pobierania.");
    } finally {
      setIsResetting(false);
    }
  }, [router]);

  useEffect(() => {
    if (!active || isStarting || isResetting) {
      return;
    }

    const tabIsVisible = () => document.visibilityState === "visible";

    const refreshIfVisible = () => {
      if (!tabIsVisible()) {
        return;
      }

      void refreshRun().catch((error) => {
        setClientError(error instanceof Error ? error.message : "Nie udało się odczytać stanu digestu.");
      });
    };

    const resumeIfVisible = () => {
      if (!tabIsVisible()) {
        return;
      }

      refreshIfVisible();
      void advanceRun().catch((error) => {
        setClientError(error instanceof Error ? error.message : "Nie udało się kontynuować pobierania.");
      });
    };

    resumeIfVisible();

    const refreshTimer = window.setInterval(refreshIfVisible, ACTIVE_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", resumeIfVisible);

    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", resumeIfVisible);
    };
  }, [active, advanceRun, isResetting, isStarting, refreshRun]);

  if (!active && run?.status !== "failed") {
    const digestReady = run?.status === "succeeded";

    return (
      <section
        className="-mx-4 grid min-h-17 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-y bg-background px-4 py-3 md:mx-0 md:min-h-0 md:rounded-xl md:border md:bg-card/75 md:shadow-sm"
        aria-label="Digest run"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <p className="min-w-0 truncate text-sm text-foreground sm:text-base">
            <span className="font-medium">{storyCount ?? 0} newsów</span>
            <span className="mx-2 text-muted-foreground" aria-hidden="true">·</span>
            <span className="text-muted-foreground">{digestReady ? "aktualny" : "gotowy"}</span>
          </p>
        </div>
        <Button type="button" size="lg" className="h-10 px-3.5" onClick={startRun} disabled={isStarting}>
          {isStarting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          Pobierz newsy
        </Button>
        {clientError ? <p className="w-full text-sm text-destructive">{clientError}</p> : null}
      </section>
    );
  }

  return (
    <section
      className="-mx-4 overflow-hidden border-y bg-card p-3 md:mx-0 md:rounded-2xl md:border md:p-5 md:shadow-sm"
      aria-label="Digest run"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start md:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Aktualizacja digestu</h2>
            <Badge className="hidden sm:inline-flex" variant={run?.status === "failed" ? "destructive" : active ? "secondary" : "outline"}>
              {formatRunStatus(run?.status ?? null)}
            </Badge>
            {run ? (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                {run.report_date}
              </span>
            ) : null}
          </div>

          <div className="mt-2 grid gap-2.5 md:mt-3 md:gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {currentCopy ? currentCopy.verb : "Gotowe na dziś"}
              </p>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {`${progress}% · ${completedStageCount}/${displayStages.length} etapów`}
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

            <div className="hidden flex-wrap gap-1.5 sm:flex">
              {displayStages.map((stage) => {
                const copy = stageCopy(stage.stage_name);
                const isCurrent = currentStage?.id === stage.id;
                const isDone = stage.status === "succeeded";
                const isFailed = stage.status === "failed";

                return (
                  <div
                    key={stage.id}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background/70 px-2.5 transition-colors",
                      isCurrent && active && "border-primary/50 bg-accent",
                      isDone && "border-primary/20",
                      isFailed && "border-destructive/30 bg-destructive/5",
                    )}
                  >
                    {isFailed ? (
                      <X className="size-3.5 text-destructive" aria-hidden="true" />
                    ) : isDone ? (
                      <Check className="size-3.5 text-primary" aria-hidden="true" />
                    ) : isCurrent && active ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
                    ) : (
                      <Circle className="size-3 text-muted-foreground/50" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium">{copy.label}</span>
                  </div>
                );
              })}
            </div>

            {visibleError ? (
              <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {visibleError}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {run?.status === "failed" ? (
            <>
              {retrySlot}
              <Button type="button" size="lg" variant="outline" onClick={resetRun} disabled={isResetting}>
                {isResetting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                Wyczyść błąd
              </Button>
            </>
          ) : active ? (
            <>
              <div className="hidden h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium text-muted-foreground sm:inline-flex">
                <Sparkles className="size-4 animate-pulse text-primary" aria-hidden="true" />
                Pobieranie
              </div>
              <Button type="button" size="sm" variant="outline" onClick={resetRun} disabled={isResetting}>
                {isResetting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                Anuluj pobieranie
              </Button>
            </>
          ) : (
            <Button type="button" size="lg" onClick={startRun} disabled={isStarting}>
              {isStarting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              Pobierz newsy
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

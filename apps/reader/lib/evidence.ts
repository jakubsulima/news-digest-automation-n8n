import type { Json } from "./database.types";

export const EVIDENCE_STATUSES = ["full_text", "corroborated_summary", "limited"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type EvidenceDetails = {
  fullTextSourceCount: number;
  independentSourceCount: number;
  sourceNames: string[];
  status: EvidenceStatus;
};

export const DEFAULT_EVIDENCE_DETAILS: EvidenceDetails = {
  fullTextSourceCount: 0,
  independentSourceCount: 1,
  sourceNames: [],
  status: "limited",
};

type EvidenceSignals = {
  contentModes?: string[];
  explicitStatus?: unknown;
  fullTextSourceCount?: number;
  hasReadableVariant?: boolean;
  sourceCount: number;
  sourceNames?: string[];
};

function boundedCount(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function evidenceDetailsFromSignals({
  contentModes = [],
  explicitStatus,
  fullTextSourceCount,
  hasReadableVariant = false,
  sourceCount,
  sourceNames = [],
}: EvidenceSignals): EvidenceDetails {
  const independentSourceCount = Math.max(1, boundedCount(sourceCount, 1));
  const readableCount = Math.max(
    boundedCount(fullTextSourceCount),
    contentModes.filter((mode) => mode === "readable").length,
    hasReadableVariant ? 1 : 0,
  );
  const status = EVIDENCE_STATUSES.includes(explicitStatus as EvidenceStatus)
    ? explicitStatus as EvidenceStatus
    : readableCount > 0
      ? "full_text"
      : independentSourceCount >= 2
        ? "corroborated_summary"
        : "limited";

  return {
    fullTextSourceCount: readableCount,
    independentSourceCount,
    sourceNames: Array.from(new Set(sourceNames.filter(Boolean))).slice(0, 8),
    status,
  };
}

export function evidenceDetailsFromPayload(
  payload: Json,
  sourceCount: number,
  sourceNames: string[] = [],
): EvidenceDetails {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, Json | undefined>
    : {};
  const evidence = record.evidence && typeof record.evidence === "object" && !Array.isArray(record.evidence)
    ? record.evidence as Record<string, Json | undefined>
    : {};
  const contentModes = Array.isArray(record.contentModes)
    ? record.contentModes.filter((value): value is string => typeof value === "string")
    : [];
  const payloadSourceNames = Array.isArray(evidence.sourceNames)
    ? evidence.sourceNames.filter((value): value is string => typeof value === "string")
    : sourceNames;

  return evidenceDetailsFromSignals({
    contentModes,
    explicitStatus: evidence.status,
    fullTextSourceCount: typeof evidence.fullTextSourceCount === "number" ? evidence.fullTextSourceCount : undefined,
    hasReadableVariant: record.hasReadableVariant === true,
    sourceCount,
    sourceNames: payloadSourceNames,
  });
}

export function evidenceStatusLabel(status: EvidenceStatus): readonly [string, string] {
  if (status === "full_text") return ["Pełna treść", "Full text"];
  if (status === "corroborated_summary") return ["Potwierdzone przez źródła", "Corroborated sources"];
  return ["Ograniczony materiał", "Limited material"];
}

export function evidenceStatusDescription(status: EvidenceStatus): readonly [string, string] {
  if (status === "full_text") return [
    "Dostępna jest pełna treść co najmniej jednego źródła.",
    "The full text of at least one source is available.",
  ];
  if (status === "corroborated_summary") return [
    "Brak pełnej treści, ale wydarzenie opisują co najmniej dwa niezależne źródła.",
    "The full text is unavailable, but at least two independent sources describe the event.",
  ];
  return [
    "Dostępny jest tylko pojedynczy lub niepełny materiał; wnioski AI są wyłączone.",
    "Only one or incomplete source is available; AI conclusions are disabled.",
  ];
}

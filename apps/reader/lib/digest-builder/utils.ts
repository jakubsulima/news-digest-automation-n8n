import type { Json } from "../database.types";

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    if (parts.length) {
      return parts.join(" ");
    }

    try {
      return JSON.stringify(record);
    } catch {
      return "Stage failed with a non-serializable error.";
    }
  }

  return typeof error === "string" && error.trim() ? error : "Stage failed.";
}

export function throwDatabaseError(context: string, error: unknown): never {
  throw new Error(`${context}: ${errorMessage(error)}`);
}

export function compactText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();

  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1).trim()}...` : compacted;
}

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function jsonString(value: Json, key: string) {
  const item = jsonObject(value)[key];

  return typeof item === "string" ? item.trim() : "";
}

export function jsonStringArray(value: Json, key?: string) {
  const item = key ? jsonObject(value)[key] : value;

  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
}

export function jsonNumber(value: Json, key: string) {
  const item = jsonObject(value)[key];

  return typeof item === "number" && Number.isFinite(item) ? item : 0;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function chunkByEncodedLength(items: string[], maxCount: number, maxEncodedLength: number) {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentEncodedLength = 0;

  for (const item of items) {
    const itemEncodedLength = encodeURIComponent(item).length;
    const nextEncodedLength = currentEncodedLength + itemEncodedLength + (currentChunk.length ? 1 : 0);

    if (currentChunk.length && (currentChunk.length >= maxCount || nextEncodedLength > maxEncodedLength)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentEncodedLength = 0;
    }

    currentChunk.push(item);
    currentEncodedLength += itemEncodedLength + (currentChunk.length > 1 ? 1 : 0);
  }

  if (currentChunk.length) {
    chunks.push(currentChunk);
  }

  return chunks;
}

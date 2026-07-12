import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { recordFeedEvents, type FeedEventInput } from "@/lib/feed-events";

const EVENT_TYPES = new Set(["impression", "fast_read", "source_open", "read", "save", "archive", "feedback"]);
const SORT_MODES = new Set(["for-you", "top", "latest"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validEvent(value: unknown): value is FeedEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventType === "string" &&
    EVENT_TYPES.has(event.eventType) &&
    typeof event.sessionId === "string" &&
    UUID_PATTERN.test(event.sessionId) &&
    (event.sortMode === undefined || event.sortMode === null || (typeof event.sortMode === "string" && SORT_MODES.has(event.sortMode))) &&
    (event.rank === undefined || event.rank === null || (typeof event.rank === "number" && Number.isInteger(event.rank) && event.rank >= 0))
  );
}

export async function POST(request: Request) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = (await request.json()) as { events?: unknown };
    if (!Array.isArray(payload.events) || payload.events.length > 100 || !payload.events.every(validEvent)) {
      return NextResponse.json({ error: "Invalid feed event batch." }, { status: 400 });
    }
    await recordFeedEvents(user.id, payload.events);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record feed events." },
      { status: 500 },
    );
  }
}

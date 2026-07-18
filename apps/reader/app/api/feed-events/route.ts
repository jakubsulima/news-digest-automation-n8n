import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { parseFeedEventBatch, recordFeedEvents } from "@/lib/feed-events";

export async function POST(request: Request) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = (await request.json()) as { events?: unknown };
    const events = parseFeedEventBatch(payload.events);
    if (!events) {
      return NextResponse.json({ error: "Invalid feed event batch." }, { status: 400 });
    }
    await recordFeedEvents(user.id, events);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record feed events." },
      { status: 500 },
    );
  }
}

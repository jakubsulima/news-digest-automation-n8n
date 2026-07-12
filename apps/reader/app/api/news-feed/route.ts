import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { normalizeReaderFeedId } from "@/lib/feed-categories";
import { decodeFeedCursor, getReaderFeedPage } from "@/lib/reader-feed";
import { normalizeFeedPeriod, normalizeFeedSort } from "@/lib/reader-feed-ranking";
import { normalizeReaderViewId } from "@/lib/reader-feed-filters";

export async function GET(request: Request) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsedLimit = Number(params.get("limit"));
  const since = params.get("since");
  const previousVisitAt = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : undefined;
  const cursor = params.get("cursor");

  if (cursor && !decodeFeedCursor(cursor)) {
    return NextResponse.json({ error: "Invalid feed cursor." }, { status: 400 });
  }

  try {
    const page = await getReaderFeedPage(user.id, {
      cursor,
      feed: normalizeReaderFeedId(params.get("feed") || undefined),
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      period: normalizeFeedPeriod(params.get("period")),
      previousVisitAt,
      sort: normalizeFeedSort(params.get("sort")),
      view: normalizeReaderViewId(params.get("view") || undefined),
    });
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the news feed." },
      { status: 500 },
    );
  }
}

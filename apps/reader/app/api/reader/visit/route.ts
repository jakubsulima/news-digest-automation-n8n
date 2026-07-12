import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { recordReaderVisit } from "@/lib/reader-profile";

export async function POST() {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const visitedAt = await recordReaderVisit(user.id);
    return NextResponse.json({ ok: true, visitedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record the reader visit." },
      { status: 500 },
    );
  }
}

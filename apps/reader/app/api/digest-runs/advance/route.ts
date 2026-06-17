import { NextResponse } from "next/server";

import { advanceDigestRun } from "@/lib/digest-stage-executor";
import { getActiveDigestRun } from "@/lib/digest-runs";

export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const run = await getActiveDigestRun();

  if (!run) {
    return NextResponse.json({
      ok: true,
      result: {
        advancedStage: null,
        message: "No active digest run.",
        status: "idle",
      },
    });
  }

  const result = await advanceDigestRun(run.id);

  return NextResponse.json({ ok: true, result });
}

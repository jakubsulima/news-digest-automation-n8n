import { NextResponse } from "next/server";

import { advanceDigestRun } from "@/lib/digest-stage-executor";
import { getActiveDigestRun } from "@/lib/digest-runs";
import { getCurrentOperator } from "@/lib/operator";

export const maxDuration = 60;

async function advanceActiveRun() {
  const run = await getActiveDigestRun();

  if (!run) {
    return {
      advancedStage: null,
      message: "No active digest run.",
      status: "idle",
    };
  }

  return advanceDigestRun(run.id);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await advanceActiveRun();

  return NextResponse.json({ ok: true, result });
}

export async function POST() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await advanceActiveRun();

  return NextResponse.json({ ok: true, result });
}

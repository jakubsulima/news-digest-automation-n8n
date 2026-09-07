import { after, NextResponse } from "next/server";

import { scheduleDigestRunContinuation } from "@/lib/digest-run-continuation";
import { advanceDigestRunUntilIdle } from "@/lib/digest-stage-executor";
import { getDigestRunStatus, startOrGetActiveDigestRun } from "@/lib/digest-runs";
import { getCurrentOperator } from "@/lib/operator";

export const maxDuration = 120;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not advance digest run.";
}

function logBackgroundAdvanceError(error: unknown) {
  console.error("Background digest advance failed", {
    error: errorMessage(error),
  });
}

export async function GET() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const run = await getDigestRunStatus();

  return NextResponse.json({ ok: true, run });
}

export async function POST(request: Request) {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const run = await startOrGetActiveDigestRun(user.id);

  after(async () => {
    try {
      await advanceDigestRunUntilIdle(run.id, {
        scheduleContinuation: () => scheduleDigestRunContinuation(request.url),
      });
    } catch (error) {
      logBackgroundAdvanceError(error);
    }
  });

  return NextResponse.json({ ok: true, run });
}

import { after, NextResponse } from "next/server";

import { advanceDigestRun } from "@/lib/digest-stage-executor";
import { getActiveDigestRun } from "@/lib/digest-runs";
import { getCurrentOperator } from "@/lib/operator";

export const maxDuration = 60;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not advance digest run.";
}

function logBackgroundAdvanceError(error: unknown) {
  console.error("Background digest advance failed", {
    error: errorMessage(error),
  });
}

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

  try {
    const result = await advanceActiveRun();

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      await advanceActiveRun();
    } catch (error) {
      logBackgroundAdvanceError(error);
    }
  });

  return NextResponse.json(
    {
      ok: true,
      result: {
        advancedStage: null,
        message: "Digest run advancement scheduled.",
        status: "scheduled",
      },
    },
    { status: 202 },
  );
}

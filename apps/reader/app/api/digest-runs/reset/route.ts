import { NextResponse } from "next/server";

import { resetDigestRun } from "@/lib/digest-runs";
import { getCurrentOperator } from "@/lib/operator";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not reset digest run.";
}

export async function POST() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const run = await resetDigestRun();

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

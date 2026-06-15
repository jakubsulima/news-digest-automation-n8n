import { NextResponse } from "next/server";

import { getDigestRunStatus, startOrGetActiveDigestRun } from "@/lib/digest-runs";
import { getCurrentOperator } from "@/lib/operator";

export async function GET() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const run = await getDigestRunStatus();

  return NextResponse.json({ ok: true, run });
}

export async function POST() {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const run = await startOrGetActiveDigestRun(user.id);

  return NextResponse.json({ ok: true, run });
}

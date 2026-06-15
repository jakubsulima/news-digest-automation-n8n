import { NextResponse } from "next/server";

import { advanceDigestRun } from "@/lib/digest-stage-executor";
import { getCurrentOperator } from "@/lib/operator";

export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentOperator();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await advanceDigestRun(id);

  return NextResponse.json({ ok: true, result });
}

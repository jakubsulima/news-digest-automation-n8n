import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { parseFeedbackSentiment, setReaderItemFeedback } from "@/lib/reader-feedback";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update item feedback.";
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentReader();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const payload = (await request.json()) as { sentiment?: unknown };
    const sentiment = parseFeedbackSentiment(payload.sentiment);

    if (sentiment === undefined) {
      return NextResponse.json({ ok: false, error: "Invalid item feedback." }, { status: 400 });
    }

    await setReaderItemFeedback(user.id, id, sentiment);
    revalidatePath("/");
    revalidatePath(`/news/${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

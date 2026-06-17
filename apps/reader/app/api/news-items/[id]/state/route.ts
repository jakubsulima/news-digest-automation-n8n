import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { setReaderItemState, type ReaderItemStateField } from "@/lib/reader-item-states";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const FIELD_BY_ACTION: Record<string, ReaderItemStateField> = {
  archived: "archived_at",
  read: "read_at",
  saved: "saved_at",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update item state.";
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentReader();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const payload = (await request.json()) as { action?: unknown; enabled?: unknown };
    const field = typeof payload.action === "string" ? FIELD_BY_ACTION[payload.action] : null;

    if (!field || typeof payload.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "Invalid item state update." }, { status: 400 });
    }

    await setReaderItemState(user.id, id, field, payload.enabled);
    revalidatePath("/");
    revalidatePath(`/news/${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

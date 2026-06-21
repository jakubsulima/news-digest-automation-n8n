import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { setReaderItemsRead } from "@/lib/reader-item-states";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update item states.";
}

export async function PATCH(request: Request) {
  const user = await getCurrentReader();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { action?: unknown; enabled?: unknown; itemIds?: unknown };

    if (
      payload.action !== "read" ||
      typeof payload.enabled !== "boolean" ||
      !Array.isArray(payload.itemIds) ||
      !payload.itemIds.every((itemId) => typeof itemId === "string")
    ) {
      return NextResponse.json({ ok: false, error: "Invalid batch state update." }, { status: 400 });
    }

    await setReaderItemsRead(user.id, payload.itemIds, payload.enabled);
    revalidatePath("/");

    for (const itemId of payload.itemIds.slice(0, 100)) {
      revalidatePath(`/news/${itemId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { deleteReaderNote, isUuid, parseUpdateReaderNoteInput, updateReaderNote } from "@/lib/reader-notes";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not update reader note.";
  return NextResponse.json({ error: message }, { status: message === "Reader note not found." ? 404 : 500 });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid reader note id." }, { status: 400 });
  const input = parseUpdateReaderNoteInput(await request.json());
  if (!input) return NextResponse.json({ error: "Invalid reader note update." }, { status: 400 });

  try {
    const note = await updateReaderNote(user.id, id, input);
    revalidatePath("/notebook");
    if (note.newsItemId) revalidatePath(`/news/${note.newsItemId}`);
    return NextResponse.json({ note });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid reader note id." }, { status: 400 });

  try {
    await deleteReaderNote(user.id, id);
    revalidatePath("/");
    revalidatePath("/notebook");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

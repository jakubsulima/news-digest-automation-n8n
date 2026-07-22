import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getCurrentReader } from "@/lib/auth";
import { createReaderNote, parseCreateReaderNoteInput } from "@/lib/reader-notes";

export async function POST(request: Request) {
  const user = await getCurrentReader();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = parseCreateReaderNoteInput(await request.json());
    if (!input) return NextResponse.json({ error: "Invalid reader note." }, { status: 400 });
    const note = await createReaderNote(user.id, input);
    revalidatePath("/");
    revalidatePath("/notebook");
    revalidatePath(`/news/${input.newsItemId}`);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create reader note.";
    const status = message === "News item not found." ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}


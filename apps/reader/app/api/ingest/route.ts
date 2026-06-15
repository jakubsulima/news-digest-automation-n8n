import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireEnv } from "@/lib/env";
import { normalizeIngestPayload } from "@/lib/ingest-schema";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const expectedToken = requireEnv("INGEST_SECRET");
  const authorization = request.headers.get("authorization") || "";

  if (authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let items;
  let body: unknown;

  try {
    body = await request.json();
    items = normalizeIngestPayload(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload", details: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const rows = items.map((item) => ({
    external_id: item.externalId,
    digest_date: item.digestDate,
    title: item.title,
    summary: item.summary,
    source: item.source,
    source_url: item.sourceUrl,
    category: item.category,
    importance_score: item.importanceScore ?? null,
    published_at: item.publishedAt ?? null,
    raw_payload: item,
  }));

  const { error } = await supabase.from("news_items").upsert(rows, {
    onConflict: "external_id",
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}

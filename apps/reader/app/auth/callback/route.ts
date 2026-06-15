import { NextResponse } from "next/server";

import { getAppUrl, isAllowedReaderEmail } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = getAppUrl();
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", appUrl));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth-failed", appUrl));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedReaderEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not-allowed", appUrl));
  }

  return NextResponse.redirect(new URL("/", appUrl));
}

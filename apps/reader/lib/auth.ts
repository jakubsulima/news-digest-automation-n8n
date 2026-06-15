import "server-only";

import { redirect } from "next/navigation";

import { hasReaderRuntimeConfig, isAllowedReaderEmail } from "./env";
import { createSupabaseServerClient } from "./supabase";

export async function getCurrentReader() {
  if (!hasReaderRuntimeConfig()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedReaderEmail(user.email)) {
    return null;
  }

  return user;
}

export async function requireCurrentReader() {
  const user = await getCurrentReader();
  if (!user) {
    redirect(hasReaderRuntimeConfig() ? "/login" : "/login?error=server-config");
  }
  return user;
}

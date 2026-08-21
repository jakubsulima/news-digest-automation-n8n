import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { requireEnv } from "./env";

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchSupabaseWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  const timeout = setTimeout(
    () => controller.abort(new Error("Supabase request timed out.")),
    timeoutMs,
  );

  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

const timedSupabaseFetch: typeof fetch = (input, init) => fetchSupabaseWithTimeout(input, init);

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies; middleware refreshes sessions.
          }
        },
      },
    },
  );
}

export function createSupabaseAdminClient() {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: timedSupabaseFetch,
      },
    },
  );
}

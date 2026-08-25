import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { requireEnv } from "./env";

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
const SUPABASE_JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [1_000, 2_000] as const;

type SupabaseErrorPayload = {
  code?: unknown;
  message?: unknown;
};

function cloneFetchInput(input: Parameters<typeof fetch>[0]) {
  return input instanceof Request ? input.clone() : input;
}

async function isJwtIssuedInFuture(response: Response) {
  if (response.status !== 401) return false;

  try {
    const payload = await response.clone().json() as SupabaseErrorPayload;
    return payload.code === "PGRST303" && payload.message === "JWT issued at future";
  } catch {
    return false;
  }
}

function requestPath(input: Parameters<typeof fetch>[0]) {
  try {
    const rawUrl = input instanceof Request ? input.url : String(input);
    return new URL(rawUrl).pathname;
  } catch {
    return "unknown";
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || new Error("Supabase request aborted."));
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(signal?.reason || new Error("Supabase request aborted."));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

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
    return await fetchImpl(cloneFetchInput(input), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export async function fetchSupabaseWithClockSkewRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  retryDelaysMs: readonly number[] = SUPABASE_JWT_CLOCK_SKEW_RETRY_DELAYS_MS,
  timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
) {
  let response = await fetchSupabaseWithTimeout(input, init, timeoutMs, fetchImpl);

  for (const [attempt, delayMs] of retryDelaysMs.entries()) {
    if (!(await isJwtIssuedInFuture(response))) return response;

    console.warn(JSON.stringify({
      level: "warning",
      message: "Retrying Supabase request after JWT clock skew rejection",
      attempt: attempt + 1,
      delayMs,
      path: requestPath(input),
      supabaseCode: "PGRST303",
    }));

    await waitForRetry(delayMs, init?.signal);
    response = await fetchSupabaseWithTimeout(input, init, timeoutMs, fetchImpl);
  }

  if (await isJwtIssuedInFuture(response)) {
    console.error(JSON.stringify({
      level: "error",
      message: "Supabase JWT clock skew retries exhausted",
      attempts: retryDelaysMs.length + 1,
      path: requestPath(input),
      supabaseCode: "PGRST303",
    }));
  }

  return response;
}

const resilientSupabaseFetch: typeof fetch = (input, init) => fetchSupabaseWithClockSkewRetry(input, init);

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: {
        fetch: resilientSupabaseFetch,
      },
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
        fetch: resilientSupabaseFetch,
      },
    },
  );
}

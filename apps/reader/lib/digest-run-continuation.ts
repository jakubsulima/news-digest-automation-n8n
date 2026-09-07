import "server-only";

import { requireEnv } from "./env";

export async function scheduleDigestRunContinuation(requestUrl: string) {
  const continuationUrl = new URL("/api/digest-runs/advance", requestUrl);
  const response = await fetch(continuationUrl, {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${requireEnv("CRON_SECRET")}`,
    },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Could not schedule digest continuation (${response.status}).`);
  }
}

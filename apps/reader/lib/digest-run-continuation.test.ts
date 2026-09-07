import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleDigestRunContinuation } from "./digest-run-continuation";

describe("scheduleDigestRunContinuation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("starts an authenticated invocation on the same deployment", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await scheduleDigestRunContinuation("https://digest.example.com/api/digest-runs");

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://digest.example.com/api/digest-runs/advance"),
      expect.objectContaining({
        headers: { authorization: "Bearer test-cron-secret" },
        method: "GET",
      }),
    );
  });
});

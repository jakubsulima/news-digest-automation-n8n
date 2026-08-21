import { describe, expect, it, vi } from "vitest";

import { fetchSupabaseWithTimeout } from "./supabase";

describe("fetchSupabaseWithTimeout", () => {
  it("aborts a Supabase request that exceeds its deadline", async () => {
    const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason || new Error("aborted")),
        { once: true },
      );
    })) as unknown as typeof fetch;

    await expect(
      fetchSupabaseWithTimeout("https://example.supabase.co/rest/v1/digest_runs", undefined, 5, fetchImpl),
    ).rejects.toThrow("Supabase request timed out.");
  });
});

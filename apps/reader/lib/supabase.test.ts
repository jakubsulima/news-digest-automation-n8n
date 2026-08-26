import { describe, expect, it, vi } from "vitest";

import { fetchSupabaseWithClockSkewRetry, fetchSupabaseWithTimeout } from "./supabase";

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

describe("fetchSupabaseWithClockSkewRetry", () => {
  it("retries the narrow PostgREST JWT clock skew failure", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(
        { code: "PGRST303", message: "JWT issued at future" },
        { status: 401 },
      ))
      .mockResolvedValueOnce(Response.json({ data: "ok" }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await fetchSupabaseWithClockSkewRetry(
      "https://example.supabase.co/rest/v1/news_items?select=*",
      undefined,
      [0],
      100,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ data: "ok" });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("PGRST303"));
    warning.mockRestore();
  });

  it("does not retry unrelated authentication failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(
      { code: "PGRST301", message: "JWT expired" },
      { status: 401 },
    ));

    const response = await fetchSupabaseWithClockSkewRetry(
      "https://example.supabase.co/rest/v1/news_items",
      undefined,
      [0, 0],
      100,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });

  it("returns the final clock skew response after the retry budget is exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(
      { code: "PGRST303", message: "JWT issued at future" },
      { status: 401 },
    ));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await fetchSupabaseWithClockSkewRetry(
      "https://example.supabase.co/rest/v1/news_items",
      undefined,
      [0, 0],
      100,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(401);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("retries exhausted"));
    warning.mockRestore();
    error.mockRestore();
  });
});

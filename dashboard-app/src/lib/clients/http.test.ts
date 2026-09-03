import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { UpstreamError } from "@/lib/contracts";
import { HttpError, backoffDelay, httpRequest, parseRetryAfter, requestJson, withRetry } from "./http";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("httpRequest", () => {
  it("returns the response on 2xx", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    const res = await httpRequest("wallet", "https://x/y");
    expect(res.status).toBe(200);
  });

  it("throws a non-retryable HttpError with the raw payload on 4xx", async () => {
    fetchMock.mockResolvedValue(json({ message: "Invalid field name" }, 400));
    const err = await httpRequest("wallet", "https://x/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.status).toBe(400);
    expect(httpErr.retryable).toBe(false);
    expect(httpErr.detail).toEqual({ message: "Invalid field name" });
  });

  it.each([409, 429, 500, 503])("marks %i retryable", async (status) => {
    fetchMock.mockResolvedValue(json({}, status));
    const err = (await httpRequest("wallet", "https://x/y").catch((e: unknown) => e)) as HttpError;
    expect(err.retryable).toBe(true);
  });

  it("parses Retry-After seconds", async () => {
    fetchMock.mockResolvedValue(json({}, 429, { "retry-after": "7" }));
    const err = (await httpRequest("wallet", "https://x/y").catch((e: unknown) => e)) as HttpError;
    expect(err.retryAfterMs).toBe(7000);
  });

  it("treats a network error as retryable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = (await httpRequest("wallet", "https://x/y").catch((e: unknown) => e)) as HttpError;
    expect(err.retryable).toBe(true);
    expect(err.status).toBeNull();
  });

  it("aborts and reports a timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const err = (await httpRequest("wallet", "https://x/y", { timeoutMs: 5 }).catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err.message).toContain("timed out");
    expect(err.retryable).toBe(true);
  });
});

describe("requestJson", () => {
  it("fails loudly and non-retryably on a schema mismatch, keeping the payload", async () => {
    fetchMock.mockResolvedValue(json({ accounts: "nope" }));
    const schema = z.object({ accounts: z.array(z.string()) });
    const err = (await requestJson("wallet", "https://x/y", schema).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
    expect(err.detail).toEqual({ accounts: "nope" });
  });
});

describe("withRetry", () => {
  it("walks 2→32 s and gives up after 5 attempts", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn().mockRejectedValue(new HttpError("wallet", "boom", 500, null, true));
    await expect(withRetry(fn, { sleep, jitter: () => 0 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([2000, 4000, 8000, 16000]);
  });

  it("adds jitter on top of the exponential base", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn().mockRejectedValue(new HttpError("wallet", "boom", 500, null, true));
    await expect(withRetry(fn, { sleep, jitter: () => 1, attempts: 2 })).rejects.toThrow("boom");
    expect(delays).toEqual([2500]);
  });

  it("caps the exponential at maxMs", () => {
    expect(backoffDelay(6, 2000, 32_000, 0)).toBe(32_000);
  });

  it("fails fast on a non-retryable error", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn().mockRejectedValue(new HttpError("wallet", "bad field", 400, null, false));
    await expect(withRetry(fn, { sleep, jitter: () => 0 })).rejects.toThrow("bad field");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("honours Retry-After over the computed backoff", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("wallet", "slow down", 429, null, true, 12_000))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { sleep, jitter: () => 0 })).resolves.toBe("ok");
    expect(delays).toEqual([12_000]);
  });

  it("applies a caller-supplied floor", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("wallet", "init_sync", 409, null, true))
      .mockResolvedValue("ok");
    await withRetry(fn, { sleep, jitter: () => 0, minDelayFor: () => 30_000 });
    expect(delays).toEqual([30_000]);
  });

  it("returns the first success without sleeping", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withRetry(fn, { sleep })).resolves.toBe(42);
    expect(delays).toEqual([]);
  });
});

describe("parseRetryAfter", () => {
  it("handles an HTTP date", () => {
    const now = Date.parse("2026-08-31T10:00:00Z");
    expect(parseRetryAfter("Mon, 31 Aug 2026 10:00:30 GMT", now)).toBe(30_000);
  });

  it("returns null for junk", () => {
    expect(parseRetryAfter("later")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

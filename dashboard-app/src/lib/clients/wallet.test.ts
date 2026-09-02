import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpstreamError } from "@/lib/contracts";
import { getAccounts, getBalances, reduceBalances } from "./wallet";

const tokenFile = join(mkdtempSync(join(tmpdir(), "wallet-token-")), "token");
writeFileSync(tokenFile, "jwt-token\n");

process.env.DATABASE_URL = "postgres://dashboard@localhost/dashboard";
process.env.AUTH_URL = "https://dash.example.test";
process.env.AUTH_SECRET = "a".repeat(40);
process.env.OIDC_ISSUER = "https://auth.example.test/application/o/dashboard/";
process.env.OIDC_CLIENT_ID = "client";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.AUTHORIZED_SUB = "sub-123";
process.env.TEABLE_URL = "https://teable.example.test";
process.env.TEABLE_TOKEN = "teable-token";
process.env.PAPERLESS_URL = "https://paperless.example.test";
process.env.PAPERLESS_TOKEN = "paperless-token";
process.env.CRON_SECRET = "c".repeat(20);
process.env.WEBHOOK_SECRET = "w".repeat(20);
process.env.WALLET_API_URL = "https://wallet.example.test/wallet/v1/api";
process.env.WALLET_TOKEN_FILE = tokenFile;

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function account(name: string, currentBalance: number, currencyCode = "EUR") {
  return { id: `acc-${name}`, name, currencyCode, archived: false, balance: { currentBalance } };
}

const ALL_ACCOUNTS = [
  account("ING - Salary", 1000),
  account("Revolut", 200),
  account("Savings", 50.5),
  account("Holidays", 25.25),
  account("Cash", 10),
];

function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getBalances", () => {
  it("sums Revolut + Savings + Holidays and reads ING straight through", async () => {
    fetchMock.mockImplementation(async () => json({ accounts: ALL_ACCOUNTS }));

    const balances = await getBalances();

    expect(balances.ing).toBe(1000);
    expect(balances.revolut).toBeCloseTo(275.75, 2);
    expect(balances.breakdown).toEqual({
      ing: 1000,
      revolut_main: 200,
      revolut_savings: 50.5,
      revolut_holidays: 25.25,
    });
  });

  it("re-reads the token file on every request", async () => {
    fetchMock.mockImplementation(async () => json({ accounts: ALL_ACCOUNTS }));
    await getBalances();
    writeFileSync(tokenFile, "rotated-token\n");
    await getBalances();

    const first = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(first.authorization).toBe("Bearer jwt-token");
    expect(second.authorization).toBe("Bearer rotated-token");
    writeFileSync(tokenFile, "jwt-token\n");
  });

  it("throws rather than returning a partial when an account is missing", () => {
    const partial = ALL_ACCOUNTS.filter((a) => a.name !== "Holidays");
    const err = (() => {
      try {
        reduceBalances(partial);
        return null;
      } catch (e) {
        return e as UpstreamError;
      }
    })();
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err?.message).toContain("Holidays");
    expect(err?.retryable).toBe(false);
  });

  it("rejects an account that changed currency", () => {
    const drifted = [...ALL_ACCOUNTS.slice(1), account("ING - Salary", 1000, "USD")];
    expect(() => reduceBalances(drifted)).toThrow(/EUR/);
  });

  it("fails loudly when the payload shape drifts", async () => {
    fetchMock.mockImplementation(async () =>
      json({ accounts: [{ name: "ING - Salary", currencyCode: "EUR" }] }),
    );
    const err = (await getBalances({ sleep: async () => {} }).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
  });
});

describe("retry policy", () => {
  it("waits at least 30 s on 409 init_sync", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock
      .mockResolvedValueOnce(json({ error: "init_sync in progress" }, 409))
      .mockResolvedValueOnce(json({ accounts: ALL_ACCOUNTS }));

    await getBalances({ sleep, jitter: () => 0 });

    expect(delays).toEqual([30_000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After on 429", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "90" }))
      .mockResolvedValueOnce(json({ accounts: ALL_ACCOUNTS }));

    await getBalances({ sleep, jitter: () => 0 });

    expect(delays).toEqual([90_000]);
  });

  it("falls back to 60 s when 429 carries no Retry-After", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ accounts: ALL_ACCOUNTS }));

    await getBalances({ sleep, jitter: () => 0 });

    expect(delays).toEqual([60_000]);
  });

  it("retries a 500 with the standard backoff", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock.mockImplementation(async () => json({}, 500));

    await expect(getAccounts({ sleep, jitter: () => 0 })).rejects.toThrow(UpstreamError);

    expect(delays).toEqual([2000, 4000, 8000, 16000]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("fails fast and distinctly on the known 401 rejection", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock.mockImplementation(async () =>
      json({ detail: "authentication failed with status: 403" }, 401),
    );

    const err = (await getAccounts({ sleep }).catch((e: unknown) => e)) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("authentication rejected");
    expect(err.message).toContain("not expired");
    expect(err.detail).toEqual({ detail: "authentication failed with status: 403" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("fails fast on other 4xx", async () => {
    fetchMock.mockImplementation(async () => json({ message: "nope" }, 404));
    await expect(getAccounts({ sleep: async () => {} })).rejects.toThrow(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

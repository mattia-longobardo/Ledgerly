import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";
import { getAccounts, getBalances, getCategories, getRecords, postRecords, reduceBalances } from "./wallet";

process.env.DATABASE_URL = "postgres://dashboard@localhost/dashboard";
process.env.AUTH_URL = "https://dash.example.test";
process.env.AUTH_SECRET = "a".repeat(40);
process.env.OIDC_ISSUER = "https://auth.example.test/application/o/dashboard/";
process.env.OIDC_CLIENT_ID = "client";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.AUTHORIZED_SUB = "sub-123";
process.env.PAPERLESS_URL = "https://paperless.example.test";
process.env.PAPERLESS_TOKEN = "paperless-token";
process.env.CRON_SECRET = "c".repeat(20);
process.env.WEBHOOK_SECRET = "w".repeat(20);
process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
process.env.WALLET_API_URL = "https://wallet.example.test/wallet/v1/api";

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

    const balances = await getBalances({ token: "t" });

    expect(balances.ing).toBe(1000);
    expect(balances.revolut).toBeCloseTo(275.75, 2);
    expect(balances.breakdown).toEqual({
      ing: 1000,
      revolut_main: 200,
      revolut_savings: 50.5,
      revolut_holidays: 25.25,
    });
  });

  it("sends the given token as the bearer header, per call", async () => {
    fetchMock.mockImplementation(async () => json({ accounts: ALL_ACCOUNTS }));
    await getBalances({ token: "jwt-token" });
    await getBalances({ token: "rotated-token" });

    const first = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(first.authorization).toBe("Bearer jwt-token");
    expect(second.authorization).toBe("Bearer rotated-token");
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
    const err = (await getBalances({ token: "t", sleep: async () => {} }).catch(
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

    await getBalances({ token: "t", sleep, jitter: () => 0 });

    expect(delays).toEqual([30_000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After on 429", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "90" }))
      .mockResolvedValueOnce(json({ accounts: ALL_ACCOUNTS }));

    await getBalances({ token: "t", sleep, jitter: () => 0 });

    expect(delays).toEqual([90_000]);
  });

  it("falls back to 60 s when 429 carries no Retry-After", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ accounts: ALL_ACCOUNTS }));

    await getBalances({ token: "t", sleep, jitter: () => 0 });

    expect(delays).toEqual([60_000]);
  });

  it("retries a 500 with the standard backoff", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock.mockImplementation(async () => json({}, 500));

    await expect(getAccounts({ token: "t", sleep, jitter: () => 0 })).rejects.toThrow(UpstreamError);

    expect(delays).toEqual([2000, 4000, 8000, 16000]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("fails fast and distinctly on the known 401 rejection", async () => {
    const { delays, sleep } = recordingSleep();
    fetchMock.mockImplementation(async () =>
      json({ detail: "authentication failed with status: 403" }, 401),
    );

    const err = (await getAccounts({ token: "t", sleep }).catch((e: unknown) => e)) as UpstreamError;

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
    await expect(getAccounts({ token: "t", sleep: async () => {} })).rejects.toThrow(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function minimalCategory(id: string) {
  return { id, name: `Category ${id}`, group: null };
}

function minimalRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    accountId: "a1",
    amount: 1,
    currencyCode: "EUR",
    recordType: "expense",
    recordState: "cleared",
    recordDate: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("getCategories", () => {
  it("returns the category list", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ categories: [{ id: "c1", name: "Interest, dividends", group: "Income" }] }),
    );
    const categories = await getCategories({ token: "t" });
    expect(categories).toEqual([{ id: "c1", name: "Interest, dividends", group: "Income" }]);
  });

  it("throws when a full page of categories may be truncated", async () => {
    const categories = Array.from({ length: 200 }, (_, i) => minimalCategory(`c${i}`));
    fetchMock.mockResolvedValueOnce(json({ categories }));
    const err = (await getCategories({ token: "t" }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("truncated");
    expect(err.retryable).toBe(false);
  });
});

describe("getRecords", () => {
  it("appends a recordDate gte filter when sinceDate is given", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await getRecords({ token: "t", sinceDate: "2026-08-01" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("recordDate=gte.2026-08-01");
  });

  it("omits the filter when sinceDate is not given", async () => {
    fetchMock.mockResolvedValueOnce(json({ records: [] }));
    await getRecords({ token: "t" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).not.toContain("recordDate");
  });

  it("parses a record with the fields the sync handler needs", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        records: [
          {
            id: "r1",
            accountId: "a1",
            amount: -12.5,
            currencyCode: "EUR",
            categoryId: "c1",
            labels: ["l1"],
            recordType: "expense",
            recordState: "cleared",
            note: "Coffee",
            recordDate: "2026-09-01T08:00:00Z",
            updatedAt: "2026-09-01T08:00:00Z",
          },
        ],
      }),
    );
    const records = await getRecords({ token: "t" });
    expect(records).toHaveLength(1);
    expect(records[0]!.amount).toBe(-12.5);
  });

  it("throws naming the field when every record in a non-empty page is missing recordType", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        records: [
          minimalRecord("r1", { recordType: undefined }),
          minimalRecord("r2", { recordType: undefined }),
        ],
      }),
    );
    const err = (await getRecords({ token: "t" }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("recordType");
    expect(err.retryable).toBe(false);
  });

  it("throws naming the field when every record in a non-empty page is missing recordState", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        records: [minimalRecord("r1", { recordState: undefined })],
      }),
    );
    const err = (await getRecords({ token: "t" }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("recordState");
    expect(err.retryable).toBe(false);
  });

  it("does not throw when only some records in the page are missing recordType/recordState", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        records: [minimalRecord("r1", { recordType: undefined }), minimalRecord("r2")],
      }),
    );
    const records = await getRecords({ token: "t" });
    expect(records).toHaveLength(2);
  });

  it("throws when a full page of records may be truncated", async () => {
    const records = Array.from({ length: 500 }, (_, i) => minimalRecord(`r${i}`));
    fetchMock.mockResolvedValueOnce(json({ records }));
    const err = (await getRecords({ token: "t" }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("truncated");
    expect(err.retryable).toBe(false);
  });
});

describe("postRecords", () => {
  it("POSTs the records array with a bearer header", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await postRecords({ token: "t" }, [{ accountId: "a1", amount: 0.63, recordDate: "2026-09-01T00:00:00Z", note: "auto-interest" }]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer t" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([
      { accountId: "a1", amount: 0.63, recordDate: "2026-09-01T00:00:00Z", note: "auto-interest" },
    ]);
  });
});

// Investments phase 3 (docs/design/investments.md §3.1, §3.3, §5, §7 row "3 · eToro"): the pass of
// a connected service against a real database, with a fake source in place of eToro — the lock,
// `revoked` on 401, `refused` with backoff on 429, the empty answers, holdings and flows with
// outcomes of their own, the key's checks, and canary keys on every branch of failure.
import { and, asc, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listBalanceEntries } from "@/modules/accounts/queries";
import { createAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { saveRates } from "@/platform/fx/service";
import {
  type HoldingsSnapshot,
  type InvestmentSource,
  type KeyCheck,
  type ProviderEvent,
  SourceError,
} from "@/platform/integrations/investments/source";
import { integrationConnections, providerLinks, syncRuns } from "@/platform/integrations/schema";
import { listConnections, listRuns, saveSyncJob } from "@/platform/integrations/service";
import { type EtoroTrade, tradeSchema } from "@/platform/integrations/etoro/client";
import { tradeEventsOf } from "@/platform/integrations/etoro/mapping";
import { withJobLock } from "@/platform/jobs/lock";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { investmentsPnl, serviceDetail } from "./queries";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentEvents,
  investmentKeyChecks,
  investmentReadings,
  investmentSyncCoverage,
} from "./schema";
import { createManualService, recordOperation } from "./service";
import {
  confirmKeyRevoked,
  connectInvestmentProvider,
  disconnectProvider,
  replaceKey,
  runInvestmentPass,
  SyncError,
  syncNow,
  setSourcesForTests,
  verifyKey,
} from "./sync";

const CANARY_KEY = "canary-etoro-api-key-5c1d77";
const CANARY_USER = "canary-etoro-user-key-a90e3f";
const KEYS = { api_key: CANARY_KEY, user_key: CANARY_USER };
const READ_SCOPES = ["etoro-public:trade.real:read", "etoro-public:money.balance:read"];

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

interface Behaviour {
  check: () => Promise<KeyCheck>;
  holdings: () => Promise<HoldingsSnapshot>;
  flows: () => Promise<{ events: ProviderEvent[] }>;
  history: () => Promise<{ on: string; totalCents: bigint }[]>;
}

const readOnly = (): KeyCheck => ({
  result: "read-only",
  permissions: Object.fromEntries(READ_SCOPES.map((scope) => [scope, true])),
  ipRestricted: null,
  externalAccountId: "900001",
});

function snapshot(totalCents: bigint, now: Date, empty = false): HoldingsSnapshot {
  return {
    observedAt: now,
    externalAccountId: "900001",
    totalCents,
    cashCents: 0n,
    positions:
      totalCents === 0n
        ? []
        : [
            {
              asset: {
                externalId: "instrument:1001",
                class: "stock",
                name: "Apple",
                symbol: "AAPL",
                currency: "USD",
              },
              product: "trading",
              quantity: "2",
              price: "200",
              priceCurrency: "USD",
              priceSource: "etoro",
              valueCents: totalCents,
            },
          ],
    scopes: [
      { product: "cash", complete: true },
      { product: "copy", complete: true },
      { product: "trading", complete: true },
    ],
    empty,
    complete: true,
  };
}

const deposit = (
  id: string,
  at: Date,
  amount: string,
  kind: "deposit" | "withdrawal" = "deposit",
): ProviderEvent => ({
  externalId: `cash:${id}`,
  occurredAt: at,
  note: null,
  legs: [
    {
      leg: "main",
      kind,
      asset: null,
      product: null,
      quantity: null,
      unitPrice: null,
      priceCurrency: null,
      nativeAmount: amount,
      nativeCurrency: "EUR",
    },
  ],
});

const trade = (id: number, at: Date): ProviderEvent => ({
  externalId: `trade:${id}:open`,
  occurredAt: at,
  note: null,
  legs: [
    {
      leg: "base",
      kind: "buy",
      asset: {
        externalId: "instrument:1001",
        class: "stock",
        name: "Apple",
        symbol: "AAPL",
        currency: "USD",
      },
      product: "trading",
      quantity: "1",
      unitPrice: "100",
      priceCurrency: "USD",
      nativeAmount: "100",
      nativeCurrency: "USD",
    },
  ],
});

let ctx: Ctx;
let todayOn: string;
let behaviour: Behaviour;
let calls: string[];

function fakeSource(): InvestmentSource {
  return {
    async verifyReadOnly() {
      calls.push("verify");
      return behaviour.check();
    },
    async fetchHoldings() {
      calls.push("holdings");
      return behaviour.holdings();
    },
    async fetchFlows(_credentials, now) {
      calls.push("flows");
      const { events } = await behaviour.flows();
      return {
        events,
        coverage: [
          {
            stream: "trades",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "complete",
            reason: null,
          },
          {
            stream: "deposits",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: new Date("2026-06-10T09:00:00Z"),
            status: "partial",
            reason: "before_first_movement",
          },
          {
            stream: "deposits",
            fromAt: new Date("2026-06-10T09:00:00Z"),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
    async fetchHistory(_credentials, _currency, now) {
      calls.push("history");
      const points = await behaviour.history();
      return {
        points,
        coverage: [
          {
            stream: "balance_history",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: new Date(`${points[0]?.on ?? todayOn}T00:00:00Z`),
            status: "gap",
            reason: "api_limit_12m",
          },
          {
            stream: "balance_history",
            fromAt: new Date(`${points[0]?.on ?? todayOn}T00:00:00Z`),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
  };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  todayOn = today(ctx.timeZone);
  calls = [];
  const now = new Date();
  behaviour = {
    check: async () => readOnly(),
    holdings: async () => snapshot(123_456n, now),
    flows: async () => ({ events: [] }),
    history: async () => [
      { on: addDays(todayOn, -3), totalCents: 100_000n },
      { on: addDays(todayOn, -2), totalCents: 110_000n },
      { on: addDays(todayOn, -1), totalCents: 120_000n },
    ],
  };
  setSourcesForTests(() => fakeSource());
  // The trades are in dollars: the ECB rate of their day, stored, so no test reaches Frankfurter.
  const rates = [];
  for (let on = "2020-01-01"; on <= todayOn; on = addDays(on, 7))
    rates.push({ on, currency: "USD", eurPerUnit: "0.9" });
  await saveRates(rates);
});

afterEach(() => {
  setSourcesForTests(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

async function connectNew(currency = "EUR") {
  return connectInvestmentProvider(ctx, "etoro", KEYS, { kind: "new", name: "eToro", currency });
}

async function connection() {
  const [one] = await listConnections(ctx);
  return one;
}

async function pass(now = new Date()) {
  const one = await connection();
  return runInvestmentPass(
    { id: ctx.userId } as never,
    ctx,
    {
      id: one.id,
      userId: ctx.userId,
      provider: one.provider,
      schedule: one.schedule,
      nextSyncAt: one.nextSyncAt,
    },
    now,
  );
}

async function readingsOf(accountId: string) {
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, accountId));
  return getDb()
    .select()
    .from(investmentReadings)
    .where(eq(investmentReadings.investmentAccountId, investment.id))
    .orderBy(asc(investmentReadings.on));
}

describe("connectInvestmentProvider (§5.1, SEC-05)", () => {
  it("saves the key, the account, the check, the history and the first reading", async () => {
    const { accountId } = await connectNew();
    const [saved] = await listConnections(ctx);
    expect(saved).toMatchObject({ provider: "etoro", state: "active" });
    expect(saved.schedule.rules).toEqual([
      { kind: "times", times: ["07:30", "22:30"], days: { kind: "every" } },
    ]);

    const [investment] = await getDb()
      .select()
      .from(investmentAccounts)
      .where(eq(investmentAccounts.accountId, accountId));
    expect(investment).toMatchObject({
      provider: "etoro",
      category: "broker",
      managedSince: addDays(todayOn, -3),
    });
    const periods = await getDb()
      .select()
      .from(investmentAccountPeriods)
      .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
    expect(periods.map((one) => [one.origin, one.fromOn])).toEqual([["synced", addDays(todayOn, -3)]]);

    const checks = await getDb().select().from(investmentKeyChecks);
    expect(checks.map((one) => [one.origin, one.result])).toEqual([["connect", "read-only"]]);
    expect(JSON.stringify(checks)).not.toContain(CANARY_KEY);

    const readings = await readingsOf(accountId);
    expect(readings.map((one) => [one.on, one.totalCents, one.status])).toEqual([
      [addDays(todayOn, -3), 100_000n, "complete"],
      [addDays(todayOn, -2), 110_000n, "complete"],
      [addDays(todayOn, -1), 120_000n, "complete"],
      [todayOn, 123_456n, "complete"],
    ]);
    const entries = await listBalanceEntries(ctx, accountId);
    expect(entries.find((entry) => entry.on === todayOn)).toMatchObject({
      balanceCents: 123_456n,
      source: "portfolio",
    });

    const coverage = await getDb()
      .select()
      .from(investmentSyncCoverage)
      .orderBy(asc(investmentSyncCoverage.stream));
    expect(coverage.map((one) => one.stream)).toContain("balance_history");
    expect(coverage.map((one) => one.stream)).toContain("trades");
    expect(calls).toEqual(["verify", "holdings", "history", "flows"]);
  });

  it("refuses a key that can write, and saves nothing", async () => {
    behaviour.check = async () => ({ ...readOnly(), result: "write" });
    await expect(connectNew()).rejects.toMatchObject({ code: "not_read_only" });
    expect(await listConnections(ctx)).toEqual([]);
    expect(await getDb().select().from(investmentAccounts)).toEqual([]);
    expect(calls).toEqual(["verify"]);
  });

  it("fails when the provider does not answer, and saves nothing", async () => {
    behaviour.holdings = async () => {
      throw new SourceError("etoro", "unavailable", 503);
    };
    await expect(connectNew()).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(await listConnections(ctx)).toEqual([]);
  });

  it("refuses a field the provider does not have (SEC-03) and a currency eToro cannot report", async () => {
    await expect(
      connectInvestmentProvider(
        ctx,
        "etoro",
        { ...KEYS, httpsProxy: "http://evil.example" },
        { kind: "new", name: "x", currency: "EUR" },
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(connectNew("JPY")).rejects.toMatchObject({ code: "unsupported_currency" });
    await expect(
      connectInvestmentProvider(ctx, "ccxt:kraken", KEYS, { kind: "new", name: "x", currency: "EUR" }),
    ).rejects.toMatchObject({ code: "unknown_provider" });
    expect(calls).toEqual([]);
  });

  it("converts a manual service to synced (§2.5), as the legacy eToro account will be", async () => {
    const { accountId } = await createManualService(ctx, {
      target: "new",
      name: "eToro legacy",
      category: "broker",
      currency: "EUR",
      mode: "total",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 50_000n });
    const result = await connectInvestmentProvider(ctx, "etoro", KEYS, { kind: "existing", accountId });
    expect(result.accountId).toBe(accountId);
    const [investment] = await getDb()
      .select()
      .from(investmentAccounts)
      .where(eq(investmentAccounts.accountId, accountId));
    expect(investment.provider).toBe("etoro");
    const periods = await getDb()
      .select()
      .from(investmentAccountPeriods)
      .where(eq(investmentAccountPeriods.investmentAccountId, investment.id))
      .orderBy(asc(investmentAccountPeriods.startsAt));
    expect(periods.map((one) => [one.origin, one.reason])).toEqual([
      ["manual", "opening"],
      ["synced", "conversion"],
    ]);
    const entries = await listBalanceEntries(ctx, accountId);
    expect(entries.find((entry) => entry.on === todayOn)?.balanceCents).toBe(123_456n);
  });

  it("refuses an account that is not of the provider's type", async () => {
    const savings = await createAccount(ctx, { name: "Savings", type: "savings", currency: "EUR" });
    await expect(
      connectInvestmentProvider(ctx, "etoro", KEYS, { kind: "existing", accountId: savings.id }),
    ).rejects.toMatchObject({ code: "not_eligible" });
  });
});

describe("the pass (§3.1)", () => {
  it("checks the key again, then writes holdings and flows with outcomes of their own", async () => {
    const { accountId } = await connectNew();
    calls = [];
    const now = new Date();
    behaviour.holdings = async () => snapshot(130_000n, now);
    behaviour.flows = async () => ({
      events: [
        deposit("1", new Date("2026-06-10T09:06:55Z"), "740"),
        trade(9, new Date("2026-06-12T14:03:20Z")),
      ],
    });
    expect(await pass(now)).toBe("answered");
    expect(calls).toEqual(["verify", "holdings", "flows"]);
    const runs = await listRuns(ctx, { limit: 10 });
    expect(
      runs.filter((run) => run.kind === "holdings" || run.kind === "flows").map((run) => run.state),
    ).toEqual(["success", "success"]);
    expect((await readingsOf(accountId)).at(-1)?.totalCents).toBe(130_000n);
    const events = await getDb()
      .select()
      .from(investmentEvents)
      .where(eq(investmentEvents.origin, "provider"));
    expect(events).toHaveLength(2);
    const links = await getDb()
      .select()
      .from(providerLinks)
      .where(eq(providerLinks.entityType, "investment_event"));
    expect(links.map((one) => one.externalId).sort()).toEqual(["cash:1", "trade:9:open"]);

    // A second pass recognises the same events (A6).
    await getDb().delete(syncRuns);
    expect(await pass(new Date(now.getTime() + 120_000))).toBe("answered");
    expect(
      await getDb().select().from(investmentEvents).where(eq(investmentEvents.origin, "provider")),
    ).toHaveLength(2);
  });

  it("is busy while another pass of the same connection holds the lock (V9)", async () => {
    await connectNew();
    const one = await connection();
    const outcome = await withJobLock(`investments-sync:${one.id}`, () => pass());
    expect(outcome).toEqual({ ran: true, value: "busy" });
  });

  it("marks the connection revoked on a 401 and asks for the key to be revoked", async () => {
    const { accountId } = await connectNew();
    behaviour.check = async () => {
      throw new SourceError("etoro", "auth", 401);
    };
    expect(await pass()).toBe("refused");
    expect(await connection()).toMatchObject({ state: "revoked", lastError: "etoro · auth · 401" });
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.sync?.revokePending).toBe(true);
    await confirmKeyRevoked(ctx, accountId);
    expect((await serviceDetail(ctx, accountId))?.sync?.revokePending).toBe(false);
  });

  it("keeps the connection on a 403 of a reading, and revokes it on a 403 of the key check (PERS-87 SEC-06)", async () => {
    await connectNew();
    behaviour.holdings = async () => {
      throw new SourceError("etoro", "permission", 403);
    };
    expect(await pass()).toBe("failed");
    expect(await connection()).toMatchObject({ state: "active" });
    expect((await listRuns(ctx, { limit: 2 })).map((run) => run.error)).toContain("etoro · permission · 403");

    behaviour.check = async () => {
      throw new SourceError("etoro", "permission", 403);
    };
    expect(await pass()).toBe("refused");
    expect(await connection()).toMatchObject({ state: "revoked", lastError: "etoro · permission · 403" });
  });

  it("is refused on a 429 and waits as long as the provider asked (SEC-09)", async () => {
    await connectNew();
    const now = new Date();
    behaviour.holdings = async () => {
      throw new SourceError("etoro", "rate_limited", 429, 600);
    };
    expect(await pass(now)).toBe("refused");
    calls = [];
    expect(await pass(new Date(now.getTime() + 60_000))).toBe("refused");
    expect(calls).toEqual([]);
    const runs = await listRuns(ctx, { limit: 2 });
    expect(runs.map((run) => [run.state, run.error])).toEqual([
      ["skipped", "etoro · rate_limited"],
      ["skipped", "etoro · rate_limited"],
    ]);
    behaviour.holdings = async () => snapshot(1n, now);
    expect(await pass(new Date(now.getTime() + 601_000))).toBe("answered");
  });

  it("refuses a key that started to write, reads nothing, and says which permission (§5.2)", async () => {
    const { accountId } = await connectNew();
    const before = await readingsOf(accountId);
    calls = [];
    behaviour.check = async () => ({
      ...readOnly(),
      result: "write",
      permissions: { "etoro-public:trade.real:write": true },
    });
    expect(await pass()).toBe("refused");
    expect(calls).toEqual(["verify"]);
    expect(await readingsOf(accountId)).toEqual(before);
    expect(await connection()).toMatchObject({ state: "error", lastError: "etoro · key_write" });
  });

  it("keeps the value when the history fails: holdings and flows are apart (A8)", async () => {
    const { accountId } = await connectNew();
    const now = new Date();
    behaviour.holdings = async () => snapshot(140_000n, now);
    behaviour.flows = async () => {
      throw new SourceError("etoro", "unavailable", 503);
    };
    expect(await pass(now)).toBe("failed");
    expect((await readingsOf(accountId)).at(-1)?.totalCents).toBe(140_000n);
    const runs = await listRuns(ctx, { limit: 2 });
    expect(runs.map((run) => [run.kind, run.state]).sort()).toEqual([
      ["flows", "failed"],
      ["holdings", "success"],
    ]);
  });

  it("holds the value on an empty answer after a large one, and counts it after a withdrawal (R5)", async () => {
    const { accountId } = await connectNew();
    const now = new Date();
    behaviour.holdings = async () => snapshot(0n, now, true);
    await pass(now);
    expect((await readingsOf(accountId)).at(-1)?.status).toBe("pending_zero");
    // One reading a day (§1.6): the empty one replaced the morning's, so P holds at the last counting one.
    expect(
      (await listBalanceEntries(ctx, accountId)).find((entry) => entry.on === todayOn)?.balanceCents,
    ).toBe(120_000n);

    behaviour.flows = async () => ({ events: [deposit("w1", now, "1234.56", "withdrawal")] });
    await getDb().delete(syncRuns);
    await pass(new Date(now.getTime() + 120_000));
    // The withdrawal arrives with the flows of that pass; the next empty reading is believable.
    await getDb().delete(syncRuns);
    await pass(new Date(now.getTime() + 240_000));
    expect((await readingsOf(accountId)).at(-1)?.status).toBe("confirmed_zero");
  });

  it("counts an empty first answer at once: nothing was there before", async () => {
    behaviour.history = async () => [];
    behaviour.holdings = async () => snapshot(0n, new Date(), true);
    const { accountId } = await connectNew();
    expect((await readingsOf(accountId)).map((one) => one.status)).toEqual(["confirmed_zero"]);
  });
});

describe("canary keys never leave the source (§5.1, SEC-04)", () => {
  const failures: [string, () => Error][] = [
    ["network", () => new SourceError("etoro", "network")],
    ["401", () => new SourceError("etoro", "auth", 401)],
    ["429", () => new SourceError("etoro", "rate_limited", 429, 1)],
    ["schema", () => new SourceError("etoro", "schema_mismatch", 200)],
    ["timeout", () => new SourceError("etoro", "timeout")],
    ["raw error", () => new Error(`boom ${CANARY_KEY} ${CANARY_USER} https://x/?k=${CANARY_KEY}`)],
  ];

  for (const [name, failure] of failures) {
    for (const step of ["check", "holdings", "flows"] as const) {
      it(`${name} in ${step}`, async () => {
        await connectNew();
        const printed: string[] = [];
        for (const method of ["error", "warn", "log", "info"] as const) {
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
            printed.push(
              args
                .map((arg) =>
                  arg instanceof Error ? `${arg.message} ${arg.stack}` : (JSON.stringify(arg) ?? String(arg)),
                )
                .join(" "),
            );
          });
        }
        behaviour[step] = async () => {
          throw failure();
        };
        await pass();
        const [row] = await getDb().select().from(integrationConnections);
        const runs = await getDb().select().from(syncRuns);
        const checks = await getDb().select().from(investmentKeyChecks);
        const stored = JSON.stringify(
          { lastError: row.lastError, runs: runs.map((run) => run.error), checks },
          (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        );
        for (const text of [stored, printed.join("\n")]) {
          expect(text).not.toContain(CANARY_KEY);
          expect(text).not.toContain(CANARY_USER);
        }
        expect(runs.some((run) => run.error !== null && /^etoro · [a-z_]+( · \d{3})?$/.test(run.error))).toBe(
          true,
        );
      });
    }
  }
});

describe("the key on the service page (§4.3, §5.3)", () => {
  it("allows one Sync now a minute (SEC-09)", async () => {
    const { accountId } = await connectNew();
    const now = new Date();
    expect(await syncNow(ctx, accountId, now)).toBe("answered");
    await expect(syncNow(ctx, accountId, new Date(now.getTime() + 30_000))).rejects.toMatchObject({
      code: "cooldown",
    });
    expect(await syncNow(ctx, accountId, new Date(now.getTime() + 61_000))).toBe("answered");
  });

  it("verifies the key on demand and records the check", async () => {
    const { accountId } = await connectNew();
    const now = new Date(Date.now() + 120_000);
    expect(await verifyKey(ctx, accountId, now)).toBe("read-only");
    await expect(verifyKey(ctx, accountId, new Date(now.getTime() + 1_000))).rejects.toBeInstanceOf(
      SyncError,
    );
    const checks = await getDb()
      .select()
      .from(investmentKeyChecks)
      .orderBy(asc(investmentKeyChecks.checkedAt));
    expect(checks.map((one) => one.origin)).toEqual(["connect", "verify"]);
  });

  it("keeps the old key when the new one fails, and retires it when the new one works", async () => {
    const { accountId } = await connectNew();
    behaviour.check = async () => ({ ...readOnly(), result: "write" });
    await expect(
      replaceKey(ctx, accountId, { api_key: "new-api-key-1234", user_key: "new-user-key-1234" }),
    ).rejects.toMatchObject({
      code: "not_read_only",
    });
    expect((await serviceDetail(ctx, accountId))?.sync?.revokePending).toBe(false);

    behaviour.check = async () => readOnly();
    const fresh = { api_key: "new-api-key-1234", user_key: "new-user-key-1234" };
    await replaceKey(ctx, accountId, fresh);
    const checks = await getDb()
      .select()
      .from(investmentKeyChecks)
      .orderBy(asc(investmentKeyChecks.checkedAt));
    expect(checks.map((one) => [one.origin, one.retiredAt === null])).toEqual([
      ["connect", false],
      ["replace", true],
    ]);
    expect((await serviceDetail(ctx, accountId))?.sync?.revokePending).toBe(true);
  });

  it("refuses a key of another external account and keeps the old one (PERS-87 SEC-03)", async () => {
    const { accountId } = await connectNew();
    const now = new Date();
    behaviour.holdings = async () => ({ ...snapshot(123_456n, now), externalAccountId: "900002" });
    const fresh = { api_key: "other-api-key-1234", user_key: "other-user-key-1234" };
    await expect(replaceKey(ctx, accountId, fresh)).rejects.toMatchObject({ code: "different_account" });
    const checks = await getDb().select().from(investmentKeyChecks);
    expect(checks.map((one) => [one.origin, one.retiredAt === null])).toEqual([["connect", true]]);
    expect((await serviceDetail(ctx, accountId))?.sync?.revokePending).toBe(false);

    behaviour.holdings = async () => snapshot(123_456n, now);
    await replaceKey(ctx, accountId, fresh);
  });

  it("allows five attempts of Connect and Replace key in ten minutes, per provider (PERS-87 SEC-01)", async () => {
    const now = new Date();
    behaviour.check = async () => {
      throw new SourceError("etoro", "unavailable", 503);
    };
    const target = { kind: "new" as const, name: "eToro", currency: "EUR" };
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        connectInvestmentProvider(ctx, "etoro", KEYS, target, new Date(now.getTime() + attempt * 1_000)),
      ).rejects.toMatchObject({ code: "provider_unavailable" });
    }
    behaviour.check = async () => readOnly();
    const { accountId } = await connectInvestmentProvider(ctx, "etoro", KEYS, target, now);
    calls = [];
    const fresh = { api_key: "new-api-key-1234", user_key: "new-user-key-1234" };
    await expect(replaceKey(ctx, accountId, fresh, new Date(now.getTime() + 60_000))).rejects.toMatchObject({
      code: "cooldown",
    });
    expect(calls).toEqual([]);
    // Another person has a budget of their own.
    const other = contextFor((await createTestUser()).id);
    await expect(
      connectInvestmentProvider(other, "etoro", KEYS, target, new Date(now.getTime() + 60_000)),
    ).resolves.toMatchObject({ accountId: expect.any(String) });
    await replaceKey(ctx, accountId, fresh, new Date(now.getTime() + 10 * 60_000 + 1));
  });

  it("disconnects into a manual account at the same value (§2.5), then forgets the key", async () => {
    const { accountId } = await connectNew();
    const before = (await serviceDetail(ctx, accountId))?.summary.valueCents;
    await disconnectProvider(ctx, accountId);
    expect(await listConnections(ctx)).toEqual([]);
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.summary.origin).toBe("manual");
    expect(detail?.summary.mode).toBe("assets");
    expect(detail?.summary.valueCents).toBe(before);
    expect(detail?.holdings.map((row) => [row.asset.symbol, row.origin])).toEqual([["AAPL", "manual"]]);
    expect(detail?.sync?.revokePending).toBe(true);
    const [investment] = await getDb()
      .select()
      .from(investmentAccounts)
      .where(and(eq(investmentAccounts.accountId, accountId)));
    expect(investment.provider).toBe("manual");
  });

  it("hides gain and return while the deposits are not covered (§2.4)", async () => {
    const { accountId } = await connectNew();
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.summary.reliable).toBe(false);
    expect(detail?.summary.performance.gainCents).toBeNull();
    expect(detail?.summary.reliableFrom?.toISOString()).toBe("2026-06-10T09:00:00.000Z");
    expect(detail?.holdings.map((row) => [row.asset.symbol, row.origin, row.state.valueCents])).toEqual([
      ["AAPL", "provider", 123_456n],
    ]);
  });

  it("backs off a refused pass even for Sync now", async () => {
    const { accountId } = await connectNew();
    const one = await connection();
    await saveSyncJob(ctx, one.id, "holdings", {
      cursor: { backoff_until: new Date(Date.now() + 3_600_000).toISOString() },
    });
    expect(await syncNow(ctx, accountId)).toBe("refused");
  });
});

describe("the P&L of a period on eToro's trades (docs/design/investments-ux.md §4.4, U1)", () => {
  it("realizes each closed position against its own opening, by positionId, not the average", async () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), "test/fixtures/investments/etoro/trade-history.json"), "utf8"),
    ) as { body: unknown[] };
    const trades: EtoroTrade[] = fixture.body.map((row) => tradeSchema.parse(row));
    const spacex = trades.find((trade) => trade.positionId === 900015)!;
    expect(spacex.closeTimestamp >= "2026-06-10").toBe(true);
    // Two more positions of the same instrument, open at the same time: their average is not theirs.
    const more = (
      positionId: number,
      open: string,
      close: string,
      investment: number,
      netProfit: number,
    ) => ({
      ...spacex,
      positionId,
      openTimestamp: open,
      closeTimestamp: close,
      investment,
      netProfit,
    });
    trades.push(
      more(990001, "2026-07-01T10:00:00Z", "2026-08-03T10:00:00Z", 100, 10),
      more(990002, "2026-07-15T10:00:00Z", "2026-09-01T10:00:00Z", 300, -30),
    );
    behaviour.flows = async () => ({ events: tradeEventsOf(trades, new Map()) });
    const { accountId } = await connectNew("USD");

    const { portfolio } = await investmentsPnl(ctx, { from: "2026-06-10", to: todayOn });
    const pnl = portfolio.services.find((one) => one.accountId === accountId)!;
    // The deposits are covered from 10 June (eToro Money): the period starts there.
    expect(pnl.from).toBe("2026-06-10");
    const closes = pnl.exits.filter((exit) => exit.kind === "close");
    const closed = trades
      .filter((trade) => trade.closeTimestamp >= "2026-06-10")
      .sort((a, b) => (a.closeTimestamp < b.closeTimestamp ? -1 : 1));
    expect(closed.map((trade) => trade.positionId)).toContain(990002);
    expect(closes.map((exit) => exit.matched)).toEqual(closed.map(() => "position"));
    // eToro's own netProfit, fees included, to the cent of the rounding of its two amounts.
    closes.forEach((exit, index) => {
      expect(Math.abs(Number(exit.realizedCents) - closed[index].netProfit * 100)).toBeLessThanOrEqual(1);
      expect(exit.costCents).toBe(BigInt(Math.round(closed[index].investment * 100)));
    });
    expect(pnl.local?.realizedCents).toBe(closes.reduce((sum, exit) => sum + exit.realizedCents!, 0n));
    // No cost of the open positions yet (U4): the rest of the P&L is in "Other", additive.
    const parts = pnl.local!;
    expect(parts.unrealizedChangeCents).toBeNull();
    expect(
      parts.realizedCents +
        parts.incomeCents +
        parts.feesCents +
        parts.correctionsCents +
        parts.unattributedCents,
    ).toBe(parts.pnlCents);
  });

  it("leaves 2025 out: no deposit of it is covered, so no reliable P&L, never a zero", async () => {
    const { accountId } = await connectNew("USD");
    const { portfolio } = await investmentsPnl(ctx, { period: "2025" });
    expect(portfolio.excluded.map((one) => one.accountId)).toEqual([accountId]);
    expect(portfolio).toMatchObject({ status: "undetermined", parts: null });
  });
});

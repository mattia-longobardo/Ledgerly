// R3 parity of the writes of Investments (03-releases.md §R3, criterion 11): what a Server Action did
// with what a person typed — the fields read in their number format, the use case of the domain — is
// what `calls.ts` does through the routes, on the same fields. The Server Actions are gone; `actions`
// is what they did, line for line. Alice takes the old path, Bob the new one; what each service then
// holds is read from the same route and compared without the ids.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { today } from "@domain/shared/dates";
import { parseDecimal } from "@domain/shared/money";
import type { OperationInput } from "@ledgerly/domain/investments";
import type { InvestmentSource } from "@domain/platform/integrations/investments/source";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const investments = await import("@ledgerly/domain/investments");
const { addAsset } = await import("@domain/modules/investments/service");
const { setSourcesForTests } = await import("@domain/modules/investments/sync");
const { assetsService, connectTarget, manualService } = await import("../../../../../test/investments");
const { numberSeparators, parseAmount } = await import("@domain/platform/format");
const { numberStyle } = await import("@ledgerly/format/format");
const { read } = await import("@ledgerly/ui/data");
const { profile } = await import("@ledgerly/api-contract/settings");
const calls = await import("./calls");

/** Whose session the routes see: the person of the call in progress. */
let session: Ctx;

const routes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", session);
    await next();
  },
  investments: { queueSync: async () => {}, queueFirstFlows: async () => {}, queuePrices: async () => {} },
});

// `call` of the API client reaches the routes as the browser would, under `/api/v1`.
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  if (url.startsWith("/api/v1/")) return routes.request(url.replace(/^\/api\/v1/, ""), init);
  throw new TypeError("fetch failed");
});

/** A call of `calls.ts` in the session of `ctx`. */
async function asPerson<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  session = ctx;
  return work();
}

type Typed = {
  kind: "valuation" | "sell" | "close" | "income";
  holdingId: string | null;
  on: string;
} & Record<"amount" | "quantity" | "unitPrice" | "fee" | "note", string>;

/** The deleted Server Actions: the fields read on the server, the use case, the code of a refusal. */
const actions = (() => {
  async function run<T>(work: () => Promise<T>) {
    try {
      return { ok: true as const, ...(await work()) };
    } catch (error) {
      if (error instanceof investments.InvestmentError || error instanceof investments.SyncError)
        return { ok: false as const, error: error.code };
      if (error instanceof RangeError || (error instanceof Error && error.name === "ZodError"))
        return { ok: false as const, error: "invalid" };
      throw error;
    }
  }
  const blank = (typed: string) => typed.trim() === "";
  const money = (ctx: Ctx, typed: string) => (blank(typed) ? null : parseAmount(typed, ctx.numberFormat));
  const number = (ctx: Ctx, typed: string, scale: number) =>
    blank(typed)
      ? null
      : parseDecimal(investments.plainDecimal(typed, numberSeparators(ctx.numberFormat)), scale);
  function operationOf(ctx: Ctx, input: Typed): OperationInput {
    const amount = money(ctx, input.amount);
    if (input.kind === "valuation") {
      const unitPrice = number(ctx, input.unitPrice, investments.PRICE_SCALE);
      return {
        kind: input.kind,
        holdingId: input.holdingId ?? "",
        on: input.on,
        unitPrice,
        amountCents: unitPrice === null ? amount : null,
        note: input.note,
      };
    }
    if (input.kind === "income")
      return {
        kind: input.kind,
        holdingId: input.holdingId || null,
        on: input.on,
        amountCents: amount ?? 0n,
        note: input.note,
      };
    const quantity = number(ctx, input.quantity, investments.QUANTITY_SCALE);
    const unitPrice = number(ctx, input.unitPrice, investments.PRICE_SCALE);
    return {
      kind: input.kind,
      holdingId: input.holdingId ?? "",
      on: input.on,
      quantity,
      unitPrice: quantity === null ? null : unitPrice,
      amountCents: quantity === null || unitPrice === null ? amount : null,
      feeCents: money(ctx, input.fee) ?? 0n,
      note: input.note,
    };
  }
  return {
    updateServiceValue: (ctx: Ctx, accountId: string, input: { on: string; amount: string }) =>
      run(async () => {
        const cents = money(ctx, input.amount);
        if (cents === null) throw new RangeError("Empty amount");
        await investments.updateServiceValue(ctx, accountId, { on: input.on, cents });
      }),
    updateServiceUrl: (ctx: Ctx, accountId: string, url: string) =>
      run(() => investments.updateServiceUrl(ctx, accountId, url)),
    recordOperation: (ctx: Ctx, accountId: string, input: Typed) =>
      run(async () => {
        await investments.recordOperation(ctx, accountId, operationOf(ctx, input));
      }),
    createManualService: (ctx: Ctx, input: { accountId: string; category: "broker"; url: string }) =>
      run(() => investments.createManualService(ctx, input)),
    connectProvider: (ctx: Ctx, accountId: string) =>
      run(() =>
        investments.connectInvestmentProvider(
          ctx,
          "etoro",
          { api_key: "fake-public", user_key: "fake-user" },
          { kind: "existing", accountId },
          new Date(),
          async () => {},
        ),
      ),
  };
})();

/** Every id out of an answer: what tells Alice's service from Bob's. */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(^id$|^key$|Id$|^lastOkAt$|^keySetAt$|^checkedAt$)/.test(key))
      .map(([key, part]) => [key, plain(part)]),
  );
}

/** What a service holds, as its Overview and its Positions answer it over all its days. */
async function heldBy(ctx: Ctx, accountId: string) {
  session = ctx;
  const get = async (path: string) => {
    const response = await routes.request(path);
    expect(response.status).toBe(200);
    return plain(await response.json());
  };
  return {
    overview: await get(`/investments/${accountId}?period=all`),
    activity: await get(`/investments/${accountId}/activity?period=all`),
  };
}

/** A broker kept by asset with ten units of one ETF bought today, the same for both. */
async function byAsset(ctx: Ctx) {
  const { accountId } = await assetsService(ctx, { name: "Directa", category: "broker", currency: "EUR" });
  await addAsset(ctx, accountId, {
    asset: { create: { class: "etf", name: "World", symbol: "WRL", currency: "EUR" } },
    on: todayOn,
    quantity: parseDecimal("10", investments.QUANTITY_SCALE),
    unitPrice: parseDecimal("100", investments.PRICE_SCALE),
  });
  const detail = await investments.serviceDetail(ctx, accountId);
  return { accountId, holdingId: detail!.holdings[0].id };
}

let alice: Ctx;
let bob: Ctx;
let todayOn: string;

const fakeSource = (): InvestmentSource => ({
  async verifyReadOnly() {
    return { result: "read-only", permissions: {}, ipRestricted: null, externalAccountId: "ext-1" };
  },
  async fetchHoldings() {
    return {
      observedAt: new Date(),
      externalAccountId: "ext-1",
      totalCents: 0n,
      cashCents: 0n,
      positions: [],
      scopes: [{ product: "trading", complete: true }],
      empty: true,
      complete: true,
    };
  },
  async fetchFlows() {
    return { events: [], coverage: [] };
  },
  async fetchHistory() {
    return { points: [], coverage: [] };
  },
});

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  todayOn = today(alice.timeZone);
  // The format the screen reads the fields in: Bob's preferences, Alice's context alike.
  session = bob;
  alice = { ...alice, numberFormat: numberStyle(await read(profile.getPreferences, {})) };
  setSourcesForTests(() => fakeSource());
});

afterEach(() => setSourcesForTests(null));

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDatabase();
});

describe("investments, old Server Action = new call", () => {
  it("writes the same operations on a holding from the same typed fields", async () => {
    const old = await byAsset(alice);
    const now = await byAsset(bob);
    const forms: Omit<Typed, "holdingId">[] = [
      { kind: "valuation", on: todayOn, unitPrice: "101,25", amount: "", quantity: "", fee: "", note: "" },
      {
        kind: "valuation",
        on: todayOn,
        unitPrice: "",
        amount: "1.020,50",
        quantity: "",
        fee: "",
        note: "by value",
      },
      { kind: "sell", on: todayOn, quantity: "2", unitPrice: "130,5", amount: "", fee: "1,50", note: "" },
      { kind: "sell", on: todayOn, quantity: "", unitPrice: "", amount: "250", fee: "", note: "" },
      { kind: "income", on: todayOn, quantity: "", unitPrice: "", amount: "3,20", fee: "", note: "dividend" },
      { kind: "close", on: todayOn, quantity: "7", unitPrice: "", amount: "720", fee: "", note: "" },
    ];
    for (const form of forms) {
      const before = await actions.recordOperation(alice, old.accountId, {
        ...form,
        holdingId: old.holdingId,
      });
      const after = await asPerson(bob, () =>
        calls.recordOperation(now.accountId, { ...form, holdingId: now.holdingId }),
      );
      expect(after).toEqual(before);
    }
    expect(await heldBy(bob, now.accountId)).toEqual(await heldBy(alice, old.accountId));
  });

  it("refuses the same fields with the same words", async () => {
    const old = await byAsset(alice);
    const now = await byAsset(bob);
    const refused: Omit<Typed, "holdingId">[] = [
      { kind: "valuation", on: todayOn, unitPrice: "abc", amount: "", quantity: "", fee: "", note: "" },
      { kind: "sell", on: "2999-01-01", quantity: "1", unitPrice: "100", amount: "", fee: "", note: "" },
      { kind: "income", on: todayOn, quantity: "", unitPrice: "", amount: "1,2,3", fee: "", note: "" },
    ];
    for (const form of refused) {
      const before = await actions.recordOperation(alice, old.accountId, {
        ...form,
        holdingId: old.holdingId,
      });
      const after = await asPerson(bob, () =>
        calls.recordOperation(now.accountId, { ...form, holdingId: now.holdingId }),
      );
      expect(before.ok).toBe(false);
      expect(after).toEqual(before);
    }
  });

  it("updates the value and the address of a manual service the same way", async () => {
    const old = await manualService(alice, { name: "Fineco", category: "broker", currency: "EUR" });
    const now = await manualService(bob, { name: "Fineco", category: "broker", currency: "EUR" });
    const value = { on: todayOn, amount: "12.650,40" };
    expect(await asPerson(bob, () => calls.updateServiceValue(now.accountId, value))).toEqual(
      await actions.updateServiceValue(alice, old.accountId, value),
    );
    expect(
      await asPerson(bob, () => calls.updateServiceValue(now.accountId, { on: todayOn, amount: " " })),
    ).toEqual(await actions.updateServiceValue(alice, old.accountId, { on: todayOn, amount: " " }));
    expect(await asPerson(bob, () => calls.updateServiceUrl(now.accountId, "www.fineco.it"))).toEqual(
      await actions.updateServiceUrl(alice, old.accountId, "www.fineco.it"),
    );
    expect(await heldBy(bob, now.accountId)).toEqual(await heldBy(alice, old.accountId));
  });

  it("makes the same manual service of an account, and refuses the same one twice", async () => {
    const old = await connectTarget(alice, { name: "Degiro", category: "broker", currency: "EUR" });
    const now = await connectTarget(bob, { name: "Degiro", category: "broker", currency: "EUR" });
    const input = (accountId: string) => ({ accountId, category: "broker" as const, url: "" });
    const before = await actions.createManualService(alice, input(old.accountId));
    const after = await asPerson(bob, () => calls.createManualService(input(now.accountId)));
    expect(after).toEqual({ ...before, accountId: now.accountId });
    expect(await asPerson(bob, () => calls.createManualService(input(now.accountId)))).toEqual(
      await actions.createManualService(alice, input(old.accountId)),
    );
    expect(await heldBy(bob, now.accountId)).toEqual(await heldBy(alice, old.accountId));
  });

  it("connects a provider's key the same way", async () => {
    const old = await connectTarget(alice, { name: "eToro", category: "broker", currency: "USD" });
    const now = await connectTarget(bob, { name: "eToro", category: "broker", currency: "USD" });
    const before = await actions.connectProvider(alice, old.accountId);
    const after = await asPerson(bob, () =>
      calls.connectProvider("etoro", { api_key: "fake-public", user_key: "fake-user" }, now.accountId),
    );
    expect(after).toEqual({ ...before, accountId: now.accountId });
    expect(await heldBy(bob, now.accountId)).toEqual(await heldBy(alice, old.accountId));
  });
});

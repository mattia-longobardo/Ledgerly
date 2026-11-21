// R3 parity of the writes of Funds (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case of the domain, the fields read in their number format — is what
// `calls.ts` does through the routes, on the same fields. The Server Actions are gone; `actions` is
// what they did, line for line. Alice takes the old path, Bob the new one; what each fund then holds
// is read from the same routes and compared without the ids.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import {
  newContributionForm,
  newFeeForm,
  newSourceForm,
  type ContributionForm,
  type FeeForm,
  type SourceForm,
  type WizardForm,
} from "@domain/modules/funds/forms";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const funds = await import("@ledgerly/domain/funds");
const { appliedPayslips } = await import("@ledgerly/domain/payroll");
const { parseAmount } = await import("@ledgerly/domain/platform/format");
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
});

// `call` of the API client reaches the routes as the browser would, under `/api/v1`.
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  if (url.startsWith("/api/v1/")) return routes.request(url.replace(/^\/api\/v1/, ""), init);
  throw new TypeError("fetch failed");
});

const contextFor = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

/** A call of `calls.ts` in the session of `ctx`. */
async function asPerson<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  session = ctx;
  return work();
}

/** The deleted Server Actions: the fields read on the server, the use case, the code of a refusal. */
const actions = (() => {
  function failed(error: unknown) {
    if (error instanceof funds.FundError)
      return { ok: false as const, error: error.code, detail: error.detail };
    if (error instanceof RangeError || (error instanceof Error && error.name === "ZodError"))
      return { ok: false as const, error: "invalid" };
    throw error;
  }
  async function run(work: () => Promise<string | void>) {
    try {
      const id = await work();
      return { ok: true as const, id };
    } catch (error) {
      return failed(error);
    }
  }
  const publish = async (ctx: Ctx, fundId: string) =>
    funds.replaceCompetences(ctx, fundId, funds.competencesFromPayslips(await appliedPayslips(ctx)));
  return {
    createFund: (ctx: Ctx, form: WizardForm) =>
      run(async () => {
        const fund = await funds.createFund(ctx, {
          fund: funds.fundInputOf(form.fund),
          currency: form.currency || null,
          value:
            form.value.trim() === ""
              ? null
              : { on: form.valueOn, cents: parseAmount(form.value, ctx.numberFormat) },
          sources: form.sources.map((source) => funds.sourceInputOf(source, ctx.numberFormat)),
          fees: form.fees.map((fee) => {
            const { sourceKey, ...input } = funds.feeInputOf(fee, ctx.numberFormat);
            return { ...input, sourceIndex: sourceKey === null ? null : Number(sourceKey.slice(1)) };
          }),
        });
        if (form.sources.some((source) => source.kind === "payroll")) await publish(ctx, fund.id);
        return fund.id;
      }),
    saveSource: (ctx: Ctx, fundId: string, form: SourceForm) =>
      run(async () => {
        const input = funds.sourceInputOf(form, ctx.numberFormat);
        if (form.id === null) await funds.addSource(ctx, fundId, input);
        else await funds.updateSource(ctx, form.id, input);
        if (form.kind === "payroll") await publish(ctx, fundId);
      }),
    saveFee: (ctx: Ctx, fundId: string, form: FeeForm) =>
      run(async () => {
        const { sourceKey, ...input } = funds.feeInputOf(form, ctx.numberFormat);
        const fee = { ...input, sourceId: sourceKey };
        if (form.id === null) await funds.addFee(ctx, fundId, fee);
        else await funds.updateFee(ctx, form.id, fee);
      }),
    saveContribution: (ctx: Ctx, fundId: string, form: ContributionForm) =>
      run(async () => {
        const input = funds.contributionInputOf(form, ctx.numberFormat);
        if (form.id === null) await funds.addContribution(ctx, fundId, input);
        else await funds.updateContribution(ctx, form.id, input);
      }),
    recordValuation: (ctx: Ctx, fundId: string, input: { on: string; value: string; note: string }) =>
      run(async () => {
        await funds.recordValuation(ctx, fundId, {
          on: input.on,
          cents: parseAmount(input.value, ctx.numberFormat),
          units: null,
          note: input.note,
        });
      }),
    updateFund: (ctx: Ctx, id: string, form: WizardForm["fund"]) =>
      run(async () => {
        await funds.updateFund(ctx, id, funds.fundInputOf(form));
      }),
  };
})();

/** Every id and the fund's own name out of an answer: what tells Alice's fund from Bob's. */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(^id|Id|accountName)$/.test(key))
      .map(([key, part]) => [key, plain(part)]),
  );
}

/** What a fund holds, as the routes answer it: its settings, its register and its values. */
async function heldBy(ctx: Ctx, fundId: string) {
  session = ctx;
  const get = async (path: string) => {
    const response = await routes.request(path);
    expect(response.status).toBe(200);
    return plain(await response.json());
  };
  return {
    settings: await get(`/funds/${fundId}/settings`),
    contributions: await get(`/funds/${fundId}/contributions?period=all`),
    valuations: await get(`/funds/${fundId}/valuations?period=all`),
  };
}

const FUND = { name: "Fondo", provider: "Previdenza", compartment: "", startOn: "2024-01-01", code: "" };

/** A fund with payments by hand, the same for both, made through the domain. */
async function manualFund(ctx: Ctx) {
  const fund = await funds.createFund(ctx, {
    fund: funds.fundInputOf(FUND),
    currency: null,
    value: null,
    sources: [{ kind: "manual" }],
    fees: [],
  });
  return fund.id;
}

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  // The format the screen reads the fields in: Bob's preferences, Alice's context alike.
  session = bob;
  const format = numberStyle(await read(profile.getPreferences, {}));
  alice = { ...alice, numberFormat: format };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDatabase();
});

describe("funds, old Server Action = new call", () => {
  it("creates the same fund from the same form", async () => {
    const payroll = { ...newSourceForm("payroll"), hasDue: true, dueDay: "20", toleranceDays: "10" };
    const debit = { ...newSourceForm("bank_debit"), amount: "1.234,50", debitDay: "5", payeeMatch: "Fondo" };
    const form: WizardForm = {
      fund: FUND,
      value: "10.000,25",
      valueOn: "2025-12-31",
      currency: "",
      sources: [payroll, debit],
      fees: [
        { ...newFeeForm(), label: "Quota", basis: "periodic", value: "12", period: "year", scope: "#0" },
        { ...newFeeForm(), label: "TFR", basis: "per_contribution", value: "1,5", scope: "#0:tfr" },
        {
          ...newFeeForm(),
          label: "Gestione",
          basis: "on_assets",
          mode: "rate",
          value: "0,45",
          period: "year",
        },
      ],
    };
    const old = await actions.createFund(alice, form);
    const created = await asPerson(bob, () => calls.createFundAction(form));
    expect(old.ok && created).toMatchObject({ ok: true, count: 0 });
    if (!old.ok || !created.ok) return;
    expect(await heldBy(bob, created.id!)).toEqual(await heldBy(alice, old.id!));
  });

  it("refuses the same fields with the same words", async () => {
    const future = { ...FUND, startOn: "2999-01-01" };
    const form: WizardForm = { fund: future, value: "", valueOn: "", currency: "", sources: [], fees: [] };
    const old = await actions.createFund(alice, form);
    expect(old).toMatchObject({ ok: false, error: "future_date" });
    expect(await asPerson(bob, () => calls.createFundAction(form))).toEqual({
      ok: false,
      error: "future_date",
    });
    const unreadable = { ...newSourceForm("bank_debit"), amount: "dodici", payeeMatch: "x" };
    const [oldFund, newFund] = [await manualFund(alice), await manualFund(bob)];
    expect(await asPerson(bob, () => calls.saveSourceAction(newFund, unreadable))).toEqual(
      await actions.saveSource(alice, oldFund, unreadable),
    );
    const rate = {
      ...newFeeForm(),
      label: "Troppo",
      basis: "on_assets" as const,
      mode: "rate" as const,
      value: "150",
    };
    expect(await asPerson(bob, () => calls.saveFeeAction(newFund, rate))).toEqual(
      await actions.saveFee(alice, oldFund, rate),
    );
  });

  it("writes the same register, values, sources and fees", async () => {
    const [oldFund, newFund] = [await manualFund(alice), await manualFund(bob)];
    const both = async (
      old: (ctx: Ctx, fundId: string) => Promise<{ ok: boolean }>,
      now: (fundId: string) => Promise<{ ok: boolean }>,
    ) => {
      const answer = await old(alice, oldFund);
      expect(await asPerson(bob, () => now(newFund))).toMatchObject({ ok: answer.ok });
    };
    const voluntary = { ...newContributionForm("voluntary", "2025-03-10"), amount: "1.000,00", fee: "2,50" };
    const enrollment = {
      ...newContributionForm("other", "2025-01-15"),
      classification: "enrollment" as const,
      amount: "25",
      period: "2025-1",
      feeUnknown: true,
    };
    const withdrawal = { ...newContributionForm("other", "2025-06-01"), amount: "300,10", note: "Anticipo" };
    for (const form of [voluntary, enrollment, withdrawal]) {
      await both(
        (ctx, id) => actions.saveContribution(ctx, id, form),
        (id) => calls.saveContributionAction(id, form),
      );
    }
    const value = { on: "2025-12-31", value: "1.500,75", note: "Estratto" };
    await both(
      (ctx, id) => actions.recordValuation(ctx, id, value),
      (id) => calls.recordValuationAction(id, value),
    );
    const debit = {
      ...newSourceForm("bank_debit"),
      amount: "50",
      frequencyCount: "3",
      frequencyUnit: "month" as const,
      payeeMatch: "Previdenza",
      validFrom: "2025-01-01",
    };
    await both(
      (ctx, id) => actions.saveSource(ctx, id, debit),
      (id) => calls.saveSourceAction(id, debit),
    );
    const fee = { ...newFeeForm(), label: "Ingresso", basis: "one_off" as const, value: "10" };
    await both(
      (ctx, id) => actions.saveFee(ctx, id, fee),
      (id) => calls.saveFeeAction(id, fee),
    );
    const renamed = { ...FUND, provider: "Altra", code: "IT0001" };
    await both(
      (ctx, id) => actions.updateFund(ctx, id, renamed),
      (id) => calls.updateFundAction(id, renamed),
    );
    const held = await heldBy(bob, newFund);
    expect(held.contributions).toMatchObject({ operations: [{}, {}, {}] });
    expect(held).toEqual(await heldBy(alice, oldFund));
  });

  it("puts back a removed source with its fees, as «Undo» sends the answer back", async () => {
    const fundId = await manualFund(bob);
    const debit = { ...newSourceForm("bank_debit"), amount: "50", payeeMatch: "Previdenza" };
    await asPerson(bob, () => calls.saveSourceAction(fundId, debit));
    session = bob;
    const settings = await (await routes.request(`/funds/${fundId}/settings`)).json();
    const source = settings.sources.find((one: { kind: string }) => one.kind === "bank_debit");
    const fee: FeeForm = { ...newFeeForm(), label: "Per versamento", value: "1", scope: source.id };
    await asPerson(bob, () => calls.saveFeeAction(fundId, fee));
    const before = await heldBy(bob, fundId);

    const removed = await asPerson(bob, () => calls.removeSourceAction(fundId, source.id));
    expect(removed.ok).toBe(true);
    expect(await heldBy(bob, fundId)).not.toEqual(before);
    if (!removed.ok) return;
    expect(await asPerson(bob, () => calls.restoreSourceAction(fundId, removed.removed))).toEqual({
      ok: true,
      id: fundId,
    });
    expect(await heldBy(bob, fundId)).toEqual(before);
  });
});

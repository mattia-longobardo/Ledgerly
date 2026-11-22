// R3 parity of the writes of Funds (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case of the domain, on the fields read in their number format — is what
// `calls.ts` does through the routes, on the same fields. The Server Actions are gone; `actions` is
// the use case they ran, given the input they read from the fields. Alice takes the old path, Bob the
// new one; what each fund then holds is read from the same routes and compared without the ids.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import {
  newContributionForm,
  newFeeForm,
  newSourceForm,
  type ContributionForm,
  type FeeForm,
  type WizardForm,
} from "@domain/modules/funds/forms";
import type { ContributionInput, FeeInput, FundInput, SourceInput } from "@domain/modules/funds/service";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const funds = await import("@ledgerly/domain/funds");
const { appliedPayslips } = await import("@ledgerly/domain/payroll");
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

/** The deleted Server Actions: the use case on the input read from the fields, the code of a refusal. */
const actions = (() => {
  function failed(error: unknown) {
    if (error instanceof funds.FundError)
      return { ok: false as const, error: error.code, detail: error.detail };
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
    createFund: (ctx: Ctx, input: Parameters<typeof funds.createFund>[1]) =>
      run(async () => {
        const fund = await funds.createFund(ctx, input);
        if (input.sources.some((source) => source.kind === "payroll")) await publish(ctx, fund.id);
        return fund.id;
      }),
    addSource: (ctx: Ctx, fundId: string, input: SourceInput) =>
      run(async () => {
        await funds.addSource(ctx, fundId, input);
      }),
    addFee: (ctx: Ctx, fundId: string, input: FeeInput) =>
      run(async () => {
        await funds.addFee(ctx, fundId, input);
      }),
    addContribution: (ctx: Ctx, fundId: string, input: ContributionInput) =>
      run(async () => {
        await funds.addContribution(ctx, fundId, input);
      }),
    recordValuation: (ctx: Ctx, fundId: string, input: { on: string; cents: bigint; note: string }) =>
      run(async () => {
        await funds.recordValuation(ctx, fundId, { ...input, units: null });
      }),
    updateFund: (ctx: Ctx, id: string, input: FundInput) =>
      run(async () => {
        await funds.updateFund(ctx, id, input);
      }),
  };
})();

/** What a Server Action answered for a field it could not read. */
const UNREADABLE = { ok: false, error: "invalid" };

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
    fund: FUND,
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
    const old = await actions.createFund(alice, {
      fund: FUND,
      currency: null,
      value: { on: "2025-12-31", cents: 1000025n },
      sources: [
        {
          kind: "payroll",
          components: ["worker", "employer", "tfr"],
          accrualPeriod: "month",
          employer: "",
          due: { day: 20, offsetMonths: 1 },
          toleranceDays: 10,
          note: "",
          keepDueEntries: false,
        },
        {
          kind: "bank_debit",
          amountCents: 123450n,
          frequency: { count: 1, unit: "month" },
          debitDay: 5,
          accountId: null,
          payeeMatch: "Fondo",
          validFrom: null,
          validTo: null,
        },
      ],
      fees: [
        {
          label: "Quota",
          basis: "periodic",
          amountCents: 1200n,
          rate: null,
          period: "year",
          sourceIndex: 0,
          component: null,
          validFrom: null,
          validTo: null,
          note: "",
        },
        {
          label: "TFR",
          basis: "per_contribution",
          amountCents: 150n,
          rate: null,
          period: null,
          sourceIndex: 0,
          component: "tfr",
          validFrom: null,
          validTo: null,
          note: "",
        },
        {
          label: "Gestione",
          basis: "on_assets",
          amountCents: null,
          rate: "0.004500",
          period: "year",
          sourceIndex: null,
          component: null,
          validFrom: null,
          validTo: null,
          note: "",
        },
      ],
    });
    const created = await asPerson(bob, () => calls.createFundAction(form));
    expect(old.ok && created).toMatchObject({ ok: true, count: 0 });
    if (!old.ok || !created.ok) return;
    expect(await heldBy(bob, created.id!)).toEqual(await heldBy(alice, old.id!));
  });

  it("refuses the same fields with the same words", async () => {
    const future = { ...FUND, startOn: "2999-01-01" };
    const form: WizardForm = { fund: future, value: "", valueOn: "", currency: "", sources: [], fees: [] };
    const old = await actions.createFund(alice, {
      fund: future,
      currency: null,
      value: null,
      sources: [],
      fees: [],
    });
    expect(old).toMatchObject({ ok: false, error: "future_date" });
    expect(await asPerson(bob, () => calls.createFundAction(form))).toEqual({
      ok: false,
      error: "future_date",
    });
    const unreadable = { ...newSourceForm("bank_debit"), amount: "dodici", payeeMatch: "x" };
    const newFund = await manualFund(bob);
    expect(await asPerson(bob, () => calls.saveSourceAction(newFund, unreadable))).toEqual(UNREADABLE);
    const rate = {
      ...newFeeForm(),
      label: "Troppo",
      basis: "on_assets" as const,
      mode: "rate" as const,
      value: "150",
    };
    expect(await asPerson(bob, () => calls.saveFeeAction(newFund, rate))).toEqual(UNREADABLE);
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
    const inputs: [ContributionForm, ContributionInput][] = [
      [
        voluntary,
        {
          kind: "voluntary",
          on: "2025-03-10",
          amountCents: 100000n,
          feeCents: 250n,
          transactionId: null,
          note: "",
        },
      ],
      [
        enrollment,
        {
          kind: "other",
          classification: "enrollment",
          on: "2025-01-15",
          amountCents: 2500n,
          period: { year: 2025, index: 1 },
          feeCents: null,
          note: "",
        },
      ],
      [
        withdrawal,
        {
          kind: "other",
          classification: "withdrawal",
          on: "2025-06-01",
          amountCents: 30010n,
          period: null,
          feeCents: 0n,
          note: "Anticipo",
        },
      ],
    ];
    for (const [form, input] of inputs) {
      await both(
        (ctx, id) => actions.addContribution(ctx, id, input),
        (id) => calls.saveContributionAction(id, form),
      );
    }
    const value = { on: "2025-12-31", value: "1.500,75", note: "Estratto" };
    await both(
      (ctx, id) => actions.recordValuation(ctx, id, { on: "2025-12-31", cents: 150075n, note: "Estratto" }),
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
      (ctx, id) =>
        actions.addSource(ctx, id, {
          kind: "bank_debit",
          amountCents: 5000n,
          frequency: { count: 3, unit: "month" },
          debitDay: null,
          accountId: null,
          payeeMatch: "Previdenza",
          validFrom: "2025-01-01",
          validTo: null,
        }),
      (id) => calls.saveSourceAction(id, debit),
    );
    const fee = { ...newFeeForm(), label: "Ingresso", basis: "one_off" as const, value: "10" };
    await both(
      (ctx, id) =>
        actions.addFee(ctx, id, {
          label: "Ingresso",
          basis: "one_off",
          amountCents: 1000n,
          rate: null,
          period: null,
          sourceId: null,
          component: null,
          validFrom: null,
          validTo: null,
          note: "",
        }),
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

/**
 * The forms the screens open from a row of `/api/v1` are the ones the server pages opened from the
 * database: the same text in every field.
 */
describe("funds, the forms of a stored row = the forms of its wire row", () => {
  it("opens every source, fee and operation with the same fields", async () => {
    const wire = await import("./ui/wire-forms");
    const format = alice.numberFormat;
    const fund = await funds.createFund(alice, {
      fund: FUND,
      currency: null,
      value: null,
      sources: [
        {
          kind: "payroll",
          components: ["worker", "tfr"],
          accrualPeriod: "quarter",
          employer: "Datore",
          due: { day: 20, offsetMonths: 1 },
          toleranceDays: 10,
          note: "Nota",
          keepDueEntries: false,
        },
        {
          kind: "bank_debit",
          amountCents: 123450n,
          frequency: { count: 3, unit: "month" },
          debitDay: 5,
          accountId: null,
          payeeMatch: "Previdenza",
          validFrom: "2024-02-01",
          validTo: null,
        },
        { kind: "manual" },
      ],
      fees: [
        {
          label: "Quota",
          basis: "periodic",
          amountCents: 1200n,
          rate: null,
          period: "year",
          sourceIndex: 0,
          component: null,
          validFrom: null,
          validTo: null,
          note: "",
        },
        {
          label: "TFR",
          basis: "per_contribution",
          amountCents: null,
          rate: "0.0015",
          period: null,
          sourceIndex: 0,
          component: "tfr",
          validFrom: null,
          validTo: "2025-12-31",
          note: "x",
        },
        {
          label: "Gestione",
          basis: "on_assets",
          amountCents: null,
          rate: "0.0045",
          period: "year",
          sourceIndex: null,
          component: null,
          validFrom: "2024-01-01",
          validTo: null,
          note: "",
        },
      ],
    });
    const operations: ContributionInput[] = [
      {
        kind: "voluntary",
        on: "2025-03-10",
        amountCents: 100000n,
        feeCents: 250n,
        transactionId: null,
        note: "",
      },
      {
        kind: "other",
        classification: "withdrawal",
        on: "2025-06-01",
        amountCents: 30010n,
        period: null,
        feeCents: null,
        note: "",
      },
      {
        kind: "payroll",
        on: "2025-04-20",
        workerCents: 10000n,
        employerCents: 0n,
        tfrCents: 5050n,
        period: { year: 2025, index: 1 },
        feeCents: 0n,
        note: "",
      },
    ];
    for (const input of operations) await funds.addContribution(alice, fund.id, input);
    session = alice;
    const contract = (await import("@ledgerly/api-contract/funds")).funds;
    const settings = contract.getFundSettings.response.parse(
      await (await routes.request(`/funds/${fund.id}/settings`)).json(),
    );
    const register = contract.getFundContributions.response.parse(
      await (await routes.request(`/funds/${fund.id}/contributions?period=all`)).json(),
    );

    const byType = <T>(rows: readonly T[], type: (row: T) => string) =>
      [...rows].sort((a, b) => (type(a) < type(b) ? -1 : 1));
    const id = expect.any(String);
    const payrollId = settings.sources.find((one) => one.kind === "payroll")!.id;
    const source = {
      state: "active",
      components: ["worker", "employer", "tfr"],
      accrualPeriod: "month",
      employer: "",
      hasDue: false,
      dueDay: "",
      dueOffsetMonths: "1",
      toleranceDays: "15",
      note: "",
      customDue: false,
      amount: "",
      frequencyCount: "1",
      frequencyUnit: "month",
      debitDay: "",
      accountId: "",
      payeeMatch: "",
      validFrom: "",
      validTo: "",
    };
    const sourceForms = settings.sources.map((row) => wire.sourceFormOfRow(row, format));
    expect(byType(sourceForms, (form) => form.kind)).toEqual([
      {
        ...source,
        id,
        kind: "bank_debit",
        amount: "1234,50",
        frequencyCount: "3",
        debitDay: "5",
        payeeMatch: "Previdenza",
        validFrom: "2024-02-01",
      },
      { ...source, id, kind: "manual" },
      {
        ...source,
        id,
        kind: "payroll",
        components: ["worker", "tfr"],
        accrualPeriod: "quarter",
        employer: "Datore",
        hasDue: true,
        dueDay: "20",
        toleranceDays: "10",
        note: "Nota",
      },
    ]);
    const feeForms = settings.fees.map((row) => wire.feeFormOfRow(row, format));
    expect(byType(feeForms, (form) => form.basis)).toEqual([
      {
        id,
        label: "Gestione",
        basis: "on_assets",
        mode: "rate",
        value: "0,45",
        period: "year",
        scope: "",
        validFrom: "2024-01-01",
        validTo: "",
        note: "",
      },
      {
        id,
        label: "TFR",
        basis: "per_contribution",
        mode: "rate",
        value: "0,15",
        period: "year",
        scope: `${payrollId}:tfr`,
        validFrom: "",
        validTo: "2025-12-31",
        note: "x",
      },
      {
        id,
        label: "Quota",
        basis: "periodic",
        mode: "amount",
        value: "12,00",
        period: "year",
        scope: payrollId,
        validFrom: "",
        validTo: "",
        note: "",
      },
    ]);
    const operation = {
      id,
      classification: "withdrawal",
      amount: "",
      worker: "",
      employer: "",
      tfr: "",
      period: "",
      fee: "",
      feeUnknown: false,
      transactionId: "",
      note: "",
    };
    const operationForms = register.operations.map((row) => wire.contributionFormOfRow(row, format));
    expect(byType(operationForms, (form) => form.kind)).toEqual([
      { ...operation, kind: "other", on: "2025-06-01", amount: "300,10", feeUnknown: true },
      {
        ...operation,
        kind: "payroll",
        on: "2025-04-20",
        worker: "100,00",
        tfr: "50,50",
        period: "2025-1",
        fee: "0,00",
      },
      { ...operation, kind: "voluntary", on: "2025-03-10", amount: "1000,00", fee: "2,50" },
    ]);

    // The live preview of the source dialog (an exception of the orchestrator: `nextDueDates` of
    // `funds/client`) says the due dates the server answers for the stored source.
    const { nextDueDates } = await import("@ledgerly/domain/funds/client");
    const { calendarOfForm } = await import("./ui/source-text");
    const { today } = await import("@domain/shared/dates");
    const payslip = settings.sources.find((one) => one.kind === "payroll")!;
    const form = wire.sourceFormOfRow(payslip, format);
    expect(payslip.nextDue.length).toBeGreaterThan(0);
    expect(nextDueDates(form.accrualPeriod, calendarOfForm(form), today(alice.timeZone))).toEqual(
      payslip.nextDue,
    );
  });
});

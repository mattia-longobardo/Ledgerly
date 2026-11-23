// R3 parity of Interests (03-releases.md §R3, criterion 11). The writes: what a Server Action did with
// what a person typed (thresholds and rates read in their number format on the server) is what the
// route does with the body the dialog now sends (`calls.ts`: the same text, read on the client). The
// two posting actions called the same use case as their routes, with the same arguments
// (`apps/api/src/interests/routes.ts`). The Server Actions are gone; `actions` is what they did, line
// for line.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Ctx } from "@domain/platform/context";
import type { PlainRule } from "@ledgerly/domain/interests";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { readRate } from "./ui/present";

let ctx: Ctx;

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const interests = await import("@ledgerly/domain/interests");

async function send(method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

/** A manual savings account with a balance since 2025. */
async function account(name: string): Promise<string> {
  const created = await send("POST", "/accounts", {
    name,
    type: "savings",
    openingBalance: { on: "2025-12-01", amount: "10000" },
  });
  expect(created.status).toBe(201);
  return created.body.id;
}

let oldAccount: string;
let newAccount: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
  // The server reads the person's format from their preferences; the client reads the same route.
  ctx.numberFormat = numberStyle((await send("GET", "/preferences")).body);
  oldAccount = await account("Old");
  newAccount = await account("New");
});

afterAll(closeDatabase);

interface Form {
  accountId: string;
  validFrom: string;
  validTo: string;
  runHour: string;
  tiers: { upTo: string; rate: string }[];
  tax: string;
  dayBasis: string;
  settlement: string;
  payeeMatch: string;
  publish: boolean;
  categoryId: string;
  active: boolean;
}

/** The dialog's fields as typed, in the Italian format. */
const typed = (accountId: string, overrides: Partial<Form> = {}): Form => ({
  accountId,
  validFrom: "2026-01-01",
  validTo: "",
  runHour: "",
  tiers: [
    { upTo: "1.002,5", rate: "2,75" },
    { upTo: "", rate: "1,5" },
  ],
  tax: "26",
  dayBasis: "365",
  settlement: "quarterly",
  payeeMatch: " INTEREST ",
  publish: false,
  categoryId: "",
  active: true,
  ...overrides,
});

/** The body `calls.ts` builds from the same fields. */
function wire(input: Form) {
  const rate = (text: string) => readRate(text, ctx.numberFormat);
  const last = input.tiers.length - 1;
  return {
    accountId: input.accountId,
    validFrom: input.validFrom,
    validTo: input.validTo === "" ? null : input.validTo,
    runHour: input.runHour === "" ? null : Number(input.runHour),
    tiers: input.tiers.map((tier, index) => ({
      upTo: index === last ? null : centsToDecimal(parseAmount(tier.upTo, ctx.numberFormat)),
      rate: rate(tier.rate),
    })),
    tax: rate(input.tax === "" ? "0" : input.tax),
    dayBasis: input.dayBasis,
    settlement: input.settlement,
    payeeMatch: input.payeeMatch,
    mode: input.publish ? "post_to_provider" : "analyze_only",
    categoryId: input.categoryId === "" ? null : input.categoryId,
    state: input.active ? "active" : "paused",
  };
}

/** The deleted Server Actions: the typed text read on the server, the use case, the code of a refusal. */
const actions = (() => {
  const toInput = (input: Form) => {
    const plain: PlainRule = {
      accountId: input.accountId,
      validFrom: input.validFrom,
      validTo: input.validTo === "" ? null : input.validTo,
      runHour: input.runHour === "" ? null : z.coerce.number().int().min(0).max(23).parse(input.runHour),
      tiers: input.tiers.map((tier, index) => ({
        upTo:
          index === input.tiers.length - 1 ? null : centsToDecimal(parseAmount(tier.upTo, ctx.numberFormat)),
        rate: readRate(tier.rate, ctx.numberFormat),
      })),
      tax: readRate(input.tax === "" ? "0" : input.tax, ctx.numberFormat),
      dayBasis: z.enum(interests.DAY_BASES).parse(input.dayBasis),
      settlement: z.enum(interests.SETTLEMENTS).parse(input.settlement),
      payeeMatch: input.payeeMatch,
      mode: input.publish ? "post_to_provider" : "analyze_only",
      categoryId: input.categoryId === "" ? null : z.uuid().parse(input.categoryId),
      state: input.active ? "active" : "paused",
    };
    return interests.ruleInputOf(plain);
  };
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      return { ok: true };
    } catch (error) {
      if (error instanceof interests.InterestError) return { ok: false, error: error.code };
      if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
      throw error;
    }
  };
  return {
    createRuleAction: (input: Form) => run(() => interests.createRule(ctx, toInput(input))),
    updateRuleAction: (id: string, input: Form) => run(() => interests.updateRule(ctx, id, toInput(input))),
    setRuleStateAction: (id: string, state: "active" | "paused") =>
      run(() => interests.setRuleState(ctx, id, state)),
  };
})();

/** The rule on an account as the list reads it, without what says which path wrote it. */
async function ruleOn(accountId: string) {
  const view = (await send("GET", "/interests")).body;
  const rule = view.rules.find((row: { accountId: string }) => row.accountId === accountId);
  return { ...rule, id: undefined, accountId: undefined, account: undefined };
}

async function idOn(accountId: string): Promise<string> {
  const view = (await send("GET", "/interests")).body;
  return view.rules.find((row: { accountId: string }) => row.accountId === accountId).id;
}

async function expectSame() {
  const byAction = await ruleOn(oldAccount);
  expect(byAction.tiers).toHaveLength(2);
  expect(await ruleOn(newAccount)).toEqual(byAction);
}

describe("interests, old Server Action = new call", () => {
  it("creates and edits a rule from text typed in the person's format", async () => {
    expect(await actions.createRuleAction(typed(oldAccount))).toEqual({ ok: true });
    expect((await send("POST", "/interests", wire(typed(newAccount)))).status).toBe(201);
    await expectSame();

    const changes: Partial<Form> = {
      tiers: [
        { upTo: "20.000", rate: "3" },
        { upTo: "50.000,00", rate: "2,125" },
        { upTo: "", rate: "0,5" },
      ],
      tax: "",
      runHour: "7",
      validTo: "2027-06-30",
      dayBasis: "360",
      settlement: "annual",
      payeeMatch: "",
      active: false,
    };
    expect(await actions.updateRuleAction(await idOn(oldAccount), typed(oldAccount, changes))).toEqual({
      ok: true,
    });
    const id = await idOn(newAccount);
    expect((await send("PUT", `/interests/${id}`, wire(typed(newAccount, changes)))).status).toBe(204);
    const byAction = await ruleOn(oldAccount);
    expect(byAction.tiers).toHaveLength(3);
    expect(await ruleOn(newAccount)).toEqual(byAction);
  });

  it("pauses and resumes alike", async () => {
    await actions.createRuleAction(typed(oldAccount));
    await send("POST", "/interests", wire(typed(newAccount)));
    for (const state of ["paused", "active"] as const) {
      expect(await actions.setRuleStateAction(await idOn(oldAccount), state)).toEqual({ ok: true });
      expect((await send("PUT", `/interests/${await idOn(newAccount)}/state`, { state })).status).toBe(204);
      await expectSame();
    }
  });

  it("refuses what the action refused", async () => {
    const unknownAccount = typed(crypto.randomUUID());
    expect(await actions.createRuleAction(unknownAccount)).toEqual({ ok: false, error: "invalid_account" });
    expect((await send("POST", "/interests", wire(unknownAccount))).body).toMatchObject({
      reason: "invalid_account",
    });

    // A rule that publishes is retired (H37, ST-14): the action refused it, the route answers 422.
    const publishes = typed(oldAccount, { publish: true });
    expect(await actions.createRuleAction(publishes)).toEqual({ ok: false, error: "mode_retired" });
    expect(await send("POST", "/interests", wire(publishes))).toEqual({
      status: 422,
      body: { error: "mode_retired" },
    });
  });
});

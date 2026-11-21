// R3 parity of Subscriptions (03-releases.md §R3, criterion 11). The writes: what a Server Action did
// with what a person typed (the price and the tolerance read in their number format on the server) is
// what the route does with the body the dialog now sends (`calls.ts`: the same text, read on the
// client). The export: the old route handler's file is the file the browser now writes from
// `GET /subscriptions` (`ui/export-csv.ts`, audit UI-SUB-2). The Server Actions and the route handler
// are gone; `oldWrite` and `oldCsv` are what they did, line for line.
import { createTranslator } from "next-intl";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@ledgerly/format/cents";
import { today } from "@ledgerly/format/dates";
import { formatAmountInput, numberStyle, parseAmount } from "@ledgerly/format/format";
import messages from "../../../../../messages/en.json";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

let ctx: Ctx;

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const subscriptions = await import("@ledgerly/domain/subscriptions");
const { subscriptionsCsv } = await import("./ui/export-csv");
const { csvDocument } = await import("@ledgerly/format/csv");

let todayOn: string;

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
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

/** A typed number as the client now sends it (`calls.ts`). */
const decimal = (typed: string) => centsToDecimal(parseAmount(typed, ctx.numberFormat));

/** The dialog's fields as typed; `name` tells the two paths apart. */
const typed = (name: string, overrides: Partial<Record<string, string | number | null>> = {}) => ({
  name,
  categoryId: null,
  paymentAccountId: null,
  price: "1.234,5",
  cycle: "quarterly" as const,
  nextChargeOn: todayOn,
  payeeMatch: " Netflix ",
  tolerance: "2,5",
  utility: 7,
  ...overrides,
});

/** The body `calls.ts` builds from the same fields. */
function wire(form: ReturnType<typeof typed>) {
  const match = String(form.payeeMatch ?? "").trim();
  return {
    name: form.name,
    categoryId: form.categoryId || null,
    accountId: form.paymentAccountId || null,
    price: decimal(String(form.price)),
    cycle: form.cycle,
    chargeOn: form.nextChargeOn,
    payeeMatch: match === "" ? null : match,
    tolerance: String(form.tolerance).trim() === "" ? undefined : decimal(String(form.tolerance)),
    utility: form.utility,
  };
}

type Form = ReturnType<typeof typed>;

/** The deleted Server Actions: the typed text read on the server, the use case, the code of a refusal. */
const actions = (() => {
  const plainPercent = (percent: string) =>
    percent.trim() === "" ? undefined : centsToDecimal(parseAmount(percent, ctx.numberFormat));
  const toInput = (input: Form) => ({
    name: input.name,
    categoryId: input.categoryId || null,
    paymentAccountId: input.paymentAccountId || null,
    priceCents: parseAmount(String(input.price), ctx.numberFormat),
    cycle: input.cycle,
    nextChargeOn: input.nextChargeOn,
    payeeMatch: String(input.payeeMatch ?? ""),
    tolerance: subscriptions.toleranceOf(plainPercent(String(input.tolerance))),
    utility: Number(input.utility),
  });
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      return { ok: true };
    } catch (error) {
      if (error instanceof subscriptions.SubscriptionError) return { ok: false, error: error.code };
      throw error;
    }
  };
  return {
    createSubscriptionAction: (input: Form) =>
      run(() => subscriptions.createSubscription(ctx, toInput(input))),
    updateSubscriptionAction: (id: string, input: Form) =>
      run(() => subscriptions.updateSubscription(ctx, id, toInput(input))),
    setSubscriptionStateAction: (id: string, state: "active" | "paused" | "cancelled") =>
      run(() => subscriptions.setSubscriptionState(ctx, id, state)),
    deleteSubscriptionAction: (id: string) => run(() => subscriptions.deleteSubscription(ctx, id)),
  };
})();

/** The deleted route handler `subscriptions/export.csv`: the rows of `subscriptionsView`. */
async function oldCsv(t: ReturnType<typeof createTranslator<typeof messages, "subscriptions">>) {
  const view = await subscriptions.subscriptionsView(ctx);
  const amount = (cents: bigint) => formatAmountInput(cents, ctx.numberFormat);
  const header = ["name", "category", "utility", "price", "billing", "paidFrom", "monthly", "yearly"]
    .concat(["nextCharge", "state", "status"])
    .map((key) => t(`csv.${key}` as "csv.name"));
  const rows = [...view.rows, ...view.inactive].map((row) => [
    row.subscription.name,
    row.categoryName ?? "",
    row.subscription.utility,
    amount(row.subscription.priceCents),
    t(`cycles.${row.subscription.cycle}`),
    row.accountName ?? "",
    amount(row.monthlyCents),
    amount(row.yearlyCents),
    row.nextChargeOn,
    row.subscription.state,
    row.current?.state ?? "",
  ]);
  return csvDocument(header, rows);
}

/** Every subscription as the page reads it, without what says which path wrote it. */
async function rows() {
  const view = (await send("GET", "/subscriptions")).body;
  return [...view.subscriptions, ...view.inactive]
    .map((row) => ({ ...row, id: undefined, current: row.current && { ...row.current, id: 0 } }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function idOf(name: string): Promise<string> {
  const view = (await send("GET", "/subscriptions")).body;
  return [...view.subscriptions, ...view.inactive].find((row) => row.name === name).id;
}

/** The two rows, named alike, are equal. */
async function expectSame() {
  const [byRoute, byAction] = await rows();
  expect({ ...byRoute, name: "" }).toEqual({ ...byAction, name: "" });
}

describe("subscriptions, old Server Action = new call", () => {
  it("creates and edits a subscription from text typed in the person's format", async () => {
    expect(await actions.createSubscriptionAction(typed("A old"))).toEqual({ ok: true });
    expect((await send("POST", "/subscriptions", wire(typed("A new")))).status).toBe(201);
    await expectSame();

    const changes = { price: "9,99", tolerance: "", payeeMatch: "", cycle: "weekly", utility: 3 };
    expect(await actions.updateSubscriptionAction(await idOf("A old"), typed("A old", changes))).toEqual({
      ok: true,
    });
    const id = await idOf("A new");
    expect((await send("PUT", `/subscriptions/${id}`, wire(typed("A new", changes) as never))).status).toBe(
      204,
    );
    await expectSame();
  });

  it("pauses, cancels and deletes alike", async () => {
    await actions.createSubscriptionAction(typed("A old"));
    await send("POST", "/subscriptions", wire(typed("A new")));
    const old = await idOf("A old");
    const id = await idOf("A new");
    for (const state of ["paused", "cancelled"] as const) {
      expect(await actions.setSubscriptionStateAction(old, state)).toEqual({ ok: true });
      expect((await send("PUT", `/subscriptions/${id}/state`, { state })).status).toBe(204);
      await expectSame();
    }
    expect(await actions.deleteSubscriptionAction(old)).toEqual({ ok: true });
    expect((await send("DELETE", `/subscriptions/${id}`)).status).toBe(204);
    expect(await rows()).toEqual([]);
  });

  it("refuses what the action refused", async () => {
    const unknownAccount = typed("X", { paymentAccountId: crypto.randomUUID() });
    expect(await actions.createSubscriptionAction(unknownAccount)).toEqual({
      ok: false,
      error: "invalid_account",
    });
    expect((await send("POST", "/subscriptions", wire(unknownAccount))).body).toMatchObject({
      reason: "invalid_account",
    });
  });
});

describe("the export, old route handler = file written in the browser", () => {
  it("writes the same file", async () => {
    await actions.createSubscriptionAction(typed("Netflix", { price: "12,99", cycle: "monthly" }));
    await actions.createSubscriptionAction(typed('Gym; "Pro"', { payeeMatch: "", cycle: "yearly" }));
    await actions.createSubscriptionAction(typed("Old", { cycle: "weekly" }));
    await actions.setSubscriptionStateAction(await idOf("Old"), "paused");

    const t = createTranslator({ locale: "en", messages, namespace: "subscriptions" });
    const old = await oldCsv(t);
    const view = (await send("GET", "/subscriptions")).body;
    const prefs = (await send("GET", "/preferences")).body;
    expect(subscriptionsCsv(view, t as never, numberStyle(prefs))).toBe(old);
    expect(old).toContain("Netflix");
  });
});

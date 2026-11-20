// R3 parity of the budgets' writes (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case, the limit read in their number format on the server — is what
// the route does with the body the screen now sends (`calls.ts`: the same text, read on the client).
// Two categories alike: the old path writes the budget of one, the new path the budget of the other.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@ledgerly/format/cents";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const budgets = await import("@ledgerly/domain/budgets");
const transactions = await import("@ledgerly/domain/transactions");

const MONTH = "2026-03-01";
let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});

afterAll(closeDatabase);

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
  return response.status;
}

async function pair() {
  const make = (name: string) =>
    transactions.createCategory(ctx, { name, parentId: "", type: "expense", color: null });
  return { old: (await make("Old")).id, now: (await make("New")).id };
}

/** A budget as both paths leave it, in a month, without the category that says which path wrote it. */
async function budgetOf(categoryId: string, month = MONTH) {
  const view = await budgets.budgetsView(ctx, month);
  const row = view.rows.find((one) => one.categoryId === categoryId && one.accountId === null);
  const detail = row ? await budgets.budgetDetail(ctx, { categoryId, accountId: null }, month) : null;
  return row
    ? { limit: row.limitCents, status: row.status, percent: row.percent, alerts: detail?.alerts }
    : null;
}

describe("budgets, old Server Action = new call", () => {
  it("sets a limit typed in the person's format, changes it and stops it", async () => {
    const { old, now } = await pair();
    for (const typed of ["1.234,5", "80"]) {
      await budgets.setLimit(ctx, {
        categoryId: old,
        accountId: null,
        month: MONTH,
        cents: parseAmount(typed, ctx.numberFormat),
      });
      const amount = centsToDecimal(parseAmount(typed, ctx.numberFormat));
      expect(await send("PUT", `/budgets/${now}_all/limit`, { month: MONTH, amount })).toBe(204);
      expect(await budgetOf(now)).toEqual(await budgetOf(old));
    }

    const next = "2026-04-01";
    await budgets.stopLimit(ctx, { categoryId: old, accountId: null, month: next });
    expect(await send("POST", `/budgets/${now}_all/stop`, { month: next })).toBe(204);
    expect(await budgetOf(now, next)).toEqual(await budgetOf(old, next));
    expect(await budgetOf(now)).toEqual(await budgetOf(old));
    expect(await budgetOf(now, next)).toBeNull();
  });

  it("saves the alerts sorted and without repeats", async () => {
    const { old, now } = await pair();
    for (const categoryId of [old, now]) {
      await budgets.setLimit(ctx, { categoryId, accountId: null, month: MONTH, cents: 30000n });
    }
    const settings = { enabled: true, thresholds: [100, 85, 85] };
    await budgets.saveAlerts(ctx, { categoryId: old, accountId: null, ...settings });
    expect(await send("PUT", `/budgets/${now}_all/alerts`, settings)).toBe(200);
    expect(await budgetOf(now)).toEqual(await budgetOf(old));
    expect((await budgetOf(now))?.alerts).toEqual({ enabled: true, thresholds: [85, 100] });
  });
});

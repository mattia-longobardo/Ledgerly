// «Da fare» from the states of the modules (rewrite plan R5e): read on GET /todo, a count above zero
// is one open fact, a count back to zero closes it, an addon that is off is not read, and the facts
// of a connection that is gone are closed.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categorise } from "@domain/modules/transactions/categorize/service";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { contextFor } from "@domain/modules/users/jobs";
import { setAddon } from "@domain/modules/users/service";
import type { Ctx } from "@domain/platform/context";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { raise } from "@domain/platform/notifications/service";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

async function todo(ctx: Ctx): Promise<{ event: string; params: unknown }[]> {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", await contextFor({ id: ctx.userId }));
      await next();
    },
  });
  const response = await routes.request("/todo");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: { event: string; params: unknown }[] };
  return body.items.map(({ event, params }) => ({ event, params }));
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("GET /todo", () => {
  it("is one item for the movements waiting for a category, with their count, until there are none", async () => {
    const ctx = await newContext();
    const accountId = await anAccount(ctx);
    const strange = (payee: string) => movement({ payee, categoryName: null });
    await upsertFromProvider(ctx, accountId, [strange("Xyz Qwerty"), strange("Qwerty Xyz")], {
      provider: WALLET_PROVIDER,
    });
    await categorise(ctx, [accountId]);
    expect(await todo(ctx)).toEqual([{ event: "transactions_to_categorize", params: { count: 2 } }]);
    expect(await todo(ctx)).toHaveLength(1);
  });

  it("closes a fact whose state is over, and the facts of a connection that is gone", async () => {
    const ctx = await newContext();
    await raise(ctx, { event: "transactions_to_categorize", subject: "all", params: { count: 3 } });
    await raise(ctx, { event: "connection_failed", subject: "gone" });
    await raise(ctx, { event: "connection_expiring", subject: "gone:3:2026-12-01" });
    expect(await todo(ctx)).toEqual([]);
  });

  it("does not read an addon that is off, and shows its fact again when it is back", async () => {
    const ctx = await newContext();
    await raise(ctx, { event: "payslips_to_review", subject: "all", params: { count: 1 } });
    await setAddon(ctx, "payroll", false);
    expect(await todo(ctx)).toEqual([]);
    await setAddon(ctx, "payroll", true);
    // Back on, Payroll is read again: no payslip waits, so the fact is over.
    expect(await todo(ctx)).toEqual([]);
  });
});

// R3 parity of Settings › Data (03-releases.md §R3, criterion 11): the log of the monthly snapshots the
// server page read (`listSnapshotRuns`) is what `GET /api/v1/snapshots` answers to the screen, row by
// row: the month, the result, the accounts written and skipped, the total in its currency, the warnings.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { centsToDecimal } from "@ledgerly/format/cents";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const accounts = await import("@ledgerly/domain/accounts");

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

async function read(path: string) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  return (await routes.request(path)).json();
}

describe("Settings › Data, old page = new screen", () => {
  it("shows the same snapshots", async () => {
    await accounts.createAccount(ctx, {
      name: "Current",
      type: "checking",
      currency: "EUR",
      openingBalanceCents: 12_345n,
      openingOn: "2026-01-01",
    });
    await accounts.runSnapshot(ctx, "2026-01-01");
    await accounts.runSnapshot(ctx, "2026-02-01");

    const page = (await accounts.listSnapshotRuns(ctx)).map((run) => ({
      month: run.month,
      state: run.state,
      accountsWritten: run.accountsWritten,
      accountsSkipped: run.accountsSkipped,
      total: run.totalCents === null ? null : centsToDecimal(run.totalCents),
      totalCurrency: run.totalCurrency,
      warnings: run.warnings ?? [],
    }));
    const { snapshots } = (await read("/snapshots")) as { snapshots: Record<string, unknown>[] };
    expect(page).toHaveLength(2);
    const shown = snapshots.map((row) => {
      const copy = { ...row };
      delete copy.ranAt;
      return copy;
    });
    expect(shown).toEqual(page);
  });
});

// `GET /api/v1/connections` says the state of each row by the same rule as the page (decision of
// 19/11/2026 on the client's request): `status` is what the page's `statusOf` gives, state by state.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { TREK_PROVIDER, WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { integrationConnections } from "@domain/platform/integrations/schema";
import { listConnections, markConnection, saveConnection } from "@domain/platform/integrations/service";
import { eq } from "drizzle-orm";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";
import { connectionList } from "./connection-list";
import { statusOf } from "./connection-view";

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

const NOW = new Date();

/** The page's state of every connection, from the same facts the list reads. */
async function pageStatuses() {
  const connections = await listConnections(ctx);
  return new Map(connections.map((connection) => [connection.id, statusOf({ connection, runs: [] }, NOW)]));
}

describe("the state of GET /connections", () => {
  it("is the page's state for every connection, whatever its state", async () => {
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const trek = await saveConnection(ctx, { provider: TREK_PROVIDER, credentials: { token: "t" } });
    await markConnection(ctx, wallet.id, "active", undefined, NOW);
    await markConnection(ctx, trek.id, "revoked");

    let rows = await connectionList(ctx, NOW);
    let page = await pageStatuses();
    expect(rows.map((row) => [row.id, row.status])).toEqual(rows.map((row) => [row.id, page.get(row.id)]));
    expect(rows.find((row) => row.id === wallet.id)?.status).toEqual({
      value: "ok",
      text: "ok",
      action: null,
    });
    expect(rows.find((row) => row.id === trek.id)?.status).toEqual({
      value: "action",
      text: "keyInvalid",
      action: "replaceKey",
    });

    // No schedule: paused, with "Resume".
    await getDb()
      .update(integrationConnections)
      .set({ schedule: { rules: [] } })
      .where(eq(integrationConnections.id, wallet.id));
    rows = await connectionList(ctx, NOW);
    page = await pageStatuses();
    const row = rows.find((one) => one.id === wallet.id);
    expect(row?.status).toEqual(page.get(wallet.id));
    expect(row?.status).toEqual({ value: "paused", text: "pausedSchedule", action: "resume" });
  });
});

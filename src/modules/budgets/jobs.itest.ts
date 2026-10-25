// What the hourly budget alerts send (spec §7.3): the highest threshold a budget has reached this
// month, once, and nothing for a budget whose alerts are off.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { notificationsLog } from "@/platform/notifications/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { BUDGET_ALERT_KIND, budgetAlertsJob } from "./jobs";
import { budgetDetail } from "./queries";
import { saveAlerts, setLimit } from "./service";

let ctx: Ctx;
let accountId: string;
let month: string;

const claims = async () =>
  (await getDb().select().from(notificationsLog)).filter((row) => row.kind === BUDGET_ALERT_KIND);

async function spend(cents: bigint) {
  await upsertFromProvider(ctx, accountId, [movement({ amountCents: -cents, occurredAt: new Date() })]);
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  accountId = await anAccount(ctx);
  month = monthKey(today(ctx.timeZone));
  await setLimit(ctx, { categoryId: null, accountId, month, cents: 10_000n });
});

afterAll(closeDatabase);

describe("budgetAlertsJob", () => {
  it("is quiet under every threshold", async () => {
    await spend(5_000n);
    await budgetAlertsJob.run();
    expect(await claims()).toHaveLength(0);
  });

  it("claims 85 % once, then the limit once it is passed", async () => {
    await spend(9_000n);
    await budgetAlertsJob.run();
    await budgetAlertsJob.run();
    expect((await claims()).map((row) => row.key)).toEqual([`*|${accountId}|${month}|85`]);

    await spend(2_000n);
    await budgetAlertsJob.run();
    expect((await claims()).map((row) => row.key).sort()).toEqual(
      [`*|${accountId}|${month}|100`, `*|${accountId}|${month}|85`].sort(),
    );
  });

  it("says only the highest threshold when one movement walks past several", async () => {
    await spend(12_000n);
    await budgetAlertsJob.run();
    expect((await claims()).map((row) => row.key)).toEqual([`*|${accountId}|${month}|100`]);
  });

  it("sends nothing for a budget whose alerts are off, and uses the thresholds chosen", async () => {
    await saveAlerts(ctx, { categoryId: null, accountId, enabled: false, thresholds: [85, 100] });
    await spend(12_000n);
    await budgetAlertsJob.run();
    expect(await claims()).toHaveLength(0);

    await saveAlerts(ctx, { categoryId: null, accountId, enabled: true, thresholds: [50] });
    await budgetAlertsJob.run();
    expect((await claims()).map((row) => row.key)).toEqual([`*|${accountId}|${month}|50`]);
  });
});

describe("budgetDetail", () => {
  it("shows the default alerts until some are saved, then the saved ones", async () => {
    const scope = { categoryId: null, accountId };
    expect((await budgetDetail(ctx, scope, month))?.alerts).toEqual({ enabled: true, thresholds: [85, 100] });
    await saveAlerts(ctx, { ...scope, enabled: true, thresholds: [90, 60, 90] });
    const detail = await budgetDetail(ctx, scope, month);
    expect(detail?.alerts).toEqual({ enabled: true, thresholds: [60, 90] });
    expect(detail?.history).toHaveLength(6);
    expect(detail?.history[0].limitCents).toBeNull();
  });

  it("has no page for a scope without a limit this month", async () => {
    expect(await budgetDetail(ctx, { categoryId: null, accountId: null }, month)).toBeNull();
  });
});

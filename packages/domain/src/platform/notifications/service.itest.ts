// The facts of R5e: one open row per fact, closed when the fact is over, nothing for an addon that
// is off, and the channels a person keeps or changes.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { notificationPreferences, notifications } from "./schema";
import { channelsOf, defaultChannels, deleteOldFacts, openFacts, raise, resolve } from "./service";

const NOW = new Date("2026-11-22T10:00:00Z");
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

let ctx: Pick<Ctx, "userId" | "addons">;

beforeEach(async () => {
  await resetDatabase();
  ctx = { userId: (await createTestUser()).id };
});
afterAll(closeDatabase);

const rows = () => getDb().select().from(notifications);

describe("raise", () => {
  it("keeps one open row per fact, however often it is raised", async () => {
    await raise(ctx, { event: "transactions_to_categorize", subject: "all", params: { count: 3 } }, NOW);
    await raise(ctx, { event: "transactions_to_categorize", subject: "all", params: { count: 5 } }, later(1));
    const [row, ...more] = await rows();
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      params: { count: 5 },
      openedAt: NOW,
      lastRaisedAt: later(1),
      resolvedAt: null,
    });
  });

  it("opens a new row for a fact that comes back after it was over", async () => {
    const fact = { event: "connection_failed", subject: "c1", targetId: "c1" } as const;
    await raise(ctx, fact, NOW);
    expect(await resolve(ctx, "connection_failed", { subject: "c1" }, later(1))).toBe(1);
    await raise(ctx, fact, later(2));
    expect(await rows()).toHaveLength(2);
    expect((await openFacts(ctx, ["connection_failed"])).map((row) => row.openedAt)).toEqual([later(2)]);
  });

  it("writes nothing for an event of an addon that is off, and stays for a base event", async () => {
    const off = { ...ctx, addons: ["investments"] as const };
    expect(await raise(off, { event: "budget_threshold", subject: "b|2026-11-01" }, NOW)).toBe(false);
    expect(await raise(off, { event: "account_low_balance", subject: "a1" }, NOW)).toBe(true);
    expect((await rows()).map((row) => row.event)).toEqual(["account_low_balance"]);
  });

  it("keeps the facts of one person away from another's", async () => {
    const other = { userId: (await createTestUser()).id };
    await raise(ctx, { event: "connection_stale", subject: "c1" }, NOW);
    await raise(other, { event: "connection_stale", subject: "c1" }, NOW);
    await resolve(other, "connection_stale", { subject: "c1" }, NOW);
    expect(await openFacts(ctx, ["connection_stale"])).toHaveLength(1);
  });
});

describe("resolve", () => {
  it("closes by prefix but the one kept, or every subject not still true", async () => {
    for (const subject of ["c1:14:2026-12-01", "c1:3:2026-12-01", "c2:14:2026-12-01"]) {
      await raise(ctx, { event: "connection_expiring", subject }, NOW);
    }
    await resolve(ctx, "connection_expiring", { prefix: "c1:", except: "c1:3:2026-12-01" }, NOW);
    expect((await openFacts(ctx, ["connection_expiring"])).map((row) => row.subject).sort()).toEqual([
      "c1:3:2026-12-01",
      "c2:14:2026-12-01",
    ]);
    await resolve(ctx, "connection_expiring", { keep: ["c2:14:2026-12-01"] }, NOW);
    expect((await openFacts(ctx, ["connection_expiring"])).map((row) => row.subject)).toEqual([
      "c2:14:2026-12-01",
    ]);
    await resolve(ctx, "connection_expiring", { keep: [] }, NOW);
    expect(await openFacts(ctx, ["connection_expiring"])).toEqual([]);
  });

  it("reads a prefix literally: a `%` or `_` in it matches nothing else", async () => {
    await raise(ctx, { event: "connection_expiring", subject: "cX:14:2026-12-01" }, NOW);
    await resolve(ctx, "connection_expiring", { prefix: "c_:" }, NOW);
    expect(await openFacts(ctx, ["connection_expiring"])).toHaveLength(1);
  });
});

describe("channels", () => {
  it("are, by default, what Ledgerly did before R5e plus the device for an action", () => {
    expect(defaultChannels("connection_failed")).toEqual({ inApp: true, email: true, device: true });
    expect(defaultChannels("budget_threshold")).toEqual({ inApp: true, email: true, device: false });
    expect(defaultChannels("monthly_summary")).toEqual({ inApp: true, email: true, device: false });
    expect(defaultChannels("payslips_to_review")).toEqual({ inApp: true, email: false, device: true });
  });

  it("are the person's choice once there is one", async () => {
    expect(await channelsOf(ctx, "account_low_balance")).toEqual(defaultChannels("account_low_balance"));
    await getDb()
      .insert(notificationPreferences)
      .values({ userId: ctx.userId, event: "account_low_balance", inApp: true, email: false, device: false });
    expect(await channelsOf(ctx, "account_low_balance")).toEqual({
      inApp: true,
      email: false,
      device: false,
    });
  });
});

describe("deleteOldFacts", () => {
  it("drops a closed fact by when it closed and an open one by when it was last raised", async () => {
    await raise(ctx, { event: "monthly_summary", subject: "2026-07-01" }, NOW);
    await raise(ctx, { event: "connection_failed", subject: "old" }, NOW);
    await resolve(ctx, "connection_failed", { subject: "old" }, later(1));
    await raise(ctx, { event: "connection_stale", subject: "kept" }, NOW);
    await raise(ctx, { event: "connection_stale", subject: "kept" }, later(5));
    expect(await deleteOldFacts(later(2))).toBe(2);
    expect((await rows()).map((row) => row.subject)).toEqual(["kept"]);
  });
});

// The parity of a leave pass (rewrite plan R5c, criterion "parità delle ferie dopo una sync dal
// plugin"): two whole passes of the engine on the year of `test/fixtures/trek/`, and every row they
// leave, the runs, the connection, the figures and the calls Trek received, held to
// `parity-golden.json`. The golden was written by the engine on its own Trek client, before the
// engine spoke to Trek through the plugin; the same passes, through the real plugin served
// in-process and reached by the port as the application wires it, leave exactly it — and the
// columns of contract 2 carry the same observed pair as the `trek_*` ones on every row.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { calendarCalls, openCalendar } from "@plugin-host/calendar";
import { fakeTrek, fixtureYear } from "../../../../test/fixtures/trek/fake-trek";
import { PLUGIN, stubTrek, toPlugin } from "../../../../test/fixtures/trek/served-plugin";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import { deleteLeaveDay, markSynced, saveLeaveDay } from "@domain/modules/timeoff/service";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { saveConnection } from "@domain/platform/integrations/service";
import { wireCalendar } from "./calls";
import { syncCalendarNow, calendarFiguresOf } from "./sync";
import { TREK_PROVIDER } from "../../../../test/fixtures/providers";

const GOLDEN = join(process.cwd(), "test/fixtures/trek/parity-golden.json");
const SEEDED = new Date("2026-06-01T08:00:00Z");
const NOW = new Date("2026-06-10T08:07:00Z");
const LATER = new Date("2026-06-10T09:07:00Z");

/** Ledgerly's side of the year: settled days, removals, a conflict, halves, a past year. */
async function seed(ctx: Ctx): Promise<void> {
  const settle = async (from: string, fraction: 0.5 | 1) => {
    const [day] = await saveLeaveDay(ctx, { from, kind: "vacation", fraction });
    await markSynced(ctx, [{ id: day.id, fraction, kind: "vacation" }], SEEDED);
    return day;
  };
  await settle("2026-03-10", 1);
  await deleteLeaveDay(ctx, (await settle("2026-03-11", 0.5)).id);
  await deleteLeaveDay(ctx, (await settle("2026-03-12", 1)).id);
  await settle("2026-07-01", 1);
  await saveLeaveDay(ctx, { from: "2026-07-01", kind: "vacation", fraction: 0.5 });
  await saveLeaveDay(ctx, { from: "2026-04-01", kind: "sick", fraction: 1 });
  for (const from of ["2026-06-16", "2026-06-19", "2026-06-22", "2025-12-15"]) {
    await saveLeaveDay(ctx, { from, kind: "vacation", fraction: 1 });
  }
  await saveLeaveDay(ctx, { from: "2026-06-17", kind: "vacation", fraction: 0.5 });
  await saveLeaveDay(ctx, { from: "2026-06-17", kind: "rol", fraction: 0.5 });
  await saveLeaveDay(ctx, { from: "2026-06-18", kind: "comp", fraction: 1 });
}

async function rows(query: string): Promise<Record<string, unknown>[]> {
  return (await getDb().execute(sql.raw(query))).rows as Record<string, unknown>[];
}

/** What a pass leaves, with no id and no stamp of the database's clock. */
async function snapshot(ctx: Ctx) {
  const user = `'${ctx.userId}'`;
  return {
    leaveDays: await rows(
      `select "on"::text, kind, fraction::text, note, origin, pending, synced_at::text,
        trek_fraction::text, trek_kind from leave_days where user_id = ${user} order by "on", kind`,
    ),
    runs: await rows(
      `select kind, state, counts, error, error_code from sync_runs where user_id = ${user}
        order by started_at, id`,
    ),
    connection: await rows(
      `select state, error_code, consecutive_failures, last_error from integration_connections
        where user_id = ${user}`,
    ),
    figures: await calendarFiguresOf(ctx, 2026),
  };
}

describe("a leave pass on the fixtures", () => {
  // The port as `wireDomain` wires it, with the configured plugin pointing at the served one.
  beforeAll(() => {
    wireCalendar({
      open: (pluginId, credentials) => calendarCalls({ ...PLUGIN, id: pluginId }, credentials, toPlugin),
    });
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    wireCalendar({ open: openCalendar });
    await closeDatabase();
  });

  it("leaves exactly the rows of the golden", async () => {
    const ctx = await newContext();
    const trek = fakeTrek(fixtureYear());
    await saveConnection(ctx, {
      provider: TREK_PROVIDER,
      credentials: {
        baseUrl: stubTrek(trek.fetch),
        clientId: "trekci_fixture",
        clientSecret: "trekcs_fixture",
      },
    });
    await seed(ctx);

    const passes = [];
    for (const now of [NOW, LATER]) {
      const result = await syncCalendarNow(ctx, { now });
      passes.push(
        result && {
          years: result.years,
          counts: result.counts,
          refused: result.refused,
          conflicts: result.conflicts,
        },
      );
    }
    const outcome = { passes, ...(await snapshot(ctx)), held: trek.held(), calls: trek.calls };

    const text = `${JSON.stringify(outcome, null, 2)}\n`;
    if (!existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, text);
      throw new Error(`no golden: written to ${GOLDEN}, check it and commit it`);
    }
    expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));

    // Dual write (P2): every row's pair of contract 2 is its `trek_*` pair, and a day the calendar
    // does not take says so.
    const pairs = await rows(
      `select "on"::text, trek_kind, external_kind, trek_fraction::text, external_fraction::text,
        external_state from leave_days where user_id = '${ctx.userId}' order by "on", kind`,
    );
    for (const row of pairs) {
      expect([row.external_kind, row.external_fraction]).toEqual([row.trek_kind, row.trek_fraction]);
      expect(row.external_state).toBe(
        row.on === "2026-06-19" ? "refused" : row.trek_kind === null ? null : "synced",
      );
    }
  });
});

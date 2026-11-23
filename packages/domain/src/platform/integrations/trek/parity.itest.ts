// The parity of a leave pass (rewrite plan R5c, criterion "parità delle ferie dopo una sync dal
// plugin"): two whole passes of the engine on the year of `test/fixtures/trek/`, and every row they
// leave, the runs, the connection, the figures and the calls Trek received, held to
// `parity-golden.json`. The golden was written by the engine on its own Trek client, before the
// engine spoke to Trek through the plugin.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTrek } from "../../../../../../test/fixtures/trek/fake-trek";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { newContext } from "../../../../../../test/fixtures";
import { deleteLeaveDay, markSynced, saveLeaveDay } from "../../../modules/timeoff/service";
import type { Ctx } from "../../context";
import { getDb } from "../../db/client";
import { TREK_PROVIDER } from "../rules";
import { saveConnection } from "../service";
import { syncTrekNow, trekStatsOf } from "./sync";

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
    figures: await trekStatsOf(ctx, 2026),
  };
}

describe("a leave pass on the fixtures", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("leaves exactly the rows of the golden", async () => {
    const ctx = await newContext();
    await saveConnection(ctx, {
      provider: TREK_PROVIDER,
      credentials: {
        baseUrl: "https://trek.example",
        clientId: "trekci_fixture",
        clientSecret: "trekcs_fixture",
      },
    });
    await seed(ctx);
    const trek = fakeTrek();
    const clientOptions = { fetch: trek.fetch, sleep: async () => undefined, jitter: () => 0 };

    const passes = [];
    for (const now of [NOW, LATER]) {
      const result = await syncTrekNow(ctx, { now, clientOptions });
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
  });
});

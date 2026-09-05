/**
 * The monthly-history ordering, asserted on the SQL the repo actually sends.
 *
 * There is no Postgres in the unit suite and no fixture database to load, so
 * this pins the one thing that carried the bug: the ORDER BY. A `latest` row
 * always has a newer `captured_at` than the `history` row for the same month,
 * so `captured_at DESC` alone silently picked the carried-forward figure for
 * every month the app was running through, and the backfill — and any
 * correction typed into the old spreadsheet — could never surface.
 *
 * The Postgres semantics behind the clause were checked against a live
 * PostgreSQL 18 with a table-free `SELECT ... FROM (VALUES ...)`:
 *
 *   ORDER BY (COALESCE(kind,'') = 'latest') ASC, captured_at DESC
 *     → wallet (NULL kind) and history rank above latest, newest first inside
 *       that rank.
 *   ORDER BY (kind = 'latest') ASC          → NULL sorts LAST, i.e. a wallet
 *       reading would rank BELOW a hand-typed `latest` row. Hence the COALESCE.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { monthlyHistoryQuery } from "./balances";

function compile(keys: string[], since?: string) {
  const { sql, params } = new PgDialect().sqlToQuery(monthlyHistoryQuery(keys, since));
  return { sql: sql.replace(/\s+/g, " ").trim(), params };
}

describe("monthlyHistoryQuery", () => {
  it("ranks a hand-typed `latest` row below everything else for the month", () => {
    const { sql } = compile(["cometa"]);

    // A month holding BOTH a `history` row (stamped at the month's first
    // instant) and a later `latest` row must resolve to the history value.
    expect(sql).toContain(
      "ORDER BY account_key, month, (COALESCE(raw->>'kind', '') = 'latest') ASC, captured_at DESC, id DESC",
    );

    // Order of the keys is the behaviour: demotion first, recency second.
    const demotion = sql.indexOf("= 'latest') ASC");
    const recency = sql.indexOf("captured_at DESC");
    expect(demotion).toBeGreaterThan(-1);
    expect(demotion).toBeLessThan(recency);
  });

  it("coalesces the missing kind, so a wallet reading is not sorted past `latest`", () => {
    // Wallet rows are written with no `raw` at all, so `raw->>'kind'` is NULL
    // for them. Bare `(raw->>'kind' = 'latest')` puts NULL last under ASC and
    // first under DESC — either way not "rank with the real readings".
    const { sql } = compile(["ing"]);
    expect(sql).toContain("COALESCE(raw->>'kind', '')");
    expect(sql).not.toMatch(/\(raw->>'kind' = 'latest'\)/);
  });

  it("keeps `id DESC` last, where it only ever separates two backfill rows", () => {
    const { sql } = compile(["cometa"]);
    expect(sql.endsWith("captured_at DESC, id DESC")).toBe(true);
  });

  it("binds the keys and the optional since as parameters, never as text", () => {
    const { sql, params } = compile(["ing", "cometa"], "2026-01-01");
    expect(params).toEqual(["ing", "cometa", "2026-01-01T00:00:00Z"]);
    expect(sql).toContain("AND captured_at >=");
  });

  it("omits the since filter when the caller wants the whole history", () => {
    const { sql, params } = compile(["ing"]);
    expect(sql).not.toContain("captured_at >=");
    expect(params).toEqual(["ing"]);
  });
});

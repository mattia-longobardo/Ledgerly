// Migration 0082: the day and the time of the operation, once, from the bank's text already stored
// for the movements the bank no longer gives back. Synthetic texts only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

const MIGRATION = readFileSync(join(process.cwd(), "drizzle/0082_times_from_text.sql"), "utf8");

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}

let userId: string;
let accountId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createTestUser()).id;
  [{ id: accountId }] = await query<{ id: string }>(
    `insert into accounts (user_id, name, type) values ($1, 'Conto', 'checking') returning id`,
    [userId],
  );
});

afterAll(closeDatabase);

/** A movement stored at noon (Rome) of `day`, as a reading without a time leaves it. */
async function movement(day: string, text: string, extra: { origin?: string; edited?: string[] } = {}) {
  const [row] = await query<{ id: string }>(
    `insert into transactions (user_id, account_id, occurred_at, amount_cents, type, origin, raw_text, locally_edited)
     values ($1, $2, ($3::date + time '12:00') at time zone 'Europe/Rome', -100, 'expense', $4, $5, $6) returning id`,
    [userId, accountId, day, extra.origin ?? "provider", text, extra.edited ?? []],
  );
  return row.id;
}

async function stored(id: string) {
  const [row] = await query<{ at: Date; known: boolean }>(
    `select occurred_at as at, time_known as known from transactions where id = $1`,
    [id],
  );
  return { at: row.at.toISOString(), known: row.known };
}

const NOON = (day: string, utcHour: number) => `${day}T${String(utcHour).padStart(2, "0")}:00:00.000Z`;

describe("migration 0082, times from the stored text", () => {
  it("gives the operation's day and time, in Rome, to a movement booked days later", async () => {
    const summer = await movement(
      "2026-07-17",
      "PAGAMENTO CARTA 0000 del 15/07/2026 alle ore 09:05 presso PROVA",
    );
    const winter = await movement("2026-11-13", "BONIFICO DA PROVA del 12/11/2026  alle ore 14:32");
    await query(MIGRATION);
    expect(await stored(summer)).toEqual({ at: "2026-07-15T07:05:00.000Z", known: true });
    expect(await stored(winter)).toEqual({ at: "2026-11-12T13:32:00.000Z", known: true });
  });

  it("leaves a day after the stored one, a day that does not exist, a time the person set, and other texts", async () => {
    const later = await movement("2026-07-14", "PAGAMENTO CARTA del 15/07/2026 alle ore 09:05");
    const missing = await movement("2026-05-02", "PAGAMENTO CARTA del 31/04/2026 alle ore 09:05");
    const edited = await movement("2026-07-17", "PAGAMENTO CARTA del 15/07/2026 alle ore 09:05", {
      edited: ["occurredAt"],
    });
    const plain = await movement("2026-07-17", "PAGAMENTO CARTA del 15/07/2026");
    await query(MIGRATION);
    expect(await stored(later)).toEqual({ at: NOON("2026-07-14", 10), known: false });
    expect(await stored(missing)).toEqual({ at: NOON("2026-05-02", 10), known: false });
    expect(await stored(edited)).toEqual({ at: NOON("2026-07-17", 10), known: false });
    expect(await stored(plain)).toEqual({ at: NOON("2026-07-17", 10), known: false });
  });

  it("changes nothing when it runs again", async () => {
    const id = await movement("2026-07-17", "PAGAMENTO CARTA del 15/07/2026 alle ore 09:05");
    await query(MIGRATION);
    const once = await stored(id);
    await query(MIGRATION);
    expect(await stored(id)).toEqual(once);
  });
});

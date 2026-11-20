import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../../platform/db/client";
import { civilDateIn } from "../../shared/dates";
import { closeDatabase } from "../../../../../test/db";
import { dayExpression, payeeKeyExpression } from "./queries/filters";
import { payeeKeyOf } from "./rules";

// Audit TRX-9: the payee key and the civil day are written in SQL and in JS; the two must agree, or
// suggestions and recurrences stop matching.

afterAll(closeDatabase);

const PAYEES = [
  "Net Flix",
  " NETFLIX\tEUROPE ",
  "Line\nbreak\r\nand\vtabs\f",
  "ÉCOLE Ünïcödé Ça",
  "Straße ÆØÅ",
  "ΣΟΦΊΑ Москва",
  "AMAZON*MKTPLACE  EU-IT",
  "ideo\u3000space",
  // Whitespace to JS and not to Postgres's `\s`, and a capital that lowers differently (PERS-473).
  "NET\u00a0FLIX \u202fEU\ufeff",
  "İSTANBUL Kebap",
];

describe("payeeKeyExpression", () => {
  it.each(PAYEES)("gives the key payeeKeyOf gives: %j", async (payee) => {
    const { rows } = await getDb().execute<{ key: string }>(
      sql`select ${payeeKeyExpression(sql`${payee}::text`)} as key`,
    );
    expect(rows[0].key).toBe(payeeKeyOf(payee));
  });
});

describe("dayExpression", () => {
  const instants = [
    "2026-03-29T00:59:59Z",
    "2026-03-29T01:00:00Z",
    "2026-10-24T22:00:00Z",
    "2026-12-31T23:30:00Z",
  ];
  it.each(instants)("gives the day civilDateIn gives: %s", async (iso) => {
    const { rows } = await getDb().execute<{ day: string }>(
      sql`select ${dayExpression("Europe/Rome", sql`${iso}::timestamptz`)} as day`,
    );
    expect(rows[0].day).toBe(civilDateIn(new Date(iso), "Europe/Rome"));
  });
});

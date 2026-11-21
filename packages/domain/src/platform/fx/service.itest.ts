/**
 * `ensureRange`, the one way rates enter `fx_rates` (audit PLT-2, INV-10): the days the daily job
 * and an investments sync ask the ECB for, against a real table and a Frankfurter that never leaves
 * the process.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { ensureRange, listRates, saveRates, storedRange } from "./service";

beforeEach(resetDatabase);
afterAll(closeDatabase);

/** A Frankfurter that answers every range with one USD rate per weekday in it. */
function frankfurter() {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const [from, to] = String(url).split("/v1/")[1].split("?")[0].split("..");
    const rates: Record<string, Record<string, number>> = {};
    for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`);) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) rates[day.toISOString().slice(0, 10)] = { USD: 2 };
      day = new Date(day.getTime() + 86_400_000);
    }
    return new Response(JSON.stringify({ amount: 1, base: "EUR", rates }), { status: 200 });
  });
  return { fetch, base: "https://fx.test" };
}

const asked = (source: ReturnType<typeof frankfurter>) =>
  source.fetch.mock.calls.map(([url]) => String(url).split("/v1/")[1].split("?")[0]);

describe("ensureRange", () => {
  it("fills an empty table from `from` to `to`, either way", async () => {
    const source = frankfurter();
    expect(await ensureRange("2026-10-19", "2026-10-23", { ...source, forward: false })).toEqual({
      ranges: 1,
      fetched: 5,
      inserted: 5,
    });
    expect(asked(source)).toEqual(["2026-10-19..2026-10-23"]);
    expect(await storedRange()).toEqual({ earliest: "2026-10-19", latest: "2026-10-23" });
  });

  it("asks only for the days before and after the stored ones", async () => {
    await saveRates([
      { on: "2026-10-14", currency: "USD", eurPerUnit: "0.8" },
      { on: "2026-10-16", currency: "USD", eurPerUnit: "0.8" },
    ]);
    const source = frankfurter();
    await ensureRange("2026-10-12", "2026-10-21", source);
    expect(asked(source)).toEqual(["2026-10-12..2026-10-13", "2026-10-17..2026-10-21"]);
    // Stored rows never change: the 14th and the 16th keep their rate.
    expect((await listRates("USD")).map((rate) => [rate.on, rate.eurPerUnit])).toEqual([
      ["2026-10-12", "0.5000000000"],
      ["2026-10-13", "0.5000000000"],
      ["2026-10-14", "0.8000000000"],
      ["2026-10-16", "0.8000000000"],
      ["2026-10-19", "0.5000000000"],
      ["2026-10-20", "0.5000000000"],
      ["2026-10-21", "0.5000000000"],
    ]);
  });

  it("without `forward`, asks only for the days before the stored ones, as a sync did", async () => {
    await saveRates([{ on: "2026-10-14", currency: "USD", eurPerUnit: "0.8" }]);
    const source = frankfurter();
    await ensureRange("2026-10-12", "2026-10-21", { ...source, forward: false });
    expect(asked(source)).toEqual(["2026-10-12..2026-10-13"]);
    // A window the table already covers fetches nothing.
    await ensureRange("2026-10-13", "2026-10-21", { ...source, forward: false });
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing when there is nothing to convert", async () => {
    const source = frankfurter();
    expect(await ensureRange(null, "2026-10-21", source)).toEqual({ ranges: 0, fetched: 0, inserted: 0 });
    expect(source.fetch).not.toHaveBeenCalled();
  });
});

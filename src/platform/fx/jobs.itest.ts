/**
 * The exchange rates against a real database (investments.md §1.8). What is worth defending: the
 * first run backfills from the oldest balance, a later run asks only for the days it lacks, and a
 * stored rate never changes — a second fetch that answers differently adds days, never rewrites.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { createAccount } from "@/modules/accounts/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { refreshFxRates } from "./jobs";
import { listRates, storedRange } from "./service";
import type { FxFetchOptions } from "./sources";

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

/** A Frankfurter that answers every range with one USD rate per weekday in it, at `usd`. */
function frankfurter(usd: number): FxFetchOptions & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const [from, to] = String(url).split("/v1/")[1].split("?")[0].split("..");
    const rates: Record<string, Record<string, number>> = {};
    for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`);) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
        rates[day.toISOString().slice(0, 10)] = { USD: usd };
      day = new Date(day.getTime() + 86_400_000);
    }
    return new Response(JSON.stringify({ amount: 1, base: "EUR", rates }), { status: 200 });
  });
  return { fetch, base: "https://fx.test" };
}

const at = (day: string) => new Date(`${day}T12:00:00Z`);

describe("refreshFxRates", () => {
  it("fetches nothing while no balance exists", async () => {
    const source = frankfurter(1.25);
    expect(await refreshFxRates(source, at("2026-10-27"))).toMatchObject({ ranges: 0, inserted: 0 });
    expect(source.fetch).not.toHaveBeenCalled();
  });

  it("backfills from the oldest balance, then asks only for the new days", async () => {
    await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: { on: "2026-10-19", cents: 100n },
    });
    const source = frankfurter(1.25);
    expect(await refreshFxRates(source, at("2026-10-23"))).toMatchObject({
      ranges: 1,
      inserted: 5,
      earliest: "2026-10-19",
      latest: "2026-10-23",
    });
    expect(source.fetch).toHaveBeenLastCalledWith(
      "https://fx.test/v1/2026-10-19..2026-10-23?base=EUR",
      expect.anything(),
    );

    // Monday: only the days after Friday are asked for.
    await refreshFxRates(source, at("2026-10-26"));
    expect(source.fetch).toHaveBeenLastCalledWith(
      "https://fx.test/v1/2026-10-24..2026-10-26?base=EUR",
      expect.anything(),
    );
    expect(await storedRange()).toEqual({ earliest: "2026-10-19", latest: "2026-10-26" });
  });

  it("never rewrites a stored rate, and fills in the past when an older balance appears", async () => {
    await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: { on: "2026-10-19", cents: 100n },
    });
    await refreshFxRates(frankfurter(1.25), at("2026-10-23"));

    await createAccount(ctx, {
      name: "Vecchio",
      type: "savings",
      currency: "EUR",
      openingBalance: { on: "2026-10-14", cents: 100n },
    });
    // A Frankfurter that now says something else for every day: the old days keep their rate.
    const changed = frankfurter(2);
    expect(await refreshFxRates(changed, at("2026-10-23"))).toMatchObject({ ranges: 1, inserted: 3 });
    expect(changed.fetch).toHaveBeenCalledWith(
      "https://fx.test/v1/2026-10-14..2026-10-18?base=EUR",
      expect.anything(),
    );

    const rates = await listRates("USD");
    expect(rates.map((rate) => [rate.on, rate.eurPerUnit])).toEqual([
      ["2026-10-14", "0.5000000000"],
      ["2026-10-15", "0.5000000000"],
      ["2026-10-16", "0.5000000000"],
      ["2026-10-19", "0.8000000000"],
      ["2026-10-20", "0.8000000000"],
      ["2026-10-21", "0.8000000000"],
      ["2026-10-22", "0.8000000000"],
      ["2026-10-23", "0.8000000000"],
    ]);
  });

  it("writes nothing when Frankfurter fails", async () => {
    await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: { on: "2026-10-19", cents: 100n },
    });
    const fetch = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(refreshFxRates({ fetch }, at("2026-10-23"))).rejects.toThrow("HTTP 503");
    expect(await storedRange()).toEqual({ earliest: null, latest: null });
  });
});

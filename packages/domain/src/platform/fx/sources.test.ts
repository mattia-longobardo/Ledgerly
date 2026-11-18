import { describe, expect, it, vi } from "vitest";
import { FxError, fetchEcbRates } from "./sources";

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("fetchEcbRates", () => {
  it("asks Frankfurter for the range against EUR and returns euro per unit, by day and currency", async () => {
    const fetch = answer({
      amount: 1,
      base: "EUR",
      start_date: "2026-10-23",
      end_date: "2026-10-26",
      rates: { "2026-10-26": { USD: 1.25, GBP: 0.8 }, "2026-10-23": { USD: 1.0 } },
    });
    const rates = await fetchEcbRates(
      { from: "2026-10-25", to: "2026-10-26" },
      { fetch, base: "https://fx.test" },
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://fx.test/v1/2026-10-25..2026-10-26?base=EUR",
      expect.anything(),
    );
    expect(rates).toEqual([
      { on: "2026-10-23", currency: "USD", eurPerUnit: "1.0000000000" },
      { on: "2026-10-26", currency: "GBP", eurPerUnit: "1.2500000000" },
      { on: "2026-10-26", currency: "USD", eurPerUnit: "0.8000000000" },
    ]);
  });

  it("drops what is not a currency or not a rate, and EUR itself", async () => {
    const fetch = answer({ base: "EUR", rates: { "2026-10-26": { EUR: 1, usd: 1.1, XAU: 0, CHF: 0.9239 } } });
    expect(await fetchEcbRates({ from: "2026-10-26", to: "2026-10-26" }, { fetch })).toEqual([
      { on: "2026-10-26", currency: "CHF", eurPerUnit: "1.0823682217" },
    ]);
  });

  it("fails on an HTTP error, a wrong shape, a wrong base and a body that is not JSON", async () => {
    const range = { from: "2026-10-26", to: "2026-10-26" };
    await expect(fetchEcbRates(range, { fetch: answer("{}", 404) })).rejects.toThrow("HTTP 404");
    await expect(fetchEcbRates(range, { fetch: answer({ base: "EUR" }) })).rejects.toBeInstanceOf(FxError);
    await expect(fetchEcbRates(range, { fetch: answer({ base: "USD", rates: {} }) })).rejects.toBeInstanceOf(
      FxError,
    );
    await expect(fetchEcbRates(range, { fetch: answer("<html>") })).rejects.toThrow("JSON");
    await expect(
      fetchEcbRates(range, { fetch: answer({ base: "EUR", rates: { yesterday: { USD: 1 } } }) }),
    ).rejects.toThrow("date");
  });

  it("fails when the service cannot be reached", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(fetchEcbRates({ from: "2026-10-26", to: "2026-10-26" }, { fetch })).rejects.toThrow(
      "could not be reached",
    );
  });
});

// The registry and the daily prices (rewrite plan R5d) against a real database: a search kept for
// the next one, a run of the job within its cap, a source's correction, a market it does not know.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import type { PriceAnswer, PriceRequest, PriceSource } from "./ports";
import { lastClosesOf, refreshPrices } from "./prices";
import { searchInstruments } from "./service";

// A public example ISIN (ISO 6166), no person's data.
const ISIN = "US0378331005";
const FIRDS = {
  response: {
    docs: [{ gnr_full_name: "Example Inc", gnr_cfi_code: "ESVUFR", gnr_notional_curr_code: "USD" }],
  },
};
const FIGI = [
  {
    data: [
      { ticker: "EXA", exchCode: "IM", shareClassFIGI: "BBG000000001", securityType: "Common Stock" },
      { ticker: "EXA", exchCode: "UW", shareClassFIGI: "BBG000000001" },
    ],
  },
];

function registers() {
  let calls = 0;
  const fetch = (async (input: string | URL | Request) => {
    calls += 1;
    const body = new URL(String(input)).host === "api.openfigi.com" ? FIGI : FIRDS;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

/** A source of closes: what it answers for each key, and the requests it got. */
function source(answer: (request: PriceRequest) => PriceAnswer): PriceSource & { requests: PriceRequest[] } {
  const requests: PriceRequest[] = [];
  return {
    id: "prices",
    requests,
    closes: async (request) => {
      requests.push(request);
      return answer(request);
    },
  };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the search of the registry", () => {
  it("asks the registers for an ISIN once, then finds it in the registry", async () => {
    const one = registers();
    const first = await searchInstruments(ISIN, { fetch: one.fetch, priceSourceId: "prices" });
    expect(first.complete).toBe(true);
    expect(first.items).toMatchObject([
      {
        isin: ISIN,
        name: "Example Inc",
        class: "stock",
        currency: "USD",
        listings: [
          { mic: "XMIL", ticker: "EXA", currency: "EUR", priced: true },
          { mic: "XNAS", ticker: "EXA", currency: "USD", priced: true },
        ],
      },
    ]);
    expect(one.calls()).toBe(2);
    const again = await searchInstruments(ISIN.toLowerCase(), { fetch: one.fetch, priceSourceId: "prices" });
    expect(again.items.map((item) => item.instrumentId)).toEqual(
      first.items.map((item) => item.instrumentId),
    );
    expect(one.calls()).toBe(2);
    expect(
      (await searchInstruments("example", { fetch: one.fetch, priceSourceId: null })).items,
    ).toHaveLength(1);
  });

  it("answers what it knows when a register is down", async () => {
    const down = (async () => new Response("{}", { status: 503 })) as typeof globalThis.fetch;
    expect(await searchInstruments(ISIN, { fetch: down, priceSourceId: "prices" })).toEqual({
      items: [],
      complete: false,
    });
  });
});

describe("a run of the daily prices", () => {
  async function market() {
    const found = await searchInstruments(ISIN, { fetch: registers().fetch, priceSourceId: "prices" });
    const listings = found.items[0].listings;
    return {
      instrumentId: found.items[0].instrumentId,
      milan: listings[0].listingId,
      nasdaq: listings[1].listingId,
    };
  }

  it("reads the oldest first within its cap, keeps one close a day, and takes a source's correction", async () => {
    const { instrumentId, milan, nasdaq } = await market();
    const markets = [
      { listingId: milan, neededFrom: "2026-11-02" },
      { listingId: nasdaq, neededFrom: "2026-11-02" },
    ];
    const first = source((request) => ({
      bars: request.listings.map((one) => ({
        key: one.key,
        on: "2026-11-20",
        close: "10.5",
        currency: one.currency,
      })),
      errors: [],
    }));
    const capped = await refreshPrices({ source: first, markets, today: "2026-11-22", cap: 1 });
    expect(capped).toMatchObject({ read: 1, partial: true });
    expect(first.requests[0]).toMatchObject({ from: "2026-11-02", to: "2026-11-22" });
    await refreshPrices({ source: first, markets, today: "2026-11-22", cap: 10 });
    const corrected = source((request) => ({
      bars: request.listings.map((one) => ({
        key: one.key,
        on: "2026-11-20",
        close: "10.6",
        currency: one.currency,
      })),
      errors: [],
    }));
    const run = await refreshPrices({ source: corrected, markets, today: "2026-11-23", cap: 10 });
    expect([...run.changed.values()]).toEqual(["2026-11-20", "2026-11-20"]);
    expect(corrected.requests[0]).toMatchObject({ from: "2026-11-13", to: "2026-11-23" });
    const closes = await lastClosesOf([{ instrumentId, mic: "XMIL" }], "2026-11-23");
    expect(closes.get(`${instrumentId}:XMIL`)).toMatchObject({
      on: "2026-11-20",
      currency: "EUR",
      source: "prices",
    });
    expect(Number(closes.get(`${instrumentId}:XMIL`)?.close)).toBe(10.6);
  });

  it("stops reading a market the source does not know", async () => {
    const { milan } = await market();
    const markets = [{ listingId: milan, neededFrom: "2026-11-02" }];
    const unknown = source((request) => ({
      bars: [],
      errors: request.listings.map((one) => ({ key: one.key, code: "unknown_symbol" as const })),
    }));
    expect(await refreshPrices({ source: unknown, markets, today: "2026-11-22", cap: 10 })).toMatchObject({
      read: 1,
      partial: false,
    });
    expect(await refreshPrices({ source: unknown, markets, today: "2026-11-23", cap: 10 })).toMatchObject({
      read: 0,
    });
  });
});

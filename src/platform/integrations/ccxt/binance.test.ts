// Binance mapping (docs/design/investments.md §3.2, §5.2, D18 · B1–B7) on the anonymised fixtures
// of the spike: the key's allowlist, the scope and the dust, the price path of §1.8 (USDT ≠ USD),
// the events with their legs and fees in a coin, and the conservation of the quantities (A6).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CivilDate } from "@/platform/dates";
import { type ProviderEvent, SourceError } from "../investments/source";
import {
  balancesOf,
  BINANCE_PROVIDER,
  binanceCoverage,
  candleSymbols,
  closesOf,
  convertEventsOf,
  decimal,
  dividendEventsOf,
  earnPageOf,
  fiatOrderEventsOf,
  fiatPaymentEventsOf,
  holdingsOf,
  keyCheckOf,
  netQuantities,
  pricePath,
  priceLegs,
  type Quote,
  quotesOf,
  tickerSymbols,
  tradeEventsOf,
  tradeSymbols,
  transferEventsOf,
  units,
  walletProduct,
  windowsOf,
} from "./binance";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/binance");
const body = (name: string): unknown =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown }).body;

const EMPTY_EARN = earnPageOf(body("earn-flexible-empty"), "flexible");
const EMPTY_LOCKED = earnPageOf(body("earn-locked-empty"), "locked");
const n = (value: bigint) => Number(decimal(value));
const quote = (last: string, at = 1_793_141_567_000): Quote => ({ last: units(last)!, at: new Date(at) });
const restrictions = () => body("api-restrictions") as Record<string, unknown>;

describe("keyCheckOf (§5.2, B1)", () => {
  it("accepts the spike's key: reading on, every write flag off, ipRestrict saved", () => {
    const { check, ignored } = keyCheckOf(body("api-restrictions"));
    expect(check).toMatchObject({ result: "read-only", ipRestricted: false, externalAccountId: null });
    expect(Object.keys(check.permissions)).toHaveLength(11);
    expect(check.permissions.enableReading).toBe(true);
    expect(ignored).toEqual([]);
  });

  it("accepts enableFixReadOnly: it only reads", () => {
    expect(keyCheckOf({ ...restrictions(), enableFixReadOnly: true }).check.result).toBe("read-only");
  });

  it.each([
    "enableSpotAndMarginTrading",
    "enableWithdrawals",
    "enableInternalTransfer",
    "permitsUniversalTransfer",
    "enableFixApiTrade",
  ])("refuses a key with %s on as one that writes", (flag) => {
    expect(keyCheckOf({ ...restrictions(), [flag]: true }).check.result).toBe("write");
  });

  it("refuses a flag Ledgerly does not know when it is on, and logs it when it is off", () => {
    expect(keyCheckOf({ ...restrictions(), enableNewTrading: true }).check.result).toBe("unknown-flag");
    const off = keyCheckOf({ ...restrictions(), permitsSomethingNew: false });
    expect(off.check.result).toBe("read-only");
    expect(off.ignored).toEqual(["permitsSomethingNew"]);
  });

  it("refuses a key that cannot read, or whose write flag is missing", () => {
    expect(keyCheckOf({ ...restrictions(), enableReading: false }).check.result).toBe("unknown-flag");
    const missing = restrictions();
    delete missing.enableWithdrawals;
    expect(keyCheckOf(missing).check.result).toBe("unknown-flag");
  });

  it("fails with a fixed class on an answer it cannot read, never with the body", () => {
    expect(() => keyCheckOf({ msg: "secret body" })).toThrow(SourceError);
    try {
      keyCheckOf({ msg: "secret body" });
    } catch (error) {
      expect((error as SourceError).errorClass).toBe("schema_mismatch");
      expect(String(error)).not.toContain("secret body");
    }
  });
});

describe("balancesOf (B4, B6)", () => {
  it("reads Spot, Funding and Earn, quantities > 0 only, with the uid", () => {
    const read = balancesOf({
      account: body("account"),
      funding: (body("balance-funding") as { info: unknown }).info,
      earnFlexible: [EMPTY_EARN],
      earnLocked: [EMPTY_LOCKED],
    });
    expect(read.uid).toBe("900032");
    expect(read.quantities.map((one) => [one.asset, one.product, decimal(one.quantity)])).toEqual([
      ["BNB", "spot", "0.00002114"],
      ["ETHW", "funding", "0.00002831"],
      ["TRX", "spot", "0.00376788"],
    ]);
  });

  it("drops zero balances and never counts a flexible Earn position twice (LD<X>)", () => {
    const read = balancesOf({
      account: {
        uid: 1,
        balances: [
          { asset: "BTC", free: "0", locked: "0" },
          { asset: "LDETH", free: "0.5", locked: "0" },
          { asset: "LDO", free: "3", locked: "1" },
        ],
      },
      funding: [],
      earnFlexible: [{ total: 1, rows: [{ asset: "ETH", quantity: units("0.5")! }] }],
      earnLocked: [{ total: 1, rows: [{ asset: "SOL", quantity: units("2")! }] }],
    });
    expect(read.quantities.map((one) => [one.asset, one.product, decimal(one.quantity)])).toEqual([
      ["ETH", "earn", "0.5"],
      ["LDO", "spot", "4"],
      ["SOL", "earn", "2"],
    ]);
  });
});

describe("pricePath (§1.8, B5)", () => {
  const quotes = quotesOf(body("tickers"));
  const usdEur = () => "0.9";

  it("uses the pair in the account's currency first", () => {
    const path = pricePath("ETH", "EUR", quotes, undefined, "2026-10-27");
    expect(path).toMatchObject({ priceCurrency: "EUR", priceSource: "binance:ETH/EUR", fxRate: null });
    expect(n(path!.price)).toBe(2106.58);
    expect(path!.priceAt?.toISOString()).toBe("2026-10-27T22:52:47.685Z");
  });

  it("prices USDT in EUR with the inverse pair EUR/USDT, never at par with USD", () => {
    const path = pricePath("USDT", "EUR", quotes, undefined, "2026-10-27");
    expect(path?.priceSource).toBe("binance:EUR/USDT");
    expect(n(path!.price)).toBeCloseTo(1 / 1.1149, 12);
  });

  it("goes through USDT for a coin without a pair in the account's currency", () => {
    const only = new Map([
      ["SOL/USDT", quote("200")],
      ["EUR/USDT", quote("1.25")],
    ]);
    const path = pricePath("SOL", "EUR", only, undefined, "2026-10-27");
    expect(path).toMatchObject({ priceCurrency: "USDT", priceSource: "binance:SOL/USDT" });
    expect(n(path!.price)).toBe(200);
    expect(n(path!.fxRate!)).toBe(0.8);
    expect(path!.fxSource).toBe("exchange:EUR/USDT@2026-10-27T22:52:47.000Z");
  });

  it("takes USDT/USD on the exchange × the ECB rate when USDT has no pair in the account's currency", () => {
    const only = new Map([
      ["SOL/USDT", quote("200")],
      ["USDT/USD", quote("0.998")],
    ]);
    const path = pricePath("SOL", "EUR", only, usdEur, "2026-10-27");
    expect(n(path!.fxRate!)).toBeCloseTo(0.998 * 0.9, 12);
    expect(path!.fxSource).toContain("ecb:2026-10-27");
    // Without the exchange's USDT/USD there is no path: never USDT = USD.
    expect(pricePath("SOL", "EUR", new Map([["SOL/USDT", quote("200")]]), usdEur, "2026-10-27")).toBeNull();
    expect(pricePath("USDT", "USD", new Map(), usdEur, "2026-10-27")).toBeNull();
  });

  it("prices fiat at the ECB rate and the account's own currency at 1", () => {
    expect(n(pricePath("USD", "EUR", new Map(), usdEur, "2026-10-27")!.price)).toBe(0.9);
    expect(pricePath("USD", "EUR", new Map(), () => null, "2026-10-27")).toBeNull();
    expect(n(pricePath("EUR", "EUR", new Map(), undefined, "2026-10-27")!.price)).toBe(1);
  });

  it("asks only for the tickers of listed markets", () => {
    const markets = new Set(["ETH/EUR", "ETH/USDT", "EUR/USDT", "USDT/USD", "BTC/USDT"]);
    expect(tickerSymbols(["ETH", "EUR", "ETHW"], "EUR", markets)).toEqual([
      "ETH/EUR",
      "ETH/USDT",
      "EUR/USDT",
      "USDT/USD",
    ]);
  });
});

describe("holdingsOf (R1, B4, B5, B6)", () => {
  const balances = balancesOf({
    account: body("account"),
    funding: (body("balance-funding") as { info: unknown }).info,
    earnFlexible: [EMPTY_EARN],
    earnLocked: [EMPTY_LOCKED],
  });
  const read = (overrides: Partial<Parameters<typeof holdingsOf>[0]> = {}) =>
    holdingsOf({
      balances,
      wallets: body("wallet-balance"),
      quotes: quotesOf(body("tickers")),
      currency: "EUR",
      observedAt: new Date("2026-10-27T22:53:00Z"),
      on: "2026-10-27",
      ...overrides,
    });

  it("keeps the spike's dust visible, and the reading is neither partial nor empty (B5, B6)", () => {
    const quotes = new Map([
      ...quotesOf(body("tickers")),
      ["BNB/EUR", quote("950")],
      ["TRX/USDT", quote("0.3")],
    ]);
    const snapshot = read({ quotes });
    // BNB and TRX are worth less than a cent; ETHW has no market and less than 0.001.
    expect(snapshot.positions.map((one) => [one.asset.symbol, one.product, one.valueCents])).toEqual([
      ["BNB", "spot", 2n],
      ["ETHW", "funding", null],
      ["TRX", "spot", 0n],
    ]);
    expect(snapshot).toMatchObject({
      externalAccountId: "900032",
      totalCents: 2n,
      empty: false,
      complete: true,
    });
    expect(snapshot.scopes).toEqual([
      { product: "spot", complete: true },
      { product: "funding", complete: true },
      { product: "earn", complete: true },
    ]);
  });

  it("values every position in the account's currency and sums them", () => {
    const snapshot = read({
      balances: {
        uid: "1",
        quantities: [
          { asset: "ETH", product: "spot", quantity: units("0.5")! },
          { asset: "USDT", product: "funding", quantity: units("100")! },
          { asset: "EUR", product: "spot", quantity: units("10.004")! },
        ],
      },
    });
    const [eth, usdt, eur] = snapshot.positions;
    expect(eth).toMatchObject({ valueCents: 105_329n, priceCurrency: "EUR" });
    expect(usdt).toMatchObject({ valueCents: 8_969n, asset: { class: "stablecoin", currency: "USD" } });
    expect(eur).toMatchObject({ valueCents: 1_000n, asset: { class: "cash" } });
    expect(snapshot.totalCents).toBe(105_329n + 8_969n + 1_000n);
    expect(snapshot.cashCents).toBe(1_000n);
  });

  it("is partial when a coin worth more than dust has no price, never zero", () => {
    // The spike's TRX has no ticker in the fixture: 0.0037 is more than the dust of an unpriced coin.
    expect(read().complete).toBe(false);
    const snapshot = read({
      balances: { uid: "1", quantities: [{ asset: "ABC", product: "spot", quantity: units("12")! }] },
    });
    expect(snapshot.positions[0].valueCents).toBeNull();
    expect(snapshot.complete).toBe(false);
  });

  it("names a wallet it does not read and makes the reading partial (B4)", () => {
    const wallets = (body("wallet-balance") as { walletName: string; balance: string }[]).map((one) =>
      one.walletName === "USDⓈ-M Futures" ? { ...one, balance: "0.01" } : one,
    );
    const snapshot = read({ wallets });
    expect(snapshot.scopes).toContainEqual({ product: "other:usds-m-futures", complete: false });
    expect(snapshot.complete).toBe(false);
  });

  it("is empty only when no wallet has anything (R5, B6)", () => {
    const wallets = (body("wallet-balance") as { balance: string }[]).map((one) => ({
      ...one,
      balance: "0",
    }));
    expect(read({ wallets, balances: { uid: "1", quantities: [] } }).empty).toBe(true);
  });

  it("slugs wallet names into products", () => {
    expect(walletProduct("Cross Margin")).toBe("other:cross-margin");
    expect(walletProduct("COIN-M Futures")).toBe("other:coin-m-futures");
  });
});

describe("flows (§3.2, B2, B7)", () => {
  it("maps crypto deposits and withdrawals, the network fee as a leg of the coin", () => {
    const deposits = transferEventsOf(body("deposits"), "deposit", "EUR");
    expect(deposits.events.map((one) => one.externalId)).toEqual([
      "deposit:fixture-id-0033",
      "deposit:fixture-id-0036",
      "deposit:fixture-id-0039",
    ]);
    expect(deposits.events[0].legs).toEqual([
      expect.objectContaining({
        leg: "main",
        kind: "deposit",
        asset: expect.objectContaining({ symbol: "ETH", class: "crypto" }),
        product: "spot",
        quantity: "0.00403781",
        nativeCurrency: "ETH",
      }),
    ]);
    const withdrawals = transferEventsOf(body("withdrawals"), "withdrawal", "EUR");
    expect(withdrawals.events[0].legs.map((one) => [one.leg, one.kind, one.quantity])).toEqual([
      ["main", "withdrawal", "0.0014324"],
      ["fee", "fee", "0.000074"],
    ]);
    // A free withdrawal has no fee leg.
    expect(withdrawals.events[2].legs).toHaveLength(1);
  });

  it("reads again from a pending transfer", () => {
    const raw = (body("deposits") as Record<string, unknown>[]).map((one, index) =>
      index === 1 ? { ...one, status: "pending" } : one,
    );
    const read = transferEventsOf(raw, "deposit", "EUR");
    expect(read.events).toHaveLength(2);
    expect(read.pendingFrom).toBe(1_758_916_380_000);
  });

  it("maps SEPA orders: what was sent and the fee in, what arrived and the fee out", () => {
    const deposits = fiatOrderEventsOf(body("fiat-orders-deposits"), 0, 500);
    expect(deposits.events[0].legs.map((one) => [one.kind, one.nativeAmount, one.nativeCurrency])).toEqual([
      ["deposit", "0.74", "EUR"],
      ["fee", "0.37", "EUR"],
    ]);
    expect(deposits.events[1].legs).toHaveLength(1);
    const withdrawals = fiatOrderEventsOf(body("fiat-orders-withdrawals"), 1, 500);
    expect(withdrawals.events[0].legs.map((one) => [one.kind, one.nativeAmount])).toEqual([
      ["withdrawal", "688.607"],
      ["fee", "0.37"],
    ]);
    expect(withdrawals.full).toBe(false);
  });

  it("maps a card purchase: money in from the card, the coin bought with it", () => {
    const [event] = fiatPaymentEventsOf(body("fiat-payments-buy"), "EUR", 500).events;
    expect(event.externalId).toBe("card:fixture-id-0055");
    expect(
      event.legs.map((one) => [one.leg, one.kind, one.asset?.symbol ?? null, one.quantity, one.nativeAmount]),
    ).toEqual([
      ["quote", "deposit", null, null, "3.7"],
      ["base", "buy", "ETH", "0.0015064", "3.7"],
    ]);
  });

  it("maps Convert as a trade: the coin received bought, the coin given sold", () => {
    const { events } = convertEventsOf(body("convert-trade-flow"), "EUR");
    expect(
      events[0].legs.map((one) => [one.leg, one.kind, one.asset?.symbol, one.quantity, one.nativeCurrency]),
    ).toEqual([
      ["base", "buy", "USDC", "3.57414244", "USDC"],
      ["quote", "sell", "SUI", "1.12629721", "USDC"],
    ]);
    // Into fiat: only the coin given is a leg; the value is the fiat received.
    const toEur = convertEventsOf(
      {
        list: [
          {
            orderId: "1",
            orderStatus: "SUCCESS",
            fromAsset: "BNB",
            fromAmount: "0.1",
            toAsset: "EUR",
            toAmount: "60",
            createTime: "1758916435617",
          },
        ],
      },
      "EUR",
    );
    expect(
      toEur.events[0].legs.map((one) => [one.kind, one.asset?.symbol, one.nativeAmount, one.nativeCurrency]),
    ).toEqual([["sell", "BNB", "60", "EUR"]]);
  });

  it("maps rewards, staking and airdrops as income in the coin", () => {
    const read = dividendEventsOf(body("asset-dividend"), "EUR");
    expect(read.events).toHaveLength(6);
    expect(read.events[1]).toMatchObject({ externalId: "dividend:fixture-id-0062", note: "HODLer Airdrops" });
    expect(read.events[1].legs[0]).toMatchObject({
      kind: "income",
      quantity: "1.29001227",
      nativeCurrency: "ROBO",
    });
    expect(read.oldest).toBe(1_770_610_541_000);
  });

  it("maps a trade: base and quote the opposite way, the commission a leg of its own coin", () => {
    const read = tradeEventsOf(body("my-trades"), "EUR");
    const [sell, buyEur] = read.events;
    expect(sell.externalId).toBe("trade:ETHUSDT:900072");
    expect(sell.legs.map((one) => [one.leg, one.kind, one.asset?.symbol, one.quantity])).toEqual([
      ["base", "sell", "ETH", "0.24346"],
      ["quote", "buy", "USDT", "637.8652"],
      ["fee", "fee", "USDT", "0.6378652"],
    ]);
    // ETH/EUR: the euro is the cash, so the buy alone takes it; the fee is in BNB.
    expect(
      buyEur.legs.map((one) => [one.leg, one.kind, one.asset?.symbol, one.quantity, one.nativeAmount]),
    ).toEqual([
      ["base", "buy", "ETH", "0.041625", "110.9397825"],
      ["fee", "fee", "BNB", "0.00010539", "0.00010539"],
    ]);
    expect(read.lastId).toBe(900_080);
  });

  it("maps the same trade to the same event every time (idempotency, A6)", () => {
    const once = tradeEventsOf(body("my-trades"), "EUR").events;
    const again = tradeEventsOf(body("my-trades"), "EUR").events;
    expect(again).toEqual(once);
    expect(new Set(once.map((one) => one.externalId)).size).toBe(once.length);
  });

  it("discovers the markets of every coin seen anywhere (B3)", () => {
    const markets = new Set(["ADA/EUR", "ADA/USDT", "TON/USDT", "EUR/USDT", "ETH/BTC", "XYZ/ABC"]);
    expect(tradeSymbols(["ADA", "TON", "EUR", "ETH"], "EUR", markets)).toEqual([
      "ADA/EUR",
      "ADA/USDT",
      "ETH/BTC",
      "EUR/USDT",
      "TON/USDT",
    ]);
  });
});

describe("priceLegs (§1.8, A5)", () => {
  const prices = {
    closes: new Map<string, Map<CivilDate, bigint>>([
      ["BNB/EUR", new Map([["2026-01-03", units("800")!]])],
      ["EUR/USDT", new Map([["2024-10-29", units("1.08")!]])],
    ]),
    markets: new Set(["BNB/EUR", "EUR/USDT"]),
  };

  it("prices a coin at its daily close, converts a USDT price, leaves fiat to the ECB", () => {
    const events = tradeEventsOf(body("my-trades"), "EUR").events;
    const [sell, buyEur, buyUsdt] = priceLegs(events, "EUR", prices, () => null);
    // ETH/USDT: the value in USDT at 1 / EUR/USDT of its day, the unit price in euro.
    const base = sell.legs[0];
    expect(base.fxSource).toBe("exchange:EUR/USDT@2024-10-29");
    expect(Number(base.fxRate)).toBeCloseTo(1 / 1.08, 12);
    expect(base.priceCurrency).toBe("EUR");
    expect(Number(base.unitPrice)).toBeCloseTo(2620 / 1.08, 6);
    // ETH/EUR: the euro needs no rate; the BNB fee is priced at BNB/EUR of the day.
    expect(buyEur.legs[0].fxSource).toBeUndefined();
    expect(buyEur.legs[1]).toMatchObject({ fxRate: "800", fxSource: "exchange:BNB/EUR@2026-01-03" });
    // A day without a close: the leg keeps its quantity and no amount.
    expect(buyUsdt.legs.find((one) => one.leg === "fee")).toMatchObject({
      fxRate: null,
      fxSource: "unpriced",
    });
  });

  it("finds the markets of a coin's daily value in the order of §1.8", () => {
    const markets = new Set(["BNB/EUR", "SOL/USDT", "EUR/USDT", "ABC/USDC", "USDC/USD"]);
    expect(candleSymbols("BNB", "EUR", markets)).toEqual(["BNB/EUR"]);
    expect(candleSymbols("SOL", "EUR", markets)).toEqual(["SOL/USDT", "EUR/USDT"]);
    expect(candleSymbols("USDT", "EUR", markets)).toEqual(["EUR/USDT"]);
    expect(candleSymbols("ABC", "EUR", markets)).toEqual(["ABC/USDC", "USDC/USD"]);
    expect(candleSymbols("XYZ", "EUR", markets)).toEqual([]);
  });

  it("reads daily candles by UTC day", () => {
    const closes = closesOf([
      [1_730_160_000_000, 1, 2, 0.5, 1.5, 100],
      [1_730_246_400_000, 1, 2, 0.5, 0, 100],
    ]);
    expect([...closes.entries()].map(([day, value]) => [day, decimal(value)])).toEqual([
      ["2024-10-29", "1.5"],
    ]);
  });
});

describe("quantities (A6)", () => {
  it("opening + Σ legs = the quantity reported, coin by coin", () => {
    const events: ProviderEvent[] = [
      ...transferEventsOf(body("deposits"), "deposit", "EUR").events,
      ...transferEventsOf(body("withdrawals"), "withdrawal", "EUR").events,
      ...tradeEventsOf(body("my-trades"), "EUR").events,
      ...dividendEventsOf(body("asset-dividend"), "EUR").events,
      ...convertEventsOf(body("convert-trade-flow"), "EUR").events,
      ...fiatPaymentEventsOf(body("fiat-payments-buy"), "EUR", 500).events,
    ];
    const net = netQuantities(events);
    const reported = new Map([
      ["ETH", units("0.5")!],
      ["BNB", units("0.01")!],
      ["TRX", units("0.00376788")!],
    ]);
    for (const [coin, quantity] of reported) {
      const opening = quantity - (net.get(coin) ?? 0n);
      expect(opening + (net.get(coin) ?? 0n)).toBe(quantity);
    }
    // The fee in BNB takes BNB out; the ETH bought with euro adds it; a withdrawal takes it and its fee.
    expect(decimal(net.get("TRX")!)).toBe("0.00376788");
    expect(net.get("BNB")! < 0n).toBe(true);
    expect(decimal(net.get("SUI")!)).toBe(
      decimal(units("1.12629721")! - units("1.52967699")! - units("0.0222")! - units("1.12629721")!),
    );
  });
});

describe("windows and coverage (A7, D11)", () => {
  it("cuts 24 months in windows of 90 days, back to back, without overlap or gap", () => {
    const from = Date.UTC(2024, 9, 28);
    const until = Date.UTC(2026, 9, 28);
    const windows = windowsOf(from, until, 90);
    expect(windows).toHaveLength(9);
    expect(windows[0].since).toBe(from);
    expect(windows.at(-1)!.until).toBe(until);
    for (let i = 1; i < windows.length; i += 1) expect(windows[i].since).toBe(windows[i - 1].until + 1);
    for (const one of windows) expect(one.until - one.since).toBeLessThan(90 * 86_400_000);
  });

  it("declares the history before the 24 months as a gap", () => {
    const from = new Date("2024-10-28T00:00:00Z");
    const now = new Date("2026-10-28T00:00:00Z");
    expect(binanceCoverage(["deposits"], from, now)).toEqual([
      expect.objectContaining({ stream: "deposits", status: "gap", reason: "api_limit_24m", toAt: from }),
      { stream: "deposits", fromAt: from, toAt: now, status: "complete", reason: null },
    ]);
  });

  it("is named for its provider in every error", () => {
    expect(BINANCE_PROVIDER).toBe("ccxt:binance");
  });
});

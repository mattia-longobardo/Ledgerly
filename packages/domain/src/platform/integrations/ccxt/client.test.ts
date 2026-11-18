// The ccxt client (docs/design/investments.md §3.2, §5.1): options built field by field (SEC-03)
// and every ccxt failure reduced to an allowed class (SEC-04), never its message.
import * as ccxt from "ccxt";
import { describe, expect, it } from "vitest";
import { SourceError, sourceErrorText } from "../investments/source";
import { CCXT_TIMEOUT_MS, ccxtErrorOf, exchangeOptions } from "./client";

const KEYS = { api_key: "canary-binance-key-31c7", secret: "canary-binance-secret-8e02" };

describe("exchangeOptions (SEC-03)", () => {
  it("passes the key and the secret, and fixes everything else", () => {
    expect(exchangeOptions(KEYS)).toEqual({
      apiKey: KEYS.api_key,
      secret: KEYS.secret,
      enableRateLimit: true,
      timeout: CCXT_TIMEOUT_MS,
      verbose: false,
      options: { defaultType: "spot", fetchMarkets: { types: ["spot"] }, fetchCurrencies: false },
    });
    expect(CCXT_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000);
  });

  it("never lets a field of the credentials reach ccxt", () => {
    const options = exchangeOptions({
      ...KEYS,
      httpsProxy: "http://attacker.test:8080",
      hostname: "attacker.test",
      urls: "x",
    });
    const text = JSON.stringify(options);
    for (const word of ["Proxy", "proxy", "hostname", "urls", "attacker"]) expect(text).not.toContain(word);
  });

  it("refuses credentials without a key or a secret", () => {
    expect(() => exchangeOptions({ api_key: KEYS.api_key })).toThrow(SourceError);
  });

  it("builds a real exchange with no proxy and the catalog's host", () => {
    const exchange = new ccxt.binance(exchangeOptions(KEYS));
    expect(exchange.httpsProxy).toBeUndefined();
    expect(exchange.httpProxy).toBeUndefined();
    expect(exchange.socksProxy).toBeUndefined();
    expect(exchange.verbose).toBe(false);
    expect(JSON.stringify(exchange.urls.api)).toContain("api.binance.com");
  });
});

describe("ccxtErrorOf (§5.1, SEC-04)", () => {
  const secret = `GET https://api.binance.com/sapi/v1/account?signature=abc&apiKey=${KEYS.api_key}`;

  it.each([
    [new ccxt.AuthenticationError(secret), "auth"],
    [new ccxt.PermissionDenied(secret), "permission"],
    [new ccxt.RateLimitExceeded(secret), "rate_limited"],
    [new ccxt.DDoSProtection(secret), "rate_limited"],
    [new ccxt.RequestTimeout(secret), "timeout"],
    [new ccxt.ExchangeNotAvailable(secret), "unavailable"],
    [new ccxt.OnMaintenance(secret), "unavailable"],
    [new ccxt.BadResponse(secret), "bad_response"],
    [new ccxt.NetworkError(secret), "network"],
    [new ccxt.ExchangeError(secret), "bad_response"],
    [new Error(secret), "bad_response"],
  ])("maps %o to a class, without its message", (error, errorClass) => {
    const mapped = ccxtErrorOf(ccxt, "ccxt:binance", error);
    expect(mapped.errorClass).toBe(errorClass);
    const text = `${sourceErrorText("ccxt:binance", mapped)} ${String(mapped)} ${mapped.message}`;
    expect(text).not.toContain(KEYS.api_key);
    expect(text).not.toContain("signature");
  });
});

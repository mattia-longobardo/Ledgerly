import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/timeoff/jobs", () => ({ runTrekPass: vi.fn() }));
vi.mock("@/modules/transactions/jobs", () => ({ runWalletPass: vi.fn() }));
vi.mock("./paperless/sync", () => ({ runPaperlessPass: vi.fn() }));
vi.mock("./service", () => ({ listConnections: vi.fn() }));

const { PASSES, passFor } = await import("./registry");
const { KINDS_OF, PROVIDERS } = await import("./rules");

const stub = (provider: string) => ({ provider, kinds: [], run: vi.fn() });

describe("PASSES", () => {
  it("has one pass for every provider, with that provider's kinds", () => {
    expect(PASSES.map((pass) => pass.provider).sort()).toEqual([...PROVIDERS].sort());
    for (const pass of PASSES) {
      expect(pass.kinds).toEqual(KINDS_OF[pass.provider as keyof typeof KINDS_OF]);
    }
  });
});

describe("passFor", () => {
  it("finds a provider by its id", () => {
    for (const provider of PROVIDERS) expect(passFor(provider)?.provider).toBe(provider);
  });

  it("is null for a provider nobody passes", () => {
    expect(passFor("ccxt:kraken")).toBeNull();
    expect(passFor("")).toBeNull();
  });

  it("matches a family by its prefix, an exact id first and the longest prefix next", () => {
    const passes = [stub("ccxt:"), stub("ccxt:kraken"), stub("ccxt:binance:"), stub("wallet")];
    expect(passFor("ccxt:binance", passes)?.provider).toBe("ccxt:");
    expect(passFor("ccxt:kraken", passes)?.provider).toBe("ccxt:kraken");
    expect(passFor("ccxt:binance:futures", passes)?.provider).toBe("ccxt:binance:");
    // An id without the colon is not a prefix: `wallet` does not stand for `wallet2`.
    expect(passFor("wallet2", passes)).toBeNull();
  });
});

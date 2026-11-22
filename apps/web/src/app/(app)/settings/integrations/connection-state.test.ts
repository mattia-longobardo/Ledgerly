import { describe, expect, it } from "vitest";
import { accountsLeft, sourceHref, sourceSlugOf } from "./connection-state";

describe("the page of a source", () => {
  it("is the plugin's id, or the provider of the core; the investment services have none", () => {
    expect(sourceSlugOf("plugin:enablebanking")).toBe("enablebanking");
    expect(sourceHref("plugin:enablebanking")).toBe("/settings/integrations/enablebanking");
    expect(sourceSlugOf("ccxt:binance")).toBeNull();
    expect(sourceHref("unknown")).toBeNull();
  });
});

describe("the accounts a bank's 'Disconnect' leaves", () => {
  const provider = "plugin:bank";
  const accounts = [
    { provider, providerAccountId: "b-1" },
    { provider, providerAccountId: "b-2" },
    { provider: "plugin:other", providerAccountId: "b-3" },
    { provider: null, providerAccountId: null },
  ];

  it("counts the accounts here that the access reads", () => {
    expect(accountsLeft(accounts, provider, new Set(["b-1", "b-2"]))).toBe(2);
  });

  it("does not count an account the bank still has but was deleted here (N7.1 review)", () => {
    // "b-9" is exposed by the bank, and its account here was deleted: nothing stays of it.
    expect(accountsLeft(accounts, provider, new Set(["b-1", "b-2", "b-9"]))).toBe(2);
  });

  it("does not count an account of another source with the same id", () => {
    expect(accountsLeft(accounts, provider, new Set(["b-3"]))).toBe(0);
  });
});

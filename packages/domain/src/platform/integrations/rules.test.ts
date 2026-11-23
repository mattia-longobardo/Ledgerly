import { describe, expect, it } from "vitest";
import {
  addonOf,
  isBankPlugin,
  pluginKinds,
  connectionStateAfter,
  credentialsSchema,
  isKnownProvider,
  nextRunAt,
  normalizeCounts,
  outcomeState,
  providerLinkSchema,
  syncErrorText,
  syncsTransactions,
} from "./rules";
import { TREK_PROVIDER, WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

const ENTITY = "01930000-0000-7000-8000-000000000001";
const NOW = new Date("2026-03-10T08:00:00Z");

describe("isKnownProvider", () => {
  it("accepts the providers the app speaks to and nothing else", () => {
    expect(isKnownProvider("etoro")).toBe(true);
    expect(isKnownProvider("ccxt:binance")).toBe(true);
    // A plugin is no provider of the core: what it can do is its manifest's (R5c P3b).
    expect(isKnownProvider(WALLET_PROVIDER)).toBe(false);
    expect(isKnownProvider(TREK_PROVIDER)).toBe(false);
    expect(isKnownProvider("monzo")).toBe(false);
    expect(isKnownProvider("")).toBe(false);
  });
});

describe("credentialsSchema", () => {
  it("accepts a flat bag of non-empty strings", () => {
    expect(credentialsSchema.parse({ token: "wallet-token", baseUrl: "https://rest.example" })).toEqual({
      token: "wallet-token",
      baseUrl: "https://rest.example",
    });
  });

  it("refuses an empty bag, an empty value and a key that is not an identifier", () => {
    expect(credentialsSchema.safeParse({}).success).toBe(false);
    expect(credentialsSchema.safeParse({ token: "" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ "my token": "x" }).success).toBe(false);
  });

  it("refuses anything that is not a flat record of strings", () => {
    expect(credentialsSchema.safeParse("wallet-token").success).toBe(false);
    expect(credentialsSchema.safeParse({ token: { value: "x" } }).success).toBe(false);
  });
});

describe("providerLinkSchema", () => {
  const link = {
    provider: WALLET_PROVIDER,
    entityType: "transaction" as const,
    entityId: ENTITY,
    externalId: "  w-42  ",
  };

  it("trims the external id and defaults metadata to null", () => {
    expect(providerLinkSchema.parse(link)).toEqual({ ...link, externalId: "w-42", metadata: null });
  });

  it("treats metadata left out and metadata set to null the same way", () => {
    expect(providerLinkSchema.parse({ ...link, metadata: null }).metadata).toBeNull();
    expect(providerLinkSchema.parse({ ...link, metadata: undefined }).metadata).toBeNull();
  });

  it("refuses an unknown provider, an unknown entity type and a non-uuid entity", () => {
    expect(providerLinkSchema.safeParse({ ...link, provider: "monzo" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, entityType: "payslip" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, entityId: "42" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, externalId: "   " }).success).toBe(false);
  });
});

describe("nextRunAt", () => {
  it("schedules the next pass one interval away", () => {
    expect(nextRunAt(NOW)).toEqual(new Date("2026-03-10T09:00:00Z"));
    expect(nextRunAt(NOW, 6)).toEqual(new Date("2026-03-10T14:00:00Z"));
  });
});

describe("outcomeState and connectionStateAfter", () => {
  it("reads a run with no error as a success", () => {
    expect(outcomeState({})).toBe("success");
    expect(outcomeState({ error: null })).toBe("success");
    expect(connectionStateAfter({ error: null })).toBe("active");
  });

  it("reads a run that carries an error as a failure", () => {
    expect(outcomeState({ error: "token rejected" })).toBe("failed");
    expect(connectionStateAfter({ error: "token rejected" })).toBe("error");
  });
});

describe("syncErrorText", () => {
  it("collapses an error onto one line", () => {
    expect(syncErrorText("  wallet said\n  no\t\n")).toBe("wallet said no");
  });

  it("caps a long error, marking that it was cut", () => {
    const capped = syncErrorText("x".repeat(900));
    expect(capped).toHaveLength(500);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("keeps an error that is exactly as long as the cap", () => {
    expect(syncErrorText("x".repeat(500))).toBe("x".repeat(500));
  });
});

describe("normalizeCounts", () => {
  it("sorts the keys so two runs that counted the same store the same object", () => {
    expect(Object.keys(normalizeCounts({ updated: 2, created: 1, skipped: 0 }))).toEqual([
      "created",
      "skipped",
      "updated",
    ]);
  });

  it("drops what jsonb cannot hold and rounds the rest to a whole count", () => {
    expect(normalizeCounts({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 2.6, d: -3 })).toEqual({
      c: 3,
      d: 0,
    });
  });
});

describe("syncsTransactions", () => {
  it("is true only for a known provider that brings in movements", () => {
    expect(syncsTransactions(WALLET_PROVIDER)).toBe(true);
    // Any plugin's accounts take their movements from it; a leave calendar has no account at all.
    expect(syncsTransactions(TREK_PROVIDER)).toBe(true);
    expect(syncsTransactions("ccxt:binance")).toBe(false);
    expect(syncsTransactions(null)).toBe(false);
  });
});

describe("what a plugin does, from its manifest's capabilities (R5c P3b)", () => {
  const SOURCE = ["source.read", "createRecord", "editRecord", "categories", "deleteCategory"];
  const CALENDAR = ["leaveCalendar", "provider.write"];
  const BANK = ["windowedHistory"];

  it("reads the days of a leave calendar, and the accounts then the movements of any other", () => {
    expect(pluginKinds(CALENDAR)).toEqual(["leave"]);
    expect(pluginKinds(SOURCE)).toEqual(["accounts", "transactions"]);
    expect(pluginKinds(BANK)).toEqual(["accounts", "transactions"]);
  });

  it("belongs to time off for a leave calendar and to nothing for any other plugin", () => {
    expect(addonOf(TREK_PROVIDER, CALENDAR)).toBe("timeoff");
    expect(addonOf(WALLET_PROVIDER, SOURCE)).toBeUndefined();
    expect(addonOf("plugin:enablebanking", BANK)).toBeUndefined();
    // A provider of the core keeps its own: no manifest.
    expect(addonOf("etoro", null)).toBe("investments");
  });

  it("is a bank's plugin only when no engine of the core reads it", () => {
    expect(isBankPlugin(BANK)).toBe(true);
    expect(isBankPlugin([])).toBe(true);
    expect(isBankPlugin(SOURCE)).toBe(false);
    expect(isBankPlugin(CALENDAR)).toBe(false);
  });
});

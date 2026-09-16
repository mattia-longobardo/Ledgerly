import { describe, expect, it } from "vitest";
import {
  connectionStateAfter,
  credentialsSchema,
  isDue,
  isKnownProvider,
  nextRunAt,
  normalizeCounts,
  outcomeState,
  providerLinkSchema,
  syncErrorText,
  WALLET_PROVIDER,
} from "./rules";

const ENTITY = "01930000-0000-7000-8000-000000000001";
const NOW = new Date("2026-03-10T08:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe("isKnownProvider", () => {
  it("accepts the provider F2 speaks to and nothing else", () => {
    expect(isKnownProvider(WALLET_PROVIDER)).toBe(true);
    expect(isKnownProvider("trek")).toBe(false);
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
    expect(providerLinkSchema.safeParse({ ...link, provider: "trek" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, entityType: "payslip" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, entityId: "42" }).success).toBe(false);
    expect(providerLinkSchema.safeParse({ ...link, externalId: "   " }).success).toBe(false);
  });
});

describe("nextRunAt and isDue", () => {
  it("schedules the next pass one interval away", () => {
    expect(nextRunAt(NOW)).toEqual(new Date("2026-03-10T09:00:00Z"));
    expect(nextRunAt(NOW, 6)).toEqual(new Date("2026-03-10T14:00:00Z"));
  });

  it("treats a job that has never run as due, and one scheduled ahead as not", () => {
    expect(isDue({ nextRunAt: null }, NOW)).toBe(true);
    expect(isDue({ nextRunAt: NOW }, NOW)).toBe(true);
    expect(isDue({ nextRunAt: hoursAgo(1) }, NOW)).toBe(true);
    expect(isDue({ nextRunAt: nextRunAt(NOW) }, NOW)).toBe(false);
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

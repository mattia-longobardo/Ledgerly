import { describe, expect, it } from "vitest";
import { PALETTE } from "@ledgerly/design-tokens";
import { changeBetween, colorField, colorFor, shareOf } from "./display";

describe("changeBetween", () => {
  it("is unknown when either end is unknown, never zero", () => {
    expect(changeBetween(null, 100n)).toEqual({ cents: null, fraction: null });
    expect(changeBetween(100n, null)).toEqual({ cents: null, fraction: null });
  });

  it("measures the change against the earlier value", () => {
    expect(changeBetween(150n, 100n)).toEqual({ cents: 50n, fraction: 0.5 });
    expect(changeBetween(50n, 100n)).toEqual({ cents: -50n, fraction: -0.5 });
  });

  it("gives no percentage when the earlier value was zero", () => {
    expect(changeBetween(50n, 0n)).toEqual({ cents: 50n, fraction: null });
  });

  it("measures a rise from a negative balance as a rise", () => {
    expect(changeBetween(-50n, -100n)).toEqual({ cents: 50n, fraction: 0.5 });
  });
});

describe("shareOf", () => {
  it("is null rather than a misleading zero when the total is unknown or empty", () => {
    expect(shareOf(10n, null)).toBeNull();
    expect(shareOf(10n, 0n)).toBeNull();
    expect(shareOf(null, 100n)).toBeNull();
  });

  it("is the fraction of the total", () => {
    expect(shareOf(25n, 100n)).toBe(0.25);
  });
});

describe("colorFor", () => {
  it("prefers the account's own colour and falls back to the palette in order", () => {
    expect(colorFor({ color: "#123456" }, 3)).toBe("#123456");
    expect(colorFor({ color: null }, 0)).toBe(PALETTE[0]);
    expect(colorFor({ color: null }, PALETTE.length)).toBe(PALETTE[0]);
  });
});

describe("colorField", () => {
  it("shows the chosen colour as chosen", () => {
    expect(colorField({ color: "#123456" }, 3)).toEqual({ value: "#123456", automatic: false });
  });

  it("shows the palette colour of the account's place when it has none of its own", () => {
    expect(colorField({ color: null }, 2)).toEqual({ value: PALETTE[2], automatic: true });
    expect(colorField({ color: null }, PALETTE.length + 1)).toEqual({ value: PALETTE[1], automatic: true });
  });

  it("agrees with what the charts draw", () => {
    const account = { color: null };
    expect(colorField(account, 5).value).toBe(colorFor(account, 5));
  });
});

import { describe, expect, it } from "vitest";
import {
  hasIbanField,
  type IbanHolder,
  ibanConflict,
  type LocalAccount,
  type RemoteAccount,
  reconcileProviderAccounts,
} from "./rules";

// Example numbers of the standard: no person's IBAN.
const IBAN = "IT60X0542811101000000123456";
const OTHER = "GB82WEST12345698765432";

const holder = (id: string, iban: string | null, state: IbanHolder["state"] = "active"): IbanHolder => ({
  id,
  name: `Account ${id}`,
  iban,
  state,
});

describe("hasIbanField (H47)", () => {
  it("is true for the accounts with movements and false for investments, pensions and crypto", () => {
    for (const type of ["checking", "savings", "cash", "credit", "other"] as const)
      expect(hasIbanField(type)).toBe(true);
    for (const type of ["investment", "pension", "crypto"] as const) expect(hasIbanField(type)).toBe(false);
  });
});

describe("ibanConflict (H39: one IBAN, one account)", () => {
  it("names the open account that already has the IBAN", () => {
    expect(ibanConflict(IBAN, [holder("a", OTHER), holder("b", IBAN)])).toEqual({
      kind: "exists",
      accountId: "b",
      name: "Account b",
    });
  });

  it("finds nothing for a new IBAN, and leaves the account itself out", () => {
    expect(ibanConflict(IBAN, [holder("a", OTHER), holder("b", null)])).toBeNull();
    expect(ibanConflict(IBAN, [holder("b", IBAN)], "b")).toBeNull();
  });

  it("names an archived account only when no open account has the IBAN", () => {
    expect(ibanConflict(IBAN, [holder("old", IBAN, "archived")])).toMatchObject({
      kind: "archived",
      accountId: "old",
    });
    expect(ibanConflict(IBAN, [holder("old", IBAN, "archived"), holder("new", IBAN)])).toMatchObject({
      kind: "exists",
      accountId: "new",
    });
  });

  it("treats an account the source stopped sending as open", () => {
    expect(ibanConflict(IBAN, [holder("gone", IBAN, "unavailable")])).toMatchObject({ kind: "exists" });
  });
});

const local = (overrides: Partial<LocalAccount>): LocalAccount => ({
  id: "l",
  name: "Local",
  origin: "manual",
  state: "active",
  provider: null,
  providerAccountId: null,
  renamedLocally: false,
  type: "checking",
  retypedLocally: false,
  iban: null,
  ...overrides,
});

const remote = (overrides: Partial<RemoteAccount>): RemoteAccount => ({
  provider: "source",
  providerAccountId: "r",
  name: "Remote",
  type: "checking",
  currency: "EUR",
  iban: null,
  ...overrides,
});

describe("reconcileProviderAccounts with an IBAN (case 5 of §2.4.2)", () => {
  it("does not create a new account of the source whose IBAN an account here has, from any source", () => {
    const here = local({
      id: "bank",
      origin: "synced",
      provider: "other",
      providerAccountId: "x",
      iban: IBAN,
    });
    expect(reconcileProviderAccounts([here], [remote({ iban: IBAN })], "source")).toEqual([
      { action: "ibanExists", remote: remote({ iban: IBAN }), accountId: "bank" },
    ]);
  });

  it("creates the account when the IBAN is new, when the source gives none, or when only an archived account has it", () => {
    const archived = local({ id: "old", state: "archived", iban: IBAN });
    expect(reconcileProviderAccounts([archived], [remote({ iban: IBAN })], "source")).toEqual([
      { action: "create", remote: remote({ iban: IBAN }) },
    ]);
    expect(
      reconcileProviderAccounts([local({ iban: IBAN })], [remote({ iban: OTHER })], "source")[0].action,
    ).toBe("create");
    expect(reconcileProviderAccounts([local({ iban: IBAN })], [remote({})], "source")[0].action).toBe(
      "create",
    );
  });

  it("writes the IBAN the source gives on an account tied to it, even one another account has", () => {
    const tied = local({
      id: "t",
      origin: "synced",
      provider: "source",
      providerAccountId: "r",
      name: "Remote",
    });
    const other = local({ id: "o", iban: IBAN });
    expect(reconcileProviderAccounts([tied, other], [remote({ iban: IBAN })], "source")).toEqual([
      { action: "iban", id: "t", iban: IBAN },
    ]);
  });

  it("plans nothing when the IBAN is already there, and none for an account without the field", () => {
    const tied = local({
      origin: "synced",
      provider: "source",
      providerAccountId: "r",
      name: "Remote",
      iban: IBAN,
    });
    expect(reconcileProviderAccounts([tied], [remote({ iban: IBAN })], "source")).toEqual([]);
    const fund = local({
      origin: "synced",
      provider: "source",
      providerAccountId: "r",
      name: "Remote",
      type: "investment",
      retypedLocally: true,
    });
    expect(reconcileProviderAccounts([fund], [remote({ iban: IBAN })], "source")).toEqual([]);
  });
});

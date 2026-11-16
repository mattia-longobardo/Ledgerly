// The IBAN of an account (rewrite plan N4a, H39 and H45-H47): the three ways an account is made —
// the procedure of a source, an automatic reading, by hand — call the same rule, and the release
// copies the valid values of "IBAN or reference" without touching that field.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb, getPool } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { listAccounts } from "./queries";
import type { RemoteAccount } from "./rules";
import { accounts } from "./schema";
import {
  AccountError,
  applyProviderAccounts,
  archiveAccount,
  createAccount,
  ibanOwnersOf,
  linkProviderAccounts,
  saveSourceIbans,
  updateAccountSettings,
} from "./service";

// The examples of the standard: no person's IBAN.
const IBAN = "IT60X0542811101000000123456";
const OTHER = "GB82WEST12345698765432";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

const ACCOUNT = {
  name: "Current",
  type: "checking",
  currency: "EUR",
  color: null,
  reference: "",
  iban: "",
  purpose: "",
  openedOn: null,
  notes: "",
};

const SETTINGS = {
  ...ACCOUNT,
  inNetWorth: true,
  inSnapshot: true,
  countsAsLiquid: true,
  lowBalanceCents: null,
  staleAfterHours: 36,
  reminder: "never",
  betweenEntries: "hold",
};

async function refusal(work: Promise<unknown>): Promise<{ code: string; other: string | null }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AccountError) return { code: error.code, other: error.other };
    throw error;
  }
  throw new Error("expected a refusal");
}

const remote = (overrides: Partial<RemoteAccount>): RemoteAccount => ({
  provider: "source",
  providerAccountId: "r-1",
  name: "From the source",
  type: "checking",
  currency: "EUR",
  ...overrides,
});

let ctx: Ctx;
// Every line written to the console during a test: an IBAN must never be in one (H45).
const written: string[] = [];

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  written.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      written.push(
        args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "),
      );
    });
  }
});

afterEach(() => {
  expect(written.join("\n")).not.toContain(IBAN);
  vi.restoreAllMocks();
});

afterAll(closeDatabase);

describe("by hand (§2.4.1, case 4)", () => {
  it("saves the IBAN compact and upper case, and refuses one that is not valid", async () => {
    const account = await createAccount(ctx, { ...ACCOUNT, iban: "it60 x054 2811 1010 0000 0123 456" });
    expect(account).toMatchObject({ iban: IBAN, ibanFromSource: false });
    expect(
      await refusal(createAccount(ctx, { ...ACCOUNT, name: "Bad", iban: "IT61X0542811101000000123456" })),
    ).toEqual({
      code: "iban_invalid",
      other: null,
    });
  });

  it("refuses a second account with the same IBAN, naming the first and never the IBAN", async () => {
    await createAccount(ctx, { ...ACCOUNT, iban: IBAN });
    const refused = await refusal(createAccount(ctx, { ...ACCOUNT, name: "Twin", iban: IBAN }));
    expect(refused).toEqual({ code: "iban_exists", other: "Current" });
    expect((await listAccounts(ctx)).map((one) => one.name)).toEqual(["Current"]);
  });

  it("says when the IBAN is an archived account's", async () => {
    const old = await createAccount(ctx, { ...ACCOUNT, name: "Old", iban: IBAN });
    await archiveAccount(ctx, old.id);
    expect(await refusal(createAccount(ctx, { ...ACCOUNT, iban: IBAN }))).toEqual({
      code: "iban_archived",
      other: "Old",
    });
  });

  it("refuses the IBAN of another account in the settings, and keeps the account's own", async () => {
    const first = await createAccount(ctx, { ...ACCOUNT, iban: IBAN });
    const second = await createAccount(ctx, { ...ACCOUNT, name: "Second" });
    expect(
      await refusal(updateAccountSettings(ctx, second.id, { ...SETTINGS, name: "Second", iban: IBAN })),
    ).toEqual({
      code: "iban_exists",
      other: "Current",
    });
    expect(await updateAccountSettings(ctx, first.id, { ...SETTINGS, iban: IBAN })).toMatchObject({
      iban: IBAN,
    });
    expect(await updateAccountSettings(ctx, first.id, { ...SETTINGS, iban: "" })).toMatchObject({
      iban: null,
    });
  });

  it("gives no IBAN to an investment, a pension or a crypto account (H47)", async () => {
    const fund = await createAccount(ctx, { ...ACCOUNT, type: "investment", iban: IBAN });
    expect(fund.iban).toBeNull();
  });
});

describe("the procedure of a source (cases 2 and 3)", () => {
  it("refuses a new account with an IBAN already here, and writes nothing", async () => {
    await createAccount(ctx, { ...ACCOUNT, iban: IBAN });
    const refused = await refusal(
      linkProviderAccounts(ctx, "plugin:bank", [
        {
          providerAccountId: "b-1",
          currency: "EUR",
          target: { kind: "new", name: "Bank", type: "checking" },
          iban: OTHER,
        },
        {
          providerAccountId: "b-2",
          currency: "EUR",
          target: { kind: "new", name: "Bank twin", type: "checking" },
          iban: `${IBAN.slice(0, 4)} ${IBAN.slice(4)}`,
        },
      ]),
    );
    expect(refused).toEqual({ code: "iban_exists", other: "Current" });
    expect((await listAccounts(ctx)).map((one) => one.name)).toEqual(["Current"]);
  });

  it("writes the source's IBAN on the account it is tied to, read-only from then on", async () => {
    const mine = await createAccount(ctx, ACCOUNT);
    await linkProviderAccounts(ctx, "plugin:bank", [
      {
        providerAccountId: "b-1",
        currency: "EUR",
        target: { kind: "existing", accountId: mine.id },
        iban: IBAN,
      },
    ]);
    const [tied] = await listAccounts(ctx);
    expect(tied).toMatchObject({ iban: IBAN, ibanFromSource: true });
    // A value typed over it is not saved: the source's stays.
    await updateAccountSettings(ctx, mine.id, { ...SETTINGS, iban: OTHER });
    expect((await listAccounts(ctx))[0].iban).toBe(IBAN);
  });

  it("names the open owner of each number that is an IBAN, and leaves the others out", async () => {
    const mine = await createAccount(ctx, { ...ACCOUNT, iban: IBAN });
    const owners = await ibanOwnersOf(ctx, [IBAN.toLowerCase(), OTHER, "1234", null]);
    expect([...owners]).toEqual([[IBAN.toLowerCase(), { id: mine.id, name: "Current", manual: true }]]);
  });
});

describe("an automatic reading of a source (case 5)", () => {
  it("does not create an account with an IBAN already here, and returns the account that has it", async () => {
    const mine = await createAccount(ctx, { ...ACCOUNT, iban: IBAN });
    const outcome = await applyProviderAccounts(ctx, "source", [
      remote({ iban: IBAN }),
      remote({ providerAccountId: "r-2", name: "New", iban: OTHER }),
    ]);
    expect(outcome.ibanConflicts).toEqual([mine.id]);
    const names = (await listAccounts(ctx)).map((one) => [one.name, one.iban, one.ibanFromSource]);
    expect(names).toEqual([
      ["Current", IBAN, false],
      ["New", OTHER, true],
    ]);
  });

  it("writes the IBAN of an account already tied, also one another account has (case 7)", async () => {
    await applyProviderAccounts(ctx, "source", [remote({})]);
    const other = await createAccount(ctx, { ...ACCOUNT, name: "Other", iban: IBAN });
    expect((await applyProviderAccounts(ctx, "source", [remote({ iban: IBAN })])).ibanConflicts).toEqual([]);
    const rows = await listAccounts(ctx);
    expect(
      rows
        .filter((one) => one.iban === IBAN)
        .map((one) => one.id)
        .sort(),
    ).toEqual([other.id, rows.find((one) => one.name === "From the source")!.id].sort());
  });

  it("keeps the IBANs a bank gives at its readings, and only those that are an IBAN", async () => {
    const mine = await createAccount(ctx, ACCOUNT);
    const fund = await createAccount(ctx, { ...ACCOUNT, name: "Fund", type: "investment" });
    expect(
      await saveSourceIbans(ctx, [
        { accountId: mine.id, iban: IBAN },
        { accountId: fund.id, iban: OTHER },
      ]),
    ).toBe(1);
    expect(
      await saveSourceIbans(ctx, [
        { accountId: mine.id, iban: IBAN },
        { accountId: mine.id, iban: "nope" },
      ]),
    ).toBe(0);
    expect((await listAccounts(ctx)).map((one) => [one.name, one.iban])).toEqual([
      ["Current", IBAN],
      ["Fund", null],
    ]);
  });
});

describe("the data of the release (H46, 06-data.md §6.1)", () => {
  /** The copy of the migration, as the file has it. */
  function copyStatement(): string {
    const text = readFileSync(join(process.cwd(), "drizzle/0056_account_iban.sql"), "utf8");
    const statements = text
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => /^(--.*\n)*\s*UPDATE "accounts"/.test(statement));
    expect(statements).toHaveLength(1);
    return statements[0];
  }

  it("copies the valid IBANs of the reference into the IBAN field, and leaves the reference as it was", async () => {
    const values = {
      spaced: "it60 x054 2811 1010 0000 0123 456",
      compact: OTHER,
      wrong: "IT61X0542811101000000123456",
      text: "Conto di casa",
      fund: IBAN,
      twin: IBAN,
    };
    for (const [name, reference] of Object.entries(values)) {
      await createAccount(ctx, {
        ...ACCOUNT,
        name,
        reference,
        type: name === "fund" ? "pension" : "checking",
      });
    }
    await createAccount(ctx, { ...ACCOUNT, name: "empty" });
    // The state the image before this release leaves: no IBAN anywhere.
    await getDb().update(accounts).set({ iban: null });

    await getPool().query(copyStatement());
    const rows = await listAccounts(ctx);
    const by = (name: string) => rows.find((row) => row.name === name)!;
    expect(by("spaced")).toMatchObject({ iban: IBAN, reference: values.spaced, ibanFromSource: false });
    expect(by("compact")).toMatchObject({ iban: OTHER, reference: OTHER });
    expect(by("twin").iban).toBe(IBAN);
    for (const name of ["wrong", "text", "fund", "empty"]) expect(by(name).iban, name).toBeNull();
    expect(by("wrong").reference).toBe(values.wrong);

    // Run twice, it changes nothing more.
    await getPool().query(copyStatement());
    expect((await listAccounts(ctx)).map((row) => row.iban)).toEqual(rows.map((row) => row.iban));
  });
});

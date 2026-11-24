import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveAccount,
  createAccount,
  runSnapshot,
  saveBalanceEntry,
} from "@domain/modules/accounts/service";
import { recordValuation, updateValuation } from "@domain/modules/funds/service";
import { createManualPayslip, uploadPayslip } from "@domain/modules/payroll/service";
import type { IncomingTransaction } from "@domain/modules/transactions/rules";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import type { Ctx } from "@domain/platform/context";
import { createManualService } from "@domain/modules/investments/service";
import { saveRates } from "@domain/platform/fx/service";
import { addDays, today } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { debitFund, payrollFund } from "../../../../../test/funds";
import { createTestUser } from "../../../../../test/users";
import { readZip } from "../../../../../test/zip";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

vi.mock("next/server", () => ({ after: () => {} }));

const { exportUserBytes } = await import("./service");

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

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

async function anAccount(ctx: Ctx, name: string): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

function movement(payee: string): IncomingTransaction {
  return {
    externalId: `w-${payee}`,
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T09:00:00Z"),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

/** A tiny but real PDF: the sniffer looks at the signature, which is all this needs to be. */
const aPayslip = (marker: string) => ({
  name: `${marker}.pdf`,
  bytes: new TextEncoder().encode(`%PDF-1.4\n% ${marker}\n%%EOF\n`),
});

const NOW = new Date("2026-09-21T10:00:00Z");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("exportUser", () => {
  it("holds a README, every table twice and the person's own documents", async () => {
    const ctx = await newContext();
    const accountId = await anAccount(ctx, "ING Conto Arancio");
    await saveBalanceEntry(ctx, accountId, { on: "2026-03-31", cents: 1_234_56n });
    await upsertFromProvider(ctx, accountId, [movement("Esselunga")], { provider: WALLET_PROVIDER });
    const { document } = await uploadPayslip(ctx, aPayslip("mine"));

    const zip = await readZip(await exportUserBytes(ctx, NOW));
    const paths = [...zip.keys()];
    expect(paths).toContain("README.txt");
    expect(paths).toContain("ledgerly.json");
    for (const table of ["accounts", "balances", "transactions", "subscriptions", "documents"]) {
      expect(paths, table).toContain(`${table}.csv`);
    }
    expect(paths).toContain(`documents/${document.id}-mine.pdf`);

    const accounts = zip.get("accounts.csv")!.toString("utf8");
    expect(accounts.startsWith("﻿")).toBe(true);
    expect(accounts).toContain("ING Conto Arancio");
    expect(accounts).toContain("1234.56");

    const json = JSON.parse(zip.get("ledgerly.json")!.toString("utf8"));
    expect(json.exportedAt).toBe(NOW.toISOString());
    expect(json.preferences.timeZone).toBe("Europe/Rome");
    expect(json.transactions[0]).toMatchObject({ payee: "Esselunga", amount: "-25.00" });
    // The CSV and the JSON are made from one set of rows: they cannot disagree.
    expect(zip.get("transactions.csv")!.toString("utf8")).toContain("Esselunga");
  });

  it("never holds the IBAN of an account, neither whole nor masked (rewrite plan N4, H45)", async () => {
    const ctx = await newContext();
    const iban = "IT60X0542811101000000123456";
    await createAccount(ctx, {
      name: "Savings box",
      type: "savings",
      currency: "EUR",
      color: null,
      reference: "",
      iban,
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: null,
    });
    const zip = await readZip(await exportUserBytes(ctx, NOW));
    expect(zip.get("accounts.csv")!.toString("utf8")).toContain("Savings box");
    for (const [path, bytes] of zip) {
      const text = bytes.toString("utf8");
      expect(text, path).not.toContain(iban);
      expect(text, path).not.toContain("0123 456");
    }
  });

  it("contains none of another person's rows and none of their documents", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const myAccount = await anAccount(mine, "Mine");
    const theirAccount = await anAccount(theirs, "Theirs");
    await upsertFromProvider(mine, myAccount, [movement("MyShop")], { provider: WALLET_PROVIDER });
    await upsertFromProvider(theirs, theirAccount, [movement("TheirShop")], { provider: WALLET_PROVIDER });
    await uploadPayslip(mine, aPayslip("mine"));
    const { document: other } = await uploadPayslip(theirs, aPayslip("theirs"));

    const zip = await readZip(await exportUserBytes(mine, NOW));
    const everything = [...zip.values()].map((bytes) => bytes.toString("utf8")).join("\n");
    expect(everything).toContain("MyShop");
    expect(everything).not.toContain("TheirShop");
    expect(everything).not.toContain("Theirs");
    expect([...zip.keys()].some((path) => path.includes(other.id))).toBe(false);
    expect([...zip.keys()].some((path) => path.endsWith("-theirs.pdf"))).toBe(false);
  });

  it("is a readable archive for somebody who owns nothing at all", async () => {
    const zip = await readZip(await exportUserBytes(await newContext(), NOW));
    expect(zip.get("accounts.csv")!.toString("utf8")).toBe(
      "﻿name;type;currency;origin;state;balance;inNetWorth;countsAsLiquid\r\n",
    );
    expect(JSON.parse(zip.get("ledgerly.json")!.toString("utf8")).accounts).toEqual([]);
  });
});

describe("exportFileName", () => {
  it("writes a fund's documented value, not the copy of a month end (funds-ux F5)", async () => {
    const ctx = await newContext();
    const fund = await debitFund(ctx, {
      name: "PAC",
      startOn: "2026-01-01",
      initialCents: 100_000n,
    });
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-09-30", cents: 110_000n });
    await runSnapshot(ctx, "2026-10-01");
    await updateValuation(ctx, valuation.id, { on: "2026-09-30", cents: 120_000n });
    const zip = await readZip(await exportUserBytes(ctx, NOW));
    const row = zip.get("funds.csv")!.toString("utf8");
    expect(row).toContain("1200.00");
    expect(row).toContain("2026-09-30");
    expect(row).not.toContain("1100.00");
  });

  it("says every fund is a pension fund, and lists its sources and its fees (release N6, exception X3)", async () => {
    const ctx = await newContext();
    await debitFund(ctx, {
      name: "Fondo Beta",
      provider: "Esempio Previdenza",
      code: "LU0987654321",
      startOn: "2026-01-01",
      monthlyCents: 25_100n,
      debitDay: 5,
      depositFeeCents: 100n,
      ter: "0.012",
    });
    await payrollFund(ctx, { name: "Fondo Alfa", startOn: "2026-01-01" });
    const zip = await readZip(await exportUserBytes(ctx, NOW));
    const json = JSON.parse(zip.get("ledgerly.json")!.toString("utf8")) as Record<
      string,
      Record<string, unknown>[]
    >;
    // `kind` has one value, whatever the fund was before; the old column `isin` holds the fund's code.
    expect(json.funds.map((fund) => [fund.name, fund.kind, fund.isin])).toEqual([
      ["Fondo Alfa", "pension", null],
      ["Fondo Beta", "pension", "LU0987654321"],
    ]);
    expect(json["fund-sources"]).toEqual([
      expect.objectContaining({
        fund: "Fondo Alfa",
        kind: "payroll",
        state: "active",
        components: "worker employer tfr",
        accrualPeriod: "quarter",
        dueDay: 20,
        dueOffsetMonths: 1,
        toleranceDays: 15,
      }),
      expect.objectContaining({
        fund: "Fondo Beta",
        kind: "bank_debit",
        amount: "251.00",
        debitDay: 5,
        every: 1,
        unit: "month",
      }),
    ]);
    expect(
      json["fund-fees"].map((fee) => [fee.fund, fee.basis, fee.amount, fee.rate, fee.period, fee.source]),
    ).toEqual([
      ["Fondo Alfa", "one_off", "10.32", null, null, "payroll"],
      ["Fondo Alfa", "periodic", "3.00", null, "quarter", "payroll"],
      ["Fondo Beta", "per_contribution", "1.00", null, null, "bank_debit"],
      ["Fondo Beta", "on_assets", null, "0.012000", "year", null],
    ]);
    expect(zip.has("fund-sources.csv")).toBe(true);
    expect(zip.has("fund-fees.csv")).toBe(true);
    // No value of the type of before is written anywhere in the archive's tables.
    expect(zip.get("funds.csv")!.toString("utf8")).not.toMatch(/\bpac\b/i);
  });
});

describe("the payslips of the export (rewrite plan R5g, criterion 6)", () => {
  it("lists the base fields of a payslip and a column for every field a pack registers", async () => {
    const ctx = await newContext();
    await createManualPayslip(ctx, {
      kind: "extra",
      year: 2026,
      month: null,
      extraNumber: 1,
      paidOn: null,
      gross: 300_000n,
      taxes: 60_000n,
      contributions: 28_000n,
      net: 210_000n,
      fields: { irpefGross: 65_000n },
      documentId: null,
    });
    const zip = await readZip(await exportUserBytes(ctx, NOW));
    const json = JSON.parse(zip.get("ledgerly.json")!.toString("utf8")) as Record<
      string,
      Record<string, unknown>[]
    >;
    expect(json.payslips).toEqual([
      expect.objectContaining({
        kind: "extra",
        extraNumber: 1,
        type: "thirteenth",
        source: "manual",
        gross: "3000.00",
        taxes: "600.00",
        contributions: "280.00",
        net: "2100.00",
        document: null,
        irpefGross: "650.00",
        tfrSelected: null,
      }),
    ]);
    expect(zip.get("payslips.csv")!.toString("utf8").split("\n")[0]).toContain("irpefGross");
  });
});

describe("the investments of the export", () => {
  /** A manual service whose account held `before` ten days ago and holds `now` today. */
  async function service(ctx: Ctx, name: string, currency: string, before: bigint, now: bigint) {
    const todayOn = today(ctx.timeZone);
    const account = await createAccount(ctx, { name, type: "investment", currency });
    await saveBalanceEntry(ctx, account.id, { on: addDays(todayOn, -10), cents: before });
    await saveBalanceEntry(ctx, account.id, { on: todayOn, cents: now });
    await createManualService(ctx, { accountId: account.id, category: "broker", url: null });
    return account.id;
  }

  it("lists every service, the archived ones too, in its own currency (decisions D9, D10)", async () => {
    const ctx = await newContext();
    const todayOn = today(ctx.timeZone);
    const rates = [];
    for (let on = addDays(todayOn, -400); on <= todayOn; on = addDays(on, 1))
      rates.push({ on, currency: "USD", eurPerUnit: "0.8500000000" });
    await saveRates(rates);
    await service(ctx, "Directa", "EUR", 100_000n, 110_000n);
    await service(ctx, "IBKR", "USD", 200_000n, 230_000n);
    await archiveAccount(ctx, await service(ctx, "Vecchio", "EUR", 50_000n, 50_000n));
    const zip = await readZip(await exportUserBytes(ctx));
    const json = JSON.parse(zip.get("ledgerly.json")!.toString("utf8")) as Record<string, unknown[]>;
    // A service that opened today has no return of the year yet: `modifiedDietz` is null (D9).
    const common = {
      category: "broker",
      provider: "manual",
      mode: "total",
      reliableFrom: null,
      modifiedDietz: null,
    };
    expect(json["investment-services"]).toEqual([
      {
        ...common,
        name: "Directa",
        currency: "EUR",
        value: "1100.00",
        invested: "1000.00",
        gain: "100.00",
        simpleReturn: 0.1,
        xirr: "none",
        archived: false,
      },
      {
        ...common,
        name: "IBKR",
        currency: "USD",
        value: "2300.00",
        invested: "2000.00",
        gain: "300.00",
        simpleReturn: 0.15,
        xirr: "none",
        archived: false,
      },
      {
        ...common,
        name: "Vecchio",
        currency: "EUR",
        value: "500.00",
        invested: "500.00",
        gain: "0.00",
        simpleReturn: 0,
        xirr: "multiple",
        archived: true,
      },
    ]);
  });
});

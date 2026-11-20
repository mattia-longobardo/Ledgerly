// scripts/seed-e2e/layout.ts — the `layout` user, who has something on every page: the screen, keyboard and
// phone checks of every flow are measured on it.
import { createHash } from "node:crypto";
import { BANK_PLUGIN_ID as BANK_PLUGIN } from "../../apps/web/src/app/(app)/banks/plugin";
import {
  addConnection,
  createAccount,
  saveBalanceEntry,
  saveProviderBalance,
} from "@domain/modules/accounts/service";
import { setLimit } from "@domain/modules/budgets/service";
import { recordValuation } from "@domain/modules/funds/service";
import { createRule } from "@domain/modules/interests/service";
import { createManualService } from "@domain/modules/investments/service";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "@domain/modules/payroll/service";
import { expenseLinkCandidates } from "@domain/modules/pockets/queries";
import { addPlannedExpense, addToPocket, createPocket, linkExpense } from "@domain/modules/pockets/service";
import { createSubscription } from "@domain/modules/subscriptions/service";
import { saveAllowance, saveLeaveDay } from "@domain/modules/timeoff/service";
import { refreshRecurrences } from "../../apps/web/src/modules/transactions/jobs";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import { addDays, addMonths, monthKey, today } from "@domain/shared/dates";
import { TREK_PROVIDER } from "@domain/platform/integrations/rules";
import { saveConnection, saveSchedule } from "@domain/platform/integrations/service";
import { findInstancePlugin } from "@domain/platform/plugins/queries";
import { setPluginActive } from "@plugin-host/service";
import { APRIL, FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../../test/fixtures/payroll/samples";
import { twinPdf } from "../../test/fixtures/payroll/twin";
import { addDeposit, debitFund, importedOperation, importedPosition, payrollFund } from "../../test/funds";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, lastMonthOf, syncedAccount, thisMonthOf, walletMovement, workingDay } from "./common";
import { seedBinance, seedEtoro } from "./investments";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";

export async function seedLayout(): Promise<void> {
  const ctx = await contextOf(USERS.layout.email);
  // The bank plugin, turned on with nothing saved: the section "Banks" opens on its guide and the
  // procedure on its guard, both on screen for the check. Only where the instance has the plugin —
  // the seed cannot reach a plugin itself, so it relies on the manifest the app has already read.
  if (await findInstancePlugin(BANK_PLUGIN))
    await setPluginActive(ctx, { pluginId: BANK_PLUGIN, active: true });
  // A Trek link on manual only (docs/scheduler.md): the card and its schedule control are on screen for the
  // check, and the dispatcher never tries to reach the address, which does not exist.
  const trek = await saveConnection(ctx, {
    provider: TREK_PROVIDER,
    credentials: { baseUrl: "https://trek.invalid", token: "e2e-not-a-token" },
  });
  await saveSchedule(ctx, trek.id, { rules: [] });
  const on = today(ctx.timeZone);
  const thisMonth = thisMonthOf(ctx);
  const lastMonth = lastMonthOf(ctx);

  // ——— Accounts, movements and categories: Overview, Accounts, Expenses, Categories ———
  const current = await syncedAccount(ctx, "e2e-layout-1", "ING Conto Arancio");
  await saveBalanceEntry(ctx, current, { on, cents: 412_350n });
  await upsertFromProvider(
    ctx,
    current,
    [
      walletMovement("e2e-layout-tx-1", `${thisMonth}-02`, -1299n, "Netflix", "Abbonamenti"),
      walletMovement("e2e-layout-tx-2", `${thisMonth}-03`, -8750n, "Esselunga Superstore", "Spesa"),
      walletMovement("e2e-layout-tx-3", `${thisMonth}-05`, -2100n, "Trenitalia", "Trasporti"),
      walletMovement("e2e-layout-tx-4", `${thisMonth}-07`, -4800n, "Ristorante Da Mario", "Ristoranti"),
      walletMovement("e2e-layout-tx-5", `${thisMonth}-09`, -6500n, "Farmacia Comunale 3", "Salute"),
      walletMovement("e2e-layout-tx-6", `${thisMonth}-11`, 210_000n, "Stipendio", null),
      walletMovement("e2e-layout-tx-7", `${thisMonth}-14`, -3490n, "Amazon Marketplace", "Casa"),
      walletMovement("e2e-layout-tx-8", `${lastMonth}-12`, -1299n, "Netflix", "Abbonamenti"),
      walletMovement("e2e-layout-tx-9", `${lastMonth}-18`, -9120n, "Esselunga Superstore", "Spesa"),
      // An unpaired giroconto leg: flagged in the list and counted in no total (F2.5).
      walletMovement("e2e-layout-tx-10", `${lastMonth}-22`, -50_000n, "Revolut", null, "e2e-layout-tx-11"),
    ],
    { provider: WALLET_PROVIDER },
  );

  const savings = await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "Emergenze",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(addMonths(monthKey(on), -1), -1), cents: 1_000_000n },
  });
  // An account in another currency, so the screens are measured with its line in the display
  // currency under its own value (§1.8).
  await createAccount(ctx, {
    name: "Interactive Brokers",
    type: "investment",
    currency: "USD",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(on, -3), cents: 250_000n },
  });

  // ——— What hangs off the accounts: the section replaces a table the owner kept by hand ———
  for (const [channel, name] of [
    ["iban", "Paypal"],
    ["iban", "Satispay"],
    ["iban", "Bollo Regione Lombardia"],
    ["card", "Google Pay"],
    ["card", "Amazon"],
  ] as const) {
    await addConnection(ctx, current, { channel, name });
  }
  await addConnection(ctx, savings.id, { channel: "iban", name: "Stipendio", note: "accredito mensile" });

  // ——— Budgets ———
  const byName = new Map((await listCategories(ctx)).map((category) => [category.name, category.id]));
  for (const [name, cents] of [
    ["Spesa", 15_000n],
    ["Ristoranti", 5_000n],
    ["Trasporti", 2_000n],
    ["Salute", 8_000n],
  ] as const) {
    const categoryId = byName.get(name);
    if (categoryId) {
      await setLimit(ctx, { categoryId, accountId: null, month: `${thisMonth}-01`, cents });
    }
  }

  // ——— Pockets ———
  const startMonth = `${thisMonth}-01`;
  const holidays = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: savings.id,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth,
  });
  await addToPocket(ctx, holidays.id, { cents: 385_000n, on });
  await addPlannedExpense(ctx, holidays.id, {
    cents: 85_000n,
    dueOn: addDays(on, 14),
    description: "Ischia — hotel e traghetto",
  });
  const gifts = await createPocket(ctx, {
    name: "Gifts",
    color: null,
    backingAccountId: null,
    targetCents: null,
    monthlyCents: 5_000n,
    startMonth,
  });
  const [gift] = await expenseLinkCandidates(ctx);
  if (gift) await linkExpense(ctx, gifts.id, gift.id);

  // ——— Investments (docs/design/investments.md §1.3, §4; PERS-342): two manual services on accounts
  // of Accounts — Directa typed by hand (1.000.000 € yesterday, 1.045.000 € today), Fineco read by
  // Wallet (zero yesterday, 512.340 € today after 500.000 € in and 100.000 € out) — and the two synced
  // ones. A service starts today: what was there yesterday is its opening.
  const directa = await createAccount(ctx, { name: "Directa", type: "investment", currency: "EUR" });
  await saveBalanceEntry(ctx, directa.id, { on: addDays(on, -1), cents: 1_000_000n });
  await saveBalanceEntry(ctx, directa.id, { on, cents: 1_045_000n });
  await createManualService(ctx, {
    accountId: directa.id,
    category: "broker",
    url: "https://www.directa.it",
  });
  const fineco = await syncedAccount(ctx, "e2e-layout-fineco", "Fineco Conto Deposito", "investment");
  await saveProviderBalance(ctx, fineco, { on: addDays(on, -1), cents: 0n });
  await upsertFromProvider(
    ctx,
    fineco,
    [
      walletMovement("e2e-layout-fineco-1", on, 500_000n, "Bonifico in entrata", null),
      walletMovement("e2e-layout-fineco-2", on, -100_000n, "Bonifico in uscita", null),
    ],
    { provider: WALLET_PROVIDER },
  );
  await saveProviderBalance(ctx, fineco, { on, cents: 412_340n });
  await createManualService(ctx, { accountId: fineco, category: "accounts", url: null });
  await seedEtoro(ctx, on);
  await seedBinance(ctx, on);

  // ——— Subscriptions ———
  await upsertFromProvider(
    ctx,
    current,
    [
      walletMovement("e2e-layout-sub-1", addDays(on, -90), -2990n, "FitActive", "Sport"),
      walletMovement("e2e-layout-sub-2", addDays(on, -60), -2990n, "FitActive", "Sport"),
      walletMovement("e2e-layout-sub-3", addDays(on, -30), -2990n, "FitActive", "Sport"),
    ],
    { provider: WALLET_PROVIDER },
  );
  await refreshRecurrences(ctx);
  const streaming = (await listCategories(ctx)).find((one) => one.name === "Abbonamenti");
  const plan = { categoryId: streaming?.id ?? null, paymentAccountId: current, tolerance: "0.05" };
  await createSubscription(ctx, {
    ...plan,
    name: "Netflix",
    utility: 8,
    priceCents: 1299n,
    cycle: "monthly",
    nextChargeOn: addDays(on, 12),
    payeeMatch: "netflix",
  });
  await createSubscription(ctx, {
    ...plan,
    name: "Spotify Premium Family",
    utility: 9,
    priceCents: 1799n,
    cycle: "monthly",
    nextChargeOn: addDays(on, 4),
    payeeMatch: "spotify",
  });
  await createSubscription(ctx, {
    ...plan,
    categoryId: null,
    name: "Amazon Prime",
    utility: 4,
    priceCents: 4990n,
    cycle: "yearly",
    nextChargeOn: addDays(on, 3),
    payeeMatch: "amazon",
  });

  // ——— Interests: a rule on the savings account, accrued and settled up to today ———
  await createRule(ctx, {
    accountId: savings.id,
    taxRate: "0.26",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: addDays(addMonths(monthKey(on), -1), -1),
    mode: "analyze_only",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });

  // ——— A fund with a debit plan, with its deposits and valuations ———
  const layoutYear = Number(on.slice(0, 4));
  const pac = await debitFund(ctx, {
    name: "Fideuram Master Selection",
    provider: "Fideuram",
    code: "IT0005247157",
    compartment: "Bilanciato",
    debitAccountId: current,
    debitDay: 5,
    ter: "0.0185",
    startOn: `${layoutYear - 2}-03-05`,
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
  });
  // Two years before this one (funds-ux §8, F5): money with no value, then a year with a value.
  await addDeposit(ctx, pac.id, {
    on: `${layoutYear - 2}-03-05`,
    chargedCents: 25_100n,
    feeCents: 100n,
    note: null,
  });
  await addDeposit(ctx, pac.id, {
    on: `${layoutYear - 1}-02-05`,
    chargedCents: 25_100n,
    feeCents: 100n,
    note: null,
  });
  await recordValuation(ctx, pac.id, {
    on: `${layoutYear - 1}-02-28`,
    cents: 50_000n,
    units: null,
    note: null,
  });
  for (const back of [5, 4, 3, 2, 1]) {
    await addDeposit(ctx, pac.id, {
      on: `${addMonths(monthKey(on), -back).slice(0, 7)}-05`,
      chargedCents: 25_100n,
      feeCents: 100n,
      note: null,
    });
  }
  for (const [back, cents] of [
    [4, 50_400n],
    [3, 76_100n],
    [2, 99_800n],
    [1, 128_200n],
    [0, 153_900n],
  ] as const) {
    await recordValuation(ctx, pac.id, {
      // The 28th of each month, except this one's, which is valued today: a valuation in the
      // future is refused, and on the 21st the 28th has not happened yet.
      on: back === 0 ? on : `${addMonths(monthKey(on), -back).slice(0, 7)}-28`,
      cents,
      units: null,
      note: null,
    });
  }

  // ——— Payroll: the synthetic twins of a whole year, read, verified and applied ———
  // Last year: a fund's pages read nothing after today, and the twins are dated 2031.
  const lastYear = <T>(twin: T): T =>
    JSON.parse(JSON.stringify(twin).replaceAll("2031", String(layoutYear - 1))) as T;
  for (const twin of [JANUARY, FEBRUARY, MARCH, APRIL, THIRTEENTH].map(lastYear)) {
    const { document } = await uploadPayslip(ctx, {
      name: `${twin.period.replace(/\s+/g, "-").toLowerCase()}.pdf`,
      bytes: await twinPdf(twin),
    });
    await processPayslip(ctx, document.id);
    await verifyPayslip(ctx, document.id);
    await applyPayslip(ctx, document.id);
  }

  // ——— The fund fed by the payslip, with what its two documents left before release N6 ———
  // A fund reads no document any more: the rows the operations export and the statement of August
  // wrote are written here as they were read, moved to last year.
  const pension = await payrollFund(ctx, {
    name: "Cometa",
    provider: "Cometa",
    compartment: "Crescita",
    startOn: `${layoutYear - 1}-01-01`,
    receivesPayroll: true,
  });
  const exportYear = layoutYear - 1;
  const employer = { employerTaxCode: "01234567890", employerName: "ACME SPA" };
  const price = (unitPrice: string, month: string) => ({
    unitPrice,
    unitPriceDate: `${exportYear}-${month}`,
  });
  const exported = [
    // II: one operation over two compartments — its amounts count once.
    {
      operationDate: `${exportYear}-07-18`,
      competenceQuarter: 2,
      workerCents: 2_500n,
      employerCents: 4_500n,
      tfrCents: 15_000n,
      feesCents: 300n,
      netCents: 21_700n,
      classification: "contribution" as const,
      movements: [
        { compartment: "CRESCITA", units: "5.000", ...price("21.700", "07-31") },
        { compartment: "SICUREZZA", units: "5.000", ...price("21.700", "07-31") },
      ],
    },
    // I: three months, 660,00 gross and 3,00 of fees, into 30 units.
    {
      operationDate: `${exportYear}-04-18`,
      competenceQuarter: 1,
      workerCents: 7_500n,
      employerCents: 13_500n,
      tfrCents: 45_000n,
      feesCents: 300n,
      netCents: 65_700n,
      classification: "contribution" as const,
      movements: [{ compartment: "CRESCITA", units: "30.000", ...price("21.900", "04-30") }],
    },
    // The enrolment: a "Contributo" too, with a net of zero, no units and fees equal to its amounts.
    {
      operationDate: `${exportYear}-04-18`,
      competenceQuarter: 1,
      workerCents: 516n,
      employerCents: 516n,
      tfrCents: 0n,
      feesCents: 1_032n,
      netCents: 0n,
      classification: "enrollment" as const,
      movements: [{ compartment: "CRESCITA", units: "0.000", ...price("21.900", "04-30") }],
    },
  ];
  for (const operation of exported) {
    // The key the export's reader gave an operation: its fingerprint and its occurrence in the file.
    const print = createHash("sha256")
      .update(
        [
          "contributo",
          operation.operationDate,
          `${exportYear}-${operation.competenceQuarter}`,
          ...[
            operation.workerCents,
            operation.employerCents,
            operation.tfrCents,
            0n,
            operation.feesCents,
            operation.netCents,
          ].map(String),
          employer.employerTaxCode,
        ].join("\u001f"),
      )
      .digest("hex")
      .slice(0, 32);
    await importedOperation(ctx, pension.id, {
      originKey: `${print}#1`,
      originalType: "Contributo",
      originalState: "QUOTATO",
      competenceYear: exportYear,
      otherCents: 0n,
      ...employer,
      ...operation,
    });
  }
  // The position at 31 August: inflows 890,32, value 950,00, a reported gain of 59,68.
  await importedPosition(ctx, pension, {
    valuationDate: `${exportYear}-08-31`,
    valueCents: 95_000n,
    tfrCents: 60_000n,
    workerCents: 10_516n,
    employerCents: 18_516n,
    transfersInCents: 0n,
    inflowsCents: 89_032n,
    advancesCents: 0n,
    redemptionsCents: 0n,
    ritaCents: 0n,
    outflowsCents: 0n,
    reportedGainCents: 5_968n,
    note: "riepilogo_posizione.pdf",
  });

  // ——— Time off ———
  const year = Number(on.slice(0, 4));
  await saveAllowance(ctx, year, { vacationDays: 26, rolDays: 4, note: "CCNL Metalmeccanici" });
  await saveLeaveDay(ctx, { from: workingDay(on, -14), kind: "vacation", fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, -7), kind: "rol", fraction: 0.5 });
  await saveLeaveDay(ctx, { from: workingDay(on, 21), kind: "vacation", fraction: 1 });
}

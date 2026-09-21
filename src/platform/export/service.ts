import "server-only";
import { balancesOn, listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import { budgetsView } from "@/modules/budgets/queries";
import { fundsView } from "@/modules/funds/queries";
import { interestsView } from "@/modules/interests/queries";
import { DOCUMENT_KINDS } from "@/modules/imports/rules";
import { listDocuments, readOriginal } from "@/modules/imports/service";
import { pocketsView } from "@/modules/pockets/queries";
import { registerView } from "@/modules/payroll/queries";
import { subscriptionsView } from "@/modules/subscriptions/queries";
import { listAllowances, listLeaveDays } from "@/modules/timeoff/service";
import { listTransactions, MAX_LIMIT } from "@/modules/transactions/queries";
import { getPreferences } from "@/modules/users/service";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { amount, day, type Row, type Section, sectionCsv, sectionsJson } from "./sections";
import { type ZipEntry, zipStream, zipToBytes } from "./zip";

/**
 * "Export my data" (spec §7.10 Data): a ZIP of everything a person owns — the tables as CSV, the
 * same rows as one JSON, and their original documents.
 *
 * **This is the one file in the repository that depends on every module**, and it has to be: an
 * export must see the data the way the screen sees it, so it goes through each module's own
 * services and never near their tables (plan F8 §3.4.11, `src/architecture.test.ts`). Anything
 * else would be a second implementation of every module, drifting quietly out of date.
 */

/** Far enough back to hold every leave day anyone could have recorded, and a fixed string. */
const LEAVE_WINDOW = { from: "1970-01-01", to: "2999-12-31" } as const;

async function allTransactions(ctx: Ctx): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += MAX_LIMIT) {
    // `listTransactions` is bounded on purpose (nobody should ask for the whole table by
    // accident); an export is the one caller that means it, so it asks page by page.
    const page = await listTransactions(ctx, {
      limit: MAX_LIMIT,
      offset,
      includeHidden: true,
      sort: "date",
      direction: "asc",
    });
    for (const row of page) {
      rows.push({
        id: row.id,
        on: row.on,
        occurredAt: day(row.occurredAt),
        account: row.accountName,
        amount: amount(row.amountCents),
        currency: row.currency,
        type: row.type,
        state: row.state,
        category: row.categoryName,
        payee: row.payee,
        note: row.note,
        labels: row.labels.map((label) => label.name).join(", "),
        hidden: row.hidden,
      });
    }
    if (page.length < MAX_LIMIT) return rows;
  }
}

/** Every table of the export, in the order the navigation lists them. */
async function sectionsOf(ctx: Ctx, now: Date): Promise<Section[]> {
  const month = monthKey(today(ctx.timeZone, now));
  const accounts = await listAccounts(ctx, { includeArchived: true });
  const latest = await balancesOn(
    ctx,
    accounts.map((account) => account.id),
    today(ctx.timeZone, now),
  );

  const balances: Row[] = [];
  for (const account of accounts) {
    for (const entry of await listBalanceEntries(ctx, account.id, 10_000)) {
      balances.push({
        account: account.name,
        on: entry.on,
        balance: amount(entry.balanceCents),
        available: amount(entry.availableCents),
        source: entry.source,
        note: entry.note,
      });
    }
  }

  const [transactions, subscriptions, pockets, budgets, funds, interests, allowances, leave, payroll] =
    await Promise.all([
      allTransactions(ctx),
      subscriptionsView(ctx, now),
      pocketsView(ctx, now),
      budgetsView(ctx, month),
      fundsView(ctx, now),
      interestsView(ctx, now),
      listAllowances(ctx),
      listLeaveDays(ctx, LEAVE_WINDOW),
      registerView(ctx),
    ]);

  return [
    {
      name: "accounts",
      columns: ["name", "type", "currency", "origin", "state", "balance", "inNetWorth", "countsAsLiquid"],
      rows: accounts.map((account) => ({
        name: account.name,
        type: account.type,
        currency: account.currency,
        origin: account.origin,
        state: account.state,
        balance: amount(latest.get(account.id) ?? null),
        inNetWorth: account.inNetWorth,
        countsAsLiquid: account.countsAsLiquid,
      })),
    },
    {
      name: "balances",
      columns: ["account", "on", "balance", "available", "source", "note"],
      rows: balances,
    },
    {
      name: "transactions",
      columns: [
        "id",
        "on",
        "occurredAt",
        "account",
        "amount",
        "currency",
        "type",
        "state",
        "category",
        "payee",
        "note",
        "labels",
        "hidden",
      ],
      rows: transactions,
    },
    {
      name: "budgets",
      columns: ["month", "category", "account", "limit", "spent", "status"],
      rows: budgets.rows.map((row) => ({
        month,
        category: row.name,
        account: row.accountName,
        limit: amount(row.limitCents),
        spent: amount(row.spentCents),
        status: row.status,
      })),
    },
    {
      name: "pockets",
      columns: ["name", "account", "balance", "accrued", "target", "monthly", "state"],
      rows: [
        ...pockets.pockets.map((row) => ({
          name: row.pocket.name,
          account: row.accountName,
          balance: amount(row.balanceCents),
          accrued: amount(row.accruedCents),
          target: amount(row.pocket.targetCents),
          monthly: amount(row.pocket.monthlyCents),
          state: row.pocket.state,
        })),
        ...pockets.archived.map((pocket) => ({
          name: pocket.name,
          account: null,
          balance: null,
          accrued: null,
          target: amount(pocket.targetCents),
          monthly: amount(pocket.monthlyCents),
          state: pocket.state,
        })),
      ],
    },
    {
      name: "subscriptions",
      columns: ["name", "category", "price", "cycle", "account", "monthly", "yearly", "nextCharge", "state"],
      rows: [...subscriptions.rows, ...subscriptions.inactive].map((row) => ({
        name: row.subscription.name,
        category: row.categoryName,
        price: amount(row.subscription.priceCents),
        cycle: row.subscription.cycle,
        account: row.accountName,
        monthly: amount(row.monthlyCents),
        yearly: amount(row.yearlyCents),
        nextCharge: row.nextChargeOn,
        state: row.subscription.state,
      })),
    },
    {
      name: "interests",
      columns: ["account", "settlement", "dayBasis", "mode", "state", "accruedYtd", "grossYtd", "nextPayout"],
      rows: interests.map((row) => ({
        account: row.accountName,
        settlement: row.rule.settlement,
        dayBasis: row.rule.dayBasis,
        mode: row.rule.mode,
        state: row.rule.state,
        accruedYtd: amount(row.accruedYtdCents),
        grossYtd: amount(row.grossYtdCents),
        nextPayout: row.nextPayout,
      })),
    },
    {
      name: "funds",
      columns: ["name", "kind", "provider", "isin", "paidIn", "value", "gain", "lastValuation", "state"],
      rows: [
        ...funds.rows.map((row) => ({
          name: row.fund.name,
          kind: row.fund.type,
          provider: row.fund.provider,
          isin: row.fund.isin,
          paidIn: amount(row.metrics.paidInCents),
          value: amount(row.metrics.valueCents),
          gain: amount(row.metrics.gainCents),
          lastValuation: row.lastValuation,
          state: row.fund.state,
        })),
        ...funds.archived.map((fund) => ({
          name: fund.name,
          kind: fund.type,
          provider: fund.provider,
          isin: fund.isin,
          paidIn: null,
          value: null,
          gain: null,
          lastValuation: null,
          state: fund.state,
        })),
      ],
    },
    {
      name: "timeoff-allowances",
      columns: ["year", "vacationDays", "rolDays", "totalDays", "note"],
      rows: allowances.map((allowance) => ({
        year: allowance.year,
        vacationDays: allowance.vacationDays,
        rolDays: allowance.rolDays,
        totalDays: allowance.totalDays,
        note: allowance.note,
      })),
    },
    {
      name: "timeoff-days",
      columns: ["on", "kind", "fraction", "origin", "pending", "syncedAt", "note"],
      rows: leave.map((entry) => ({
        on: entry.on,
        kind: entry.kind,
        fraction: entry.fraction,
        origin: entry.origin,
        pending: entry.pending,
        syncedAt: day(entry.syncedAt),
        note: entry.note,
      })),
    },
    {
      name: "payslips",
      columns: ["year", "period", "type", "paidOn", "gross", "net", "document"],
      rows: payroll.years.flatMap((summary) =>
        summary.rows.map((row) => ({
          year: row.payslip.year,
          period: row.payslip.period,
          type: row.payslip.type,
          paidOn: row.payslip.paidOn,
          gross: amount(row.payslip.gross),
          net: amount(row.payslip.netPay),
          document: row.document.fileName,
        })),
      ),
    },
    // Named so it is obvious which row belongs to which file in `documents/`.
    {
      name: "documents",
      columns: ["id", "kind", "fileName", "state", "receivedAt", "sizeBytes", "retainUntil"],
      rows: (await listDocuments(ctx, DOCUMENT_KINDS)).map((document) => ({
        id: document.id,
        kind: document.kind,
        fileName: document.fileName,
        state: document.state,
        receivedAt: day(document.receivedAt),
        sizeBytes: document.sizeBytes,
        retainUntil: document.retainUntil,
      })),
    },
  ];
}

const README = (at: Date) => `Ledgerly — your data, exported ${at.toISOString()}.

Every table is here twice: once as a CSV (semicolon-separated, UTF-8 with a BOM, so a spreadsheet
opens it as it is) and once inside ledgerly.json. Amounts are plain decimal strings — "1234.56" —
in the account's own currency, never a locale's formatting, so a script can read them. An unknown
amount is empty in the CSV and null in the JSON; the two mean the same thing.

documents/ holds the originals still kept: payslips and Cometa files, under the names you
uploaded them with, prefixed by the id they have in documents.csv. An original whose retention has
run out is listed there and is not in the folder.
`;

/** Everything of one person, as the entries of their archive, read one at a time. */
async function* entriesFor(ctx: Ctx, now: Date): AsyncGenerator<ZipEntry> {
  const encode = (text: string) => new TextEncoder().encode(text);
  yield { path: "README.txt", bytes: encode(README(now)) };
  const sections = await sectionsOf(ctx, now);
  for (const section of sections) {
    yield { path: `${section.name}.csv`, bytes: encode(sectionCsv(section)) };
  }
  yield {
    path: "ledgerly.json",
    bytes: encode(
      sectionsJson(sections, { exportedAt: now.toISOString(), preferences: await getPreferences(ctx) }),
    ),
  };
  for (const document of sections.find((section) => section.name === "documents")!.rows) {
    const id = String(document.id);
    try {
      const original = await readOriginal(ctx, id);
      if (original) yield { path: `documents/${id}-${original.fileName}`, bytes: original.bytes };
    } catch (error) {
      // A document the store will not hand back must not cost the person the rest of their data.
      console.error(`[export] could not read ${id}`, redactForLog(error));
    }
  }
}

/**
 * The user's own export: a ZIP written straight into the response (spec §7.10). No row, no copy in
 * S3, no link that expires — it is their data, and they already have a session (plan F8 §3.4.12).
 */
export function exportUser(ctx: Ctx, now: Date = new Date()): ReadableStream<Uint8Array> {
  return zipStream(entriesFor(ctx, now), { mtime: now });
}

/** The same archive as bytes, for the admin job that stores one per person. */
export function exportUserBytes(ctx: Ctx, now: Date = new Date()): Promise<Uint8Array> {
  return zipToBytes(entriesFor(ctx, now), { mtime: now });
}

/** The name a browser saves it under. */
export function exportFileName(now: Date): string {
  return `ledgerly-${now.toISOString().slice(0, 10)}.zip`;
}

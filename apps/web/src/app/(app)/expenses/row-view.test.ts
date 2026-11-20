// `lineViewOf` (a row of `/api/v1`) draws what `rowViewOf` (a row of the domain) drew for the same
// movement: the screens that move to the API keep their rows.
import { describe, expect, it } from "vitest";
import { badgesOf, macrosFor, type TransactionRow } from "@ledgerly/domain/transactions";
import { centsToDecimal } from "@ledgerly/format/cents";
import { lineViewOf, type TransactionLine } from "@/modules/transactions/client";
import { rowViewOf } from "./row-view";

const CATEGORY = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a03";
const SUGGESTED = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a04";
const ACCOUNT = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a01";

const ROW: TransactionRow = {
  id: "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a10",
  accountId: ACCOUNT,
  accountName: "Conto",
  occurredAt: new Date("2026-10-14T08:12:00.000Z"),
  on: "2026-10-14",
  amountCents: -4_280n,
  currency: "EUR",
  type: "expense",
  state: "pending",
  categoryId: CATEGORY,
  categoryName: "Spesa",
  categoryColor: null,
  payee: "  Esselunga ",
  note: "pane",
  labels: [{ id: "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a20", name: "Casa", color: null }],
  transferGroupId: null,
  hiddenAt: new Date("2026-10-15T00:00:00.000Z"),
  removedUpstreamAt: null,
  locallyEdited: ["note"],
  origin: "provider",
  sendState: null,
  categoryState: "suggestion",
  categoryReason: { code: "memory", params: { text: "Esselunga" } },
  categoryIsOwn: false,
  suggestedCategoryId: SUGGESTED,
  hidden: true,
  edited: true,
};

/** The row as the API writes it (`transactionLine` of `apps/api`). */
function lineOf(
  row: TransactionRow,
  extras: { sendSource: string | null; editable: boolean },
): TransactionLine {
  return {
    id: row.id,
    on: row.on,
    occurredAt: row.occurredAt.toISOString(),
    accountId: row.accountId,
    accountName: row.accountName,
    amount: centsToDecimal(row.amountCents),
    currency: row.currency,
    type: row.type,
    state: row.state,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    payee: row.payee,
    note: row.note,
    labels: row.labels.map((label) => label.name),
    hidden: row.hidden,
    categoryColor: row.categoryColor,
    categoryState: row.categoryState,
    categoryReason: row.categoryReason,
    categoryIsOwn: row.categoryIsOwn,
    suggestedCategoryId: row.suggestedCategoryId,
    labelIds: row.labels.map((label) => label.id),
    transferGroupId: row.transferGroupId,
    origin: row.origin,
    sendState: row.sendState,
    sendSource: extras.sendSource,
    editableAtSource: extras.editable,
    removedUpstream: row.removedUpstreamAt !== null,
    edited: row.edited,
    badges: badgesOf(row),
    macros: macrosFor(row),
  };
}

const colorOf = new Map([
  [CATEGORY, "#ed4a49"],
  [SUGGESTED, "#4db956"],
]);
const categories = [
  { id: CATEGORY, name: "Spesa", color: "#ed4a49" },
  { id: SUGGESTED, name: "Svago", color: "#4db956" },
];
const where = { locale: "it", numberFormat: "it-IT" } as const;

describe("lineViewOf", () => {
  it("draws a synced row as rowViewOf did, with the fields its source lets change", () => {
    const old = rowViewOf(ROW, { ctx: where, colorOf, categories });
    const line = lineOf(ROW, { sendSource: null, editable: true });
    expect(lineViewOf(line, { ...where, colorOf, categories })).toEqual({
      ...old,
      wallet: { type: "expense", amount: "42,80" },
    });
  });

  it("draws a manual row waiting for its source as rowViewOf did", () => {
    const row: TransactionRow = {
      ...ROW,
      origin: "manual",
      type: "income",
      amountCents: 120_000n,
      sendState: "to_send",
      transferGroupId: "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a30",
      categoryId: null,
      categoryName: null,
      payee: null,
      hiddenAt: null,
      hidden: false,
    };
    const sendSources = new Map([[ACCOUNT, "Banca"]]);
    const old = rowViewOf(row, { ctx: where, colorOf, categories, sendSources });
    const line = lineOf(row, { sendSource: "Banca", editable: false });
    expect(lineViewOf(line, { ...where, colorOf, categories })).toEqual({ ...old, wallet: null });
  });

  it("falls back on the account's name when the source has none", () => {
    const row: TransactionRow = { ...ROW, origin: "manual", sendState: "not_sent" };
    const old = rowViewOf(row, { ctx: where, colorOf, categories });
    const line = lineOf(row, { sendSource: null, editable: false });
    expect(lineViewOf(line, { ...where, colorOf, categories }).send).toEqual(old.send);
  });
});

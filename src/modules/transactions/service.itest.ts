import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { IntegrationError, resolveExternal } from "@/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import {
  categoryTotals,
  countAllTransactions,
  expensesView,
  getTransaction,
  listTransactions,
  monthlyTotals,
  searchPayees,
  spendingOverTime,
  transactionsSummary,
} from "./queries";
import type { IncomingTransaction } from "./rules";
import {
  TransactionError,
  clearRemovedUpstream,
  hideTransaction,
  hideTransactions,
  linkOwnTransfers,
  markRemovedUpstream,
  restoreTransactions,
  setCategory,
  updateTransaction,
  upsertFromProvider,
} from "./service";
import {
  createCategory,
  createLabel,
  deleteLabel,
  listCategories,
  listLabels,
  updateCategory,
} from "./taxonomy";

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

async function anAccount(ctx: Ctx, name = "ING Conto Arancio", reference = ""): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference,
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

/** One movement as Wallet hands it over, with only what a test cares about overridden. */
function movement(overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  return {
    externalId: "w-1",
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T09:00:00Z"),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Esselunga",
    note: null,
    categoryExternalId: "wc-1",
    categoryName: "Groceries",
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: ["Food"],
    ...overrides,
  };
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

let ctx: Ctx;
let accountId: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  accountId = await anAccount(ctx);
});

afterAll(closeDatabase);

describe("upsertFromProvider", () => {
  it("creates the movements, adopts their category and labels, and files their external ids", async () => {
    const outcome = await upsertFromProvider(ctx, accountId, [
      movement(),
      movement({
        externalId: "w-2",
        occurredAt: new Date("2026-03-11T09:00:00Z"),
        amountCents: 250_000n,
        type: "income",
        payee: "Acme Payroll",
        categoryExternalId: "wc-2",
        categoryName: "Salary",
        labels: [],
      }),
    ]);

    expect(outcome).toEqual({ created: 2, updated: 0, skipped: 0, removed: 0, restored: 0 });

    const rows = await listTransactions(ctx, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      payee: "Acme Payroll",
      amountCents: 250_000n,
      type: "income",
      categoryName: "Salary",
      accountName: "ING Conto Arancio",
      on: "2026-03-11",
      edited: false,
      hidden: false,
    });
    expect(rows[1]).toMatchObject({ payee: "Esselunga", amountCents: -2_500n, type: "expense" });
    expect(rows[1].labels.map((label) => label.name)).toEqual(["Food"]);

    expect((await listCategories(ctx)).map((category) => category.name)).toEqual(["Groceries", "Salary"]);
    expect((await listLabels(ctx)).map((label) => label.name)).toEqual(["Food"]);

    const links = await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1", "w-2"]);
    expect(links.size).toBe(2);
    expect(links.get("w-1")).toBe(rows[1].id);
  });

  it("is idempotent: the same window applied twice creates nothing and changes nothing", async () => {
    const answer = [
      movement(),
      movement({ externalId: "w-2", payee: "Netflix", amountCents: -1_299n, labels: ["Fun"] }),
    ];
    await upsertFromProvider(ctx, accountId, answer, { window: MARCH });
    const before = await listTransactions(ctx, {});

    const second = await upsertFromProvider(ctx, accountId, answer, { window: MARCH });
    expect(second).toEqual({ created: 0, updated: 0, skipped: 2, removed: 0, restored: 0 });

    const after = await listTransactions(ctx, {});
    expect(after).toEqual(before);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await listCategories(ctx)).toHaveLength(1);
    expect(await listLabels(ctx)).toHaveLength(2);
  });

  it("writes the provider's changes to a movement it has already seen", async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    const outcome = await upsertFromProvider(ctx, accountId, [
      movement({ amountCents: -3_100n, payee: "  Esselunga Centro  ", state: "pending" }),
    ]);

    expect(outcome).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const [row] = await listTransactions(ctx, {});
    expect(row).toMatchObject({
      amountCents: -3_100n,
      payee: "Esselunga Centro",
      state: "pending",
      edited: false,
    });
  });

  it("never overwrites a field the person has edited, and still follows the rest", async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    const [created] = await listTransactions(ctx, {});
    const mine = await createCategory(ctx, {
      name: "Mine",
      group: null,
      type: "expense",
      color: null,
    });
    const tag = await createLabel(ctx, { name: "Reviewed", color: null });

    await updateTransaction(ctx, created.id, {
      categoryId: mine.id,
      note: "checked by hand",
      labelIds: [tag.id],
    });

    await upsertFromProvider(ctx, accountId, [
      movement({
        amountCents: -9_900n,
        categoryExternalId: "wc-9",
        categoryName: "Something else",
        note: "provider note",
        labels: ["Food", "Travel"],
      }),
    ]);

    const row = await getTransaction(ctx, created.id);
    expect(row).toMatchObject({
      categoryId: mine.id,
      note: "checked by hand",
      amountCents: -9_900n,
      locallyEdited: ["categoryId", "labels", "note"],
    });
    expect(row?.labelIds).toEqual([tag.id]);
  });

  it("keeps the last of two pages that repeat the same external id", async () => {
    const outcome = await upsertFromProvider(ctx, accountId, [
      movement({ amountCents: -1_000n }),
      movement({ amountCents: -1_500n }),
    ]);
    expect(outcome).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    const rows = await listTransactions(ctx, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(-1_500n);
  });

  it("leaves no half-created movement when the link is refused", async () => {
    // An external id `provider_links` cannot hold: `linkExternal` refuses it, and because it
    // writes inside the transaction that created the row, the row goes with it. A movement with
    // no link is exactly what must never survive — the next pass would create it again.
    const tooLong = "w-".padEnd(220, "x");
    await expect(upsertFromProvider(ctx, accountId, [movement({ externalId: tooLong })])).rejects.toThrow(
      IntegrationError,
    );

    expect(await listTransactions(ctx, { includeHidden: true })).toEqual([]);
    expect(await countAllTransactions(ctx)).toBe(0);
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", [tooLong])).toEqual(new Map());
    // The category and the label were adopted before the row's transaction opened, on purpose:
    // they are their own use case (spec §9.1), and reusing them is what the next pass does.
    expect((await listCategories(ctx)).map((one) => one.name)).toEqual(["Groceries"]);
    expect((await listLabels(ctx)).map((one) => one.name)).toEqual(["Food"]);
  });

  it("files a movement with a counterpart as a transfer whatever the provider called it", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ externalId: "w-1", counterpartExternalId: "w-2", type: "expense" }),
    ]);
    const [row] = await listTransactions(ctx, {});
    expect(row.type).toBe("transfer");
    expect(row.transferGroupId).toBeNull();
  });

  it("pairs the two legs of a transfer even when they arrive in different syncs", async () => {
    const other = await anAccount(ctx, "Revolut");
    await upsertFromProvider(ctx, accountId, [
      movement({ externalId: "w-1", counterpartExternalId: "w-2", amountCents: -50_000n }),
    ]);
    await upsertFromProvider(ctx, other, [
      movement({
        externalId: "w-2",
        counterpartExternalId: "w-1",
        amountCents: 50_000n,
        payee: "Revolut",
        categoryExternalId: null,
        categoryName: null,
        labels: [],
      }),
    ]);

    const rows = await listTransactions(ctx, {});
    const groups = rows.map((row) => row.transferGroupId);
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).toBe([...rows.map((row) => row.id)].sort()[0]);

    // And pairing again decides the same group, so a re-read writes nothing.
    const again = await upsertFromProvider(ctx, accountId, [
      movement({ externalId: "w-1", counterpartExternalId: "w-2", amountCents: -50_000n }),
    ]);
    expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect((await listTransactions(ctx, {})).map((row) => row.transferGroupId)).toEqual(groups);
  });

  it("pairs a leg whose twin only one side names", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ externalId: "w-1", counterpartExternalId: null, amountCents: -50_000n }),
      movement({
        externalId: "w-2",
        counterpartExternalId: "w-1",
        amountCents: 50_000n,
        payee: "Revolut",
      }),
    ]);
    const rows = await listTransactions(ctx, {});
    expect(new Set(rows.map((row) => row.transferGroupId)).size).toBe(1);
    expect(rows.every((row) => row.transferGroupId !== null)).toBe(true);
  });

  it("stamps a movement the window no longer returns, once, and brings it back when it returns", async () => {
    const january = movement({
      externalId: "w-old",
      occurredAt: new Date("2026-01-05T09:00:00Z"),
      payee: "Old",
    });
    const kept = movement({ externalId: "w-1" });
    const gone = movement({
      externalId: "w-2",
      occurredAt: new Date("2026-03-20T09:00:00Z"),
      payee: "Vanished",
    });
    await upsertFromProvider(ctx, accountId, [january, kept, gone]);

    const first = await upsertFromProvider(ctx, accountId, [kept], { window: MARCH });
    expect(first).toMatchObject({ created: 0, updated: 0, skipped: 1, removed: 1, restored: 0 });

    const hiddenRow = (await listTransactions(ctx, { includeHidden: true })).find(
      (row) => row.payee === "Vanished",
    );
    expect(hiddenRow?.removedUpstreamAt).toBeInstanceOf(Date);
    expect(hiddenRow?.hidden).toBe(true);
    expect((await listTransactions(ctx, {})).map((row) => row.payee)).toEqual(["Esselunga", "Old"]);

    const stamped = hiddenRow?.removedUpstreamAt;
    const second = await upsertFromProvider(ctx, accountId, [kept], { window: MARCH });
    expect(second.removed).toBe(0);
    const still = (await listTransactions(ctx, { includeHidden: true })).find(
      (row) => row.payee === "Vanished",
    );
    expect(still?.removedUpstreamAt).toEqual(stamped);

    const third = await upsertFromProvider(ctx, accountId, [kept, gone], { window: MARCH });
    expect(third).toMatchObject({ restored: 1 });
    const back = (await listTransactions(ctx, {})).find((row) => row.payee === "Vanished");
    expect(back?.removedUpstreamAt).toBeNull();
  });

  it("never touches a movement outside the window it was asked about", async () => {
    const january = movement({
      externalId: "w-old",
      occurredAt: new Date("2026-01-05T09:00:00Z"),
      payee: "Old",
    });
    await upsertFromProvider(ctx, accountId, [january]);
    const outcome = await upsertFromProvider(ctx, accountId, [], { window: MARCH });
    expect(outcome).toEqual({ created: 0, updated: 0, skipped: 0, removed: 0, restored: 0 });
    const [row] = await listTransactions(ctx, {});
    expect(row.removedUpstreamAt).toBeNull();
  });

  it("adopts a category by its exact local name instead of making a twin", async () => {
    const existing = await createCategory(ctx, {
      name: "Groceries",
      group: "Living",
      type: "expense",
      color: "#2563eb",
    });
    await upsertFromProvider(ctx, accountId, [movement()]);
    const [row] = await listTransactions(ctx, {});
    expect(row.categoryId).toBe(existing.id);
    expect(await listCategories(ctx)).toHaveLength(1);
  });

  it("leaves a movement uncategorised when the provider names no category at all", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ categoryExternalId: null, categoryName: null, labels: [] }),
    ]);
    const [row] = await listTransactions(ctx, {});
    expect(row.categoryId).toBeNull();
    expect(row.categoryName).toBeNull();
    expect(await listCategories(ctx)).toEqual([]);
  });

  it("refuses an account that is not the caller's", async () => {
    const other = await newContext();
    await expect(upsertFromProvider(other, accountId, [movement()])).rejects.toThrow(TransactionError);
    expect(await listTransactions(ctx, {})).toEqual([]);
  });
});

describe("updateTransaction", () => {
  let id: string;

  beforeEach(async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    id = (await listTransactions(ctx, {}))[0].id;
  });

  it("marks only the fields it really changes", async () => {
    const unchanged = await updateTransaction(ctx, id, { note: null });
    expect(unchanged.locallyEdited).toEqual([]);

    const noted = await updateTransaction(ctx, id, { note: "mine" });
    expect(noted.note).toBe("mine");
    expect(noted.locallyEdited).toEqual(["note"]);
  });

  it("refuses a field the provider owns", async () => {
    await expect(updateTransaction(ctx, id, { amountCents: 1n })).rejects.toMatchObject({
      code: "provider_owned",
    });
    await expect(updateTransaction(ctx, id, { payee: "Someone else" })).rejects.toMatchObject({
      code: "provider_owned",
    });
  });

  it("refuses a category or a label that is not the caller's", async () => {
    const other = await newContext();
    const theirs = await createCategory(other, {
      name: "Theirs",
      group: null,
      type: "expense",
      color: null,
    });
    const theirLabel = await createLabel(other, { name: "Theirs", color: null });

    await expect(updateTransaction(ctx, id, { categoryId: theirs.id })).rejects.toMatchObject({
      code: "invalid_reference",
    });
    await expect(updateTransaction(ctx, id, { labelIds: [theirLabel.id] })).rejects.toMatchObject({
      code: "invalid_reference",
    });
    expect((await getTransaction(ctx, id))?.locallyEdited).toEqual([]);
  });

  it("answers not_found for an id that is not there, and invalid for one that is not an id", async () => {
    await expect(
      updateTransaction(ctx, "00000000-0000-7000-8000-000000000000", { note: "x" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(updateTransaction(ctx, "not-an-id", { note: "x" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("sets a category over a selection and counts the rows it changed", async () => {
    await upsertFromProvider(ctx, accountId, [movement({ externalId: "w-2", payee: "Coop" })]);
    const rows = await listTransactions(ctx, {});
    const mine = await createCategory(ctx, {
      name: "Mine",
      group: null,
      type: "expense",
      color: null,
    });

    const changed = await setCategory(
      ctx,
      rows.map((row) => row.id),
      mine.id,
    );
    expect(changed).toBe(2);
    expect(
      await setCategory(
        ctx,
        rows.map((row) => row.id),
        mine.id,
      ),
    ).toBe(0);
    for (const row of await listTransactions(ctx, {})) {
      expect(row.categoryId).toBe(mine.id);
      expect(row.locallyEdited).toEqual(["categoryId"]);
    }
  });
});

describe("a deleted label (review B12)", () => {
  it("never comes back onto a movement the person cleared it from", async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    const [food] = await listLabels(ctx);
    expect(food.name).toBe("Food");
    expect((await listTransactions(ctx, {}))[0].labels).toMatchObject([{ id: food.id }]);

    await deleteLabel(ctx, food.id);
    expect((await listTransactions(ctx, {}))[0].labels).toEqual([]);

    // The hour after: Wallet still sends the movement with the same label name.
    await upsertFromProvider(ctx, accountId, [movement()]);

    const row = (await listTransactions(ctx, {}))[0];
    expect(row.labels).toEqual([]);
    expect(row.locallyEdited).toEqual(["labels"]);

    // The name itself does come back in Settings › Data — §9.1 matches labels by name and
    // `service.ts` resolves every movement's names before it consults a marker — but it comes
    // back carrying nothing, and a fresh id cannot undo the person's choice any more.
    const [reborn] = await listLabels(ctx);
    expect(reborn.name).toBe("Food");
    expect(reborn.id).not.toBe(food.id);
  });

  it("leaves the movement following the provider's other fields", async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    const [food] = await listLabels(ctx);
    await deleteLabel(ctx, food.id);

    await upsertFromProvider(ctx, accountId, [movement({ amountCents: -3_000n, payee: "Esselunga Bis" })]);

    const row = (await listTransactions(ctx, {}))[0];
    expect(row).toMatchObject({ amountCents: -3_000n, payee: "Esselunga Bis" });
    expect(row.labels).toEqual([]);
  });
});

describe("visibility", () => {
  let id: string;

  beforeEach(async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    id = (await listTransactions(ctx, {}))[0].id;
  });

  it("hides a movement, keeps it out of the lists and totals, and restores it", async () => {
    await hideTransaction(ctx, id);
    expect(await listTransactions(ctx, {})).toEqual([]);
    expect((await transactionsSummary(ctx, {})).netCents).toBe(0n);
    expect((await listTransactions(ctx, { includeHidden: true }))[0].hidden).toBe(true);

    expect(await restoreTransactions(ctx, [id])).toBe(1);
    expect(await listTransactions(ctx, {})).toHaveLength(1);
  });

  it("shows a hidden movement without letting it into any total (review B11)", async () => {
    // §7.2 grants "Show hidden" the visibility and nothing else: hidden rows stay out of totals,
    // budgets, the subscription check and recurrence detection. Before the fix the header's
    // `{count} · {total}` and the "By category" card counted them back in as soon as the filter
    // was switched on, so the same range answered two different amounts.
    await upsertFromProvider(ctx, accountId, [
      movement({
        externalId: "w-2",
        amountCents: -1_000n,
        payee: "Enel",
        categoryExternalId: "wc-9",
        categoryName: "Utilities",
        labels: [],
      }),
    ]);
    await hideTransaction(ctx, id);

    expect(await listTransactions(ctx, { includeHidden: true })).toHaveLength(2);
    expect(await transactionsSummary(ctx, { includeHidden: true })).toEqual(
      await transactionsSummary(ctx, {}),
    );
    expect((await transactionsSummary(ctx, { includeHidden: true })).netCents).toBe(-1_000n);
    expect(await categoryTotals(ctx, { includeHidden: true })).toEqual(await categoryTotals(ctx, {}));
    expect((await categoryTotals(ctx, { includeHidden: true })).map((slice) => slice.name)).toEqual([
      "Utilities",
    ]);
    expect(await monthlyTotals(ctx, { includeHidden: true })).toEqual(await monthlyTotals(ctx, {}));

    const view = await expensesView(ctx, { includeHidden: true });
    expect(view.rows).toHaveLength(2);
    expect(view.summary).toMatchObject({ count: 1, netCents: -1_000n });
    expect(view.listCount).toBe(2);
    expect(view.truncated).toBe(false);
    expect(view.months).toHaveLength(1);
    expect(view.months[0]).toMatchObject({ count: 1, netCents: -1_000n });
    expect(view.months[0].rows).toHaveLength(2);
  });

  it("keeps a movement the provider dropped out of the totals too (review B11)", async () => {
    await markRemovedUpstream(ctx, [id]);

    expect(await listTransactions(ctx, { includeHidden: true })).toHaveLength(1);
    expect((await transactionsSummary(ctx, { includeHidden: true })).netCents).toBe(0n);
    expect(await categoryTotals(ctx, { includeHidden: true })).toEqual([]);
    expect(await monthlyTotals(ctx, { includeHidden: true })).toEqual([]);
  });

  it("hides once: a second pass over the same selection changes nothing", async () => {
    expect(await hideTransactions(ctx, [id])).toBe(1);
    expect(await hideTransactions(ctx, [id])).toBe(0);
  });

  it("restores only what a person hid, never what the provider stopped returning", async () => {
    await markRemovedUpstream(ctx, [id]);
    expect(await restoreTransactions(ctx, [id])).toBe(0);
    expect((await getTransaction(ctx, id))?.removedUpstreamAt).toBeInstanceOf(Date);
    expect(await clearRemovedUpstream(ctx, [id])).toBe(1);
    expect((await getTransaction(ctx, id))?.removedUpstreamAt).toBeNull();
  });

  it("stamps a disappearance once and keeps the moment it happened", async () => {
    await markRemovedUpstream(ctx, [id], new Date("2026-03-15T10:00:00Z"));
    await markRemovedUpstream(ctx, [id], new Date("2026-03-16T10:00:00Z"));
    expect((await getTransaction(ctx, id))?.removedUpstreamAt).toEqual(new Date("2026-03-15T10:00:00Z"));
  });
});

describe("reads", () => {
  beforeEach(async () => {
    await upsertFromProvider(ctx, accountId, [
      // 00:30 on the 2nd in Rome, 23:30 on the 1st in UTC: the user's day is what counts (§4.3).
      movement({
        externalId: "w-1",
        occurredAt: new Date("2026-03-01T23:30:00Z"),
        amountCents: -1_000n,
        payee: "Late Night",
        categoryExternalId: "wc-1",
        categoryName: "Groceries",
        labels: [],
      }),
      movement({
        externalId: "w-2",
        occurredAt: new Date("2026-03-10T09:00:00Z"),
        amountCents: -4_000n,
        payee: "Esselunga",
        categoryExternalId: "wc-1",
        categoryName: "Groceries",
        labels: ["Food"],
      }),
      movement({
        externalId: "w-3",
        occurredAt: new Date("2026-02-20T09:00:00Z"),
        amountCents: -6_000n,
        payee: "Enel",
        categoryExternalId: "wc-3",
        categoryName: "Utilities",
        labels: [],
      }),
      movement({
        externalId: "w-4",
        occurredAt: new Date("2026-03-12T09:00:00Z"),
        amountCents: -20_000n,
        payee: "Revolut",
        counterpartExternalId: "w-5",
        categoryExternalId: null,
        categoryName: null,
        labels: [],
      }),
    ]);
  });

  it("filters on the user's own civil dates, both ends included", async () => {
    const march = await listTransactions(ctx, { from: "2026-03-01", to: "2026-03-31" });
    expect(march.map((row) => row.payee)).toEqual(["Revolut", "Esselunga", "Late Night"]);

    const fromTheSecond = await listTransactions(ctx, { from: "2026-03-02", to: "2026-03-02" });
    expect(fromTheSecond.map((row) => row.payee)).toEqual(["Late Night"]);
    expect(fromTheSecond[0].on).toBe("2026-03-02");
  });

  it("groups by the user's month, newest first", async () => {
    const months = await monthlyTotals(ctx, {});
    expect(months).toEqual([
      // The Revolut giroconto is one of March's three rows but none of its money (spec §7.2).
      { month: "2026-03-01", count: 3, netCents: -5_000n },
      { month: "2026-02-01", count: 1, netCents: -6_000n },
    ]);

    const view = await expensesView(ctx, { from: "2026-03-01", to: "2026-03-31" });
    expect(view.months.map((group) => group.month)).toEqual(["2026-03-01"]);
    expect(view.months[0]).toMatchObject({ count: 3, netCents: -5_000n });
    expect(view.summary).toEqual({
      count: 3,
      incomeCents: 0n,
      expenseCents: -5_000n,
      netCents: -5_000n,
      transferCount: 1,
      unpairedTransferCount: 1,
    });
    expect(view.listCount).toBe(3);
    expect(view.truncated).toBe(false);
    expect(view.hasAny).toBe(true);
  });

  it("gives a month header the range's total, not the page's (review B1)", async () => {
    // The `limit` boundary falls inside March: the page brings back 2 of its 3 movements. The
    // header used to sum the page and print −240,00 € where the month really is −250,00 € — a
    // wrong amount of money in the same shape as a right one, always on the oldest month shown.
    const view = await expensesView(ctx, { limit: 2 });

    expect(view.rows.map((row) => row.payee)).toEqual(["Revolut", "Esselunga"]);
    expect(view.months.map((group) => group.month)).toEqual(["2026-03-01"]);
    expect(view.months[0]).toMatchObject({ count: 3, netCents: -5_000n });
    expect(view.months[0].rows).toHaveLength(2);
    expect(view.listCount).toBe(4);
    expect(view.truncated).toBe(true);
  });

  it("breaks the range down by category, transfers left out, biggest slice first", async () => {
    const slices = await categoryTotals(ctx, { from: "2026-03-01", to: "2026-03-31" });
    expect(slices).toEqual([
      {
        categoryId: slices[0].categoryId,
        name: "Groceries",
        color: null,
        parentId: null,
        parentName: null,
        parentColor: null,
        count: 2,
        totalCents: -5_000n,
        share: 100,
      },
    ]);
    expect(slices[0].categoryId).not.toBeNull();
  });

  it("filters by account, category, label and type", async () => {
    const groceries = (await listCategories(ctx)).find((one) => one.name === "Groceries");
    const food = (await listLabels(ctx)).find((one) => one.name === "Food");

    expect(
      (await listTransactions(ctx, { categoryIds: [groceries?.id ?? null] })).map((row) => row.payee),
    ).toEqual(["Esselunga", "Late Night"]);
    expect((await listTransactions(ctx, { categoryIds: [null] })).map((row) => row.payee)).toEqual([
      "Revolut",
    ]);
    expect((await listTransactions(ctx, { labelIds: [food?.id ?? ""] })).map((row) => row.payee)).toEqual([
      "Esselunga",
    ]);
    expect((await listTransactions(ctx, { types: ["transfer"] })).map((row) => row.payee)).toEqual([
      "Revolut",
    ]);
    expect(await listTransactions(ctx, { accountIds: [accountId] })).toHaveLength(4);
    expect(await listTransactions(ctx, { accountIds: [] })).toHaveLength(4);
  });

  it("keeps a giroconto out of every total, even with only one of its accounts in view (F2.5)", async () => {
    // The other leg lands on a second account, so the pair is complete: filtering on the first
    // account used to show −200,00 € of "spending" that was only money changing pockets.
    const savings = await anAccount(ctx, "Revolut Savings");
    await upsertFromProvider(ctx, savings, [
      movement({
        externalId: "w-5",
        occurredAt: new Date("2026-03-12T09:00:00Z"),
        amountCents: 20_000n,
        type: "income",
        payee: "Revolut",
        counterpartExternalId: "w-4",
        categoryExternalId: null,
        categoryName: null,
        labels: [],
      }),
    ]);

    const checkingOnly = await transactionsSummary(ctx, { ...MARCH, accountIds: [accountId] });
    expect(checkingOnly).toEqual({
      count: 3,
      incomeCents: 0n,
      expenseCents: -5_000n,
      netCents: -5_000n,
      transferCount: 1,
      unpairedTransferCount: 0,
    });
    const savingsOnly = await transactionsSummary(ctx, { ...MARCH, accountIds: [savings] });
    expect(savingsOnly).toMatchObject({ count: 1, incomeCents: 0n, netCents: 0n, transferCount: 1 });

    expect(await monthlyTotals(ctx, { ...MARCH, accountIds: [accountId] })).toEqual([
      { month: "2026-03-01", count: 3, netCents: -5_000n },
    ]);
    const view = await expensesView(ctx, MARCH);
    expect(view.facets.types).toEqual([
      { type: "expense", count: 2 },
      { type: "transfer", count: 2 },
    ]);
    // A type filter narrows the list, and the facet it came from still counts every type.
    const transfers = await expensesView(ctx, { ...MARCH, types: ["transfer"] });
    expect(transfers.rows.map((row) => row.payee)).toEqual(["Revolut", "Revolut"]);
    expect(transfers.facets.types).toEqual(view.facets.types);
  });

  it("takes a group's sub-categories in when the filter names the group, and says whose they are (F2.5)", async () => {
    const living = await createCategory(ctx, { name: "Living" });
    const groceries = (await listCategories(ctx)).find((one) => one.name === "Groceries");
    const utilities = (await listCategories(ctx)).find((one) => one.name === "Utilities");
    await updateCategory(ctx, groceries?.id ?? "", { name: "Groceries", parentId: living.id });
    await updateCategory(ctx, utilities?.id ?? "", { name: "Utilities", parentId: living.id });

    const payees = async (categoryIds: (string | null)[]) =>
      (await listTransactions(ctx, { categoryIds })).map((row) => row.payee);
    expect(await payees([living.id])).toEqual(["Esselunga", "Late Night", "Enel"]);
    expect(await payees([groceries?.id ?? ""])).toEqual(["Esselunga", "Late Night"]);
    expect(await payees([living.id, null])).toEqual(["Revolut", "Esselunga", "Late Night", "Enel"]);

    const slices = await categoryTotals(ctx, {});
    expect(slices.map((slice) => [slice.name, slice.parentName])).toEqual([
      ["Utilities", "Living"],
      ["Groceries", "Living"],
    ]);
    expect(slices[0]).toMatchObject({ parentId: living.id, parentColor: null });
  });

  it("adds up the spending per day or per month and per group, giroconti left out (F2.5)", async () => {
    const living = await createCategory(ctx, { name: "Living" });
    const groceries = (await listCategories(ctx)).find((one) => one.name === "Groceries");
    await updateCategory(ctx, groceries?.id ?? "", { name: "Groceries", parentId: living.id });
    const utilities = (await listCategories(ctx)).find((one) => one.name === "Utilities");

    // March by day: the two Groceries movements under their group, the −200 € giroconto nowhere.
    expect(await spendingOverTime(ctx, MARCH, "day")).toEqual([
      { bucket: "2026-03-02", groupId: living.id, groupName: "Living", groupColor: null, cents: 1_000n },
      { bucket: "2026-03-10", groupId: living.id, groupName: "Living", groupColor: null, cents: 4_000n },
    ]);
    // By month, February's Enel under its own (ungrouped) category.
    expect(await spendingOverTime(ctx, {}, "month")).toEqual([
      {
        bucket: "2026-02-01",
        groupId: utilities?.id,
        groupName: "Utilities",
        groupColor: null,
        cents: 6_000n,
      },
      { bucket: "2026-03-01", groupId: living.id, groupName: "Living", groupColor: null, cents: 5_000n },
    ]);
    // The other filters narrow it, the type filter does not turn it into something else.
    expect(await spendingOverTime(ctx, { ...MARCH, payee: "essel", types: ["income"] }, "day")).toEqual([
      { bucket: "2026-03-10", groupId: living.id, groupName: "Living", groupColor: null, cents: 4_000n },
    ]);
  });

  it("sorts by amount and by payee, deterministically", async () => {
    expect(
      (await listTransactions(ctx, { sort: "amount", direction: "asc" })).map((row) => row.payee),
    ).toEqual(["Revolut", "Enel", "Esselunga", "Late Night"]);
    expect((await listTransactions(ctx, { sort: "payee" })).map((row) => row.payee)).toEqual([
      "Enel",
      "Esselunga",
      "Late Night",
      "Revolut",
    ]);
  });

  it("searches the payees for the palette, ignoring case and hidden movements", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ externalId: "w-6", payee: "esselunga", amountCents: -1_100n }),
    ]);
    // Both spellings come back, each with its own count; which of the two comes first is the
    // database's collation and not this module's business.
    const found = await searchPayees(ctx, "essel");
    expect(found.map((one) => one.count)).toEqual([1, 1]);
    expect([...found.map((one) => one.payee)].sort()).toEqual(["Esselunga", "esselunga"]);

    const rows = await listTransactions(ctx, { payee: "esselunga" });
    expect(rows).toHaveLength(2);
    await hideTransactions(
      ctx,
      rows.map((row) => row.id),
    );
    expect(await searchPayees(ctx, "essel")).toEqual([]);

    expect((await searchPayees(ctx, "")).length).toBeGreaterThan(0);
    expect(await searchPayees(ctx, "%")).toEqual([]);
  });
});

/**
 * The five sortable columns of the design. The names are chosen so that no collation has an
 * opinion about them: same case, plain ASCII, and initials that any ordering agrees on (A < I < Z).
 */
describe("ordering", () => {
  beforeEach(async () => {
    const zulu = await anAccount(ctx, "Zulu Bank");
    const alpha = await anAccount(ctx, "Alpha Bank");
    await upsertFromProvider(ctx, zulu, [
      movement({
        externalId: "z-1",
        payee: "Zeta",
        amountCents: -3_000n,
        categoryExternalId: "c-z",
        categoryName: "Zulu",
        labels: [],
      }),
    ]);
    await upsertFromProvider(ctx, alpha, [
      movement({
        externalId: "a-1",
        payee: "Alfa",
        amountCents: -2_000n,
        categoryExternalId: "c-a",
        categoryName: "Alpha",
        labels: [],
      }),
    ]);
    // The account of the outer `beforeEach`, "ING Conto Arancio": no payee, no category.
    await upsertFromProvider(ctx, accountId, [
      movement({
        externalId: "i-1",
        payee: null,
        amountCents: -1_000n,
        categoryExternalId: null,
        categoryName: null,
        labels: [],
      }),
    ]);
  });

  it("orders by the account's name, not its id, in both directions", async () => {
    expect((await listTransactions(ctx, { sort: "account" })).map((row) => row.accountName)).toEqual([
      "Alpha Bank",
      "ING Conto Arancio",
      "Zulu Bank",
    ]);
    expect(
      (await listTransactions(ctx, { sort: "account", direction: "desc" })).map((row) => row.accountName),
    ).toEqual(["Zulu Bank", "ING Conto Arancio", "Alpha Bank"]);
  });

  it("orders by the category's name and leaves the uncategorised rows last either way", async () => {
    expect((await listTransactions(ctx, { sort: "category" })).map((row) => row.categoryName)).toEqual([
      "Alpha",
      "Zulu",
      null,
    ]);
    expect(
      (await listTransactions(ctx, { sort: "category", direction: "desc" })).map((row) => row.categoryName),
    ).toEqual(["Zulu", "Alpha", null]);
  });

  it("leaves a movement with no payee last either way", async () => {
    expect((await listTransactions(ctx, { sort: "payee" })).map((row) => row.payee)).toEqual([
      "Alfa",
      "Zeta",
      null,
    ]);
    expect(
      (await listTransactions(ctx, { sort: "payee", direction: "desc" })).map((row) => row.payee),
    ).toEqual(["Zeta", "Alfa", null]);
  });

  it("still orders by date and by amount", async () => {
    expect((await listTransactions(ctx, { sort: "amount" })).map((row) => row.amountCents)).toEqual([
      -1_000n,
      -2_000n,
      -3_000n,
    ]);
    expect(
      (await listTransactions(ctx, { sort: "amount", direction: "asc" })).map((row) => row.amountCents),
    ).toEqual([-3_000n, -2_000n, -1_000n]);
    expect(await listTransactions(ctx, { sort: "date" })).toHaveLength(3);
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  let id: string;
  let intruder: Ctx;

  beforeEach(async () => {
    await upsertFromProvider(ctx, accountId, [movement()]);
    id = (await listTransactions(ctx, {}))[0].id;
    intruder = await newContext();
  });

  it("shows another user's movements to nobody", async () => {
    expect(await listTransactions(intruder, {})).toEqual([]);
    expect(await listTransactions(intruder, { includeHidden: true })).toEqual([]);
    expect(await getTransaction(intruder, id)).toBeNull();
    expect(await monthlyTotals(intruder, {})).toEqual([]);
    expect(await categoryTotals(intruder, {})).toEqual([]);
    expect(await searchPayees(intruder, "essel")).toEqual([]);
    expect(await transactionsSummary(intruder, {})).toEqual({
      count: 0,
      incomeCents: 0n,
      expenseCents: 0n,
      netCents: 0n,
      transferCount: 0,
      unpairedTransferCount: 0,
    });
    const view = await expensesView(intruder, {});
    expect(view.rows).toEqual([]);
    expect(view.hasAny).toBe(false);
  });

  it("lets nobody edit, hide or unstamp another user's movement", async () => {
    await expect(updateTransaction(intruder, id, { note: "yours now" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(hideTransaction(intruder, id)).rejects.toMatchObject({ code: "not_found" });
    expect(await setCategory(intruder, [id], null)).toBe(0);
    expect(await hideTransactions(intruder, [id])).toBe(0);
    expect(await restoreTransactions(intruder, [id])).toBe(0);
    await markRemovedUpstream(intruder, [id]);
    expect(await clearRemovedUpstream(intruder, [id])).toBe(0);

    const row = await getTransaction(ctx, id);
    expect(row).toMatchObject({ note: null, hiddenAt: null, removedUpstreamAt: null });
    expect(row?.locallyEdited).toEqual([]);
  });

  it("lets nobody sync into another user's account", async () => {
    await expect(
      upsertFromProvider(intruder, accountId, [movement({ externalId: "w-9" })]),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await listTransactions(ctx, {})).toHaveLength(1);
    expect(await listTransactions(intruder, {})).toEqual([]);
  });

  it("keeps two users' identical external ids apart", async () => {
    const theirAccount = await anAccount(intruder, "Their bank");
    await upsertFromProvider(intruder, theirAccount, [movement({ payee: "Their Esselunga" })]);

    const mine = await listTransactions(ctx, {});
    const theirs = await listTransactions(intruder, {});
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0].id).not.toBe(theirs[0].id);
    expect(theirs[0].payee).toBe("Their Esselunga");
    expect((await listCategories(intruder)).map((one) => one.name)).toEqual(["Groceries"]);
  });
});

describe("linkOwnTransfers (F2.5)", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("takes a giroconto sent as an expense and an income out of the totals, once", async () => {
    const ctx = await newContext();
    // ISO 13616's example IBANs: valid check digits, nobody's account.
    const ing = await anAccount(ctx, "ING", "IT60 X054 2811 1010 0000 0123 456");
    const revolut = await anAccount(ctx, "Revolut", "GB82WEST12345698765432");
    await upsertFromProvider(ctx, ing, [
      movement({
        externalId: "w-out",
        amountCents: -50_000n,
        payee: "Bonifico",
        note: "A GB82 WEST 1234 5698 7654 32",
      }),
      movement({ externalId: "w-shop", amountCents: -2_500n }),
    ]);
    await upsertFromProvider(ctx, revolut, [
      movement({ externalId: "w-in", type: "income", amountCents: 50_000n, payee: "Mario", note: null }),
    ]);

    expect(await linkOwnTransfers(ctx)).toBe(2);
    const summary = await transactionsSummary(ctx);
    expect(summary).toMatchObject({
      incomeCents: 0n,
      expenseCents: -2_500n,
      transferCount: 2,
      unpairedTransferCount: 0,
    });
    expect(await linkOwnTransfers(ctx)).toBe(0);

    // The next sync re-reads the expense as Wallet sends it: it stays a giroconto.
    await upsertFromProvider(ctx, ing, [
      movement({
        externalId: "w-out",
        amountCents: -50_000n,
        payee: "Bonifico",
        note: "A GB82 WEST 1234 5698 7654 32",
      }),
    ]);
    expect((await transactionsSummary(ctx)).expenseCents).toBe(-2_500n);
  });
});

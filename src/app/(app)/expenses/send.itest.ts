// A manual movement on a "read and write" account, from the dialog to the source and back (rewrite
// plan N3.1; 12-account-modes.md §12.2; criteria 1, 2 and 3 of the release). The source is a
// stubbed `fetch` that keeps its own records: no call ever leaves the process, and no test holds a
// token of a real account.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { balancesOn, listAccounts } from "@domain/modules/accounts/queries";
import { createManualTransaction } from "@domain/modules/transactions/manual";
import { listTransactions } from "@domain/modules/transactions/queries";
import { updateTransaction } from "@domain/modules/transactions/service";
import { chooseSourceCategory, listSourceCategories } from "@domain/modules/transactions/source-categories";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import type { Ctx } from "@domain/platform/context";
import { addDays, today } from "@domain/platform/dates";
import { getDb } from "@domain/platform/db/client";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { DEFAULT_SYNC_SCHEDULE } from "@domain/platform/integrations/schedule";
import {
  listRuns,
  resolveExternal,
  saveConnection,
  saveSchedule,
} from "@domain/platform/integrations/service";
import type { WalletClientOptions } from "@domain/platform/integrations/wallet/client";
import { sendMarker } from "@domain/platform/integrations/wallet/send";
import { syncWalletNow } from "@domain/platform/integrations/wallet/sync";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import {
  createManual,
  deleteManual,
  manualAccounts,
  retrySend,
  sendSourceNames,
  updateManual,
} from "./manual";

const FIXTURES = join(process.cwd(), "test/fixtures/wallet");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

type Wire = { id: string; [key: string]: unknown };
const ACCOUNTS = fixture("accounts.json").accounts as Wire[];
const CATEGORIES = fixture("categories.json");
const TODAY = today("Europe/Rome");

/** What the source is told to do with the next request that creates a record. */
type CreateMode = "ok" | "refuse" | "down" | "lose_answer";

/**
 * The source, with a memory: a record created through `POST /records` is there for every reading
 * after it, and takes its amount off the account's balance, as the real one does.
 */
function source() {
  const records: Wire[] = [];
  const calls: string[] = [];
  const state = { create: "ok" as CreateMode, hideFromReadings: false, balanceCents: 261_539 };
  const bodies: Record<string, unknown>[] = [];
  const options: WalletClientOptions = {
    baseUrl: "https://source.test/api",
    sleep: async () => undefined,
    jitter: () => 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("/accounts")) {
        return Response.json({
          accounts: ACCOUNTS.map((account) =>
            account.id === "wa-general"
              ? { ...account, balance: { currentBalance: state.balanceCents / 100 } }
              : account,
          ),
        });
      }
      if (url.pathname.endsWith("/categories")) return Response.json(CATEGORIES);
      if (method === "POST") {
        if (state.create === "refuse") return Response.json({ error: "not accepted" }, { status: 400 });
        if (state.create === "down") return new Response("{}", { status: 503 });
        const [sent] = JSON.parse(String(init?.body)) as Record<string, unknown>[];
        bodies.push(sent);
        const category = (CATEGORIES.categories as Wire[]).find((one) => one.id === sent.categoryId);
        const record: Wire = {
          id: `wr-sent-${records.length + 1}`,
          accountId: sent.accountId,
          amount: { value: sent.amount, currencyCode: "EUR" },
          recordDate: `${String(sent.recordDate)}T10:00:00.000Z`,
          category: category ? { id: category.id, name: category.name, group: category.group ?? null } : null,
          labels: [],
          recordType: Number(sent.amount) < 0 ? "Expense" : "Income",
          recordState: "Cleared",
          note: sent.note,
          counterParty: null,
          transfer: null,
          updatedAt: null,
        };
        records.push(record);
        state.balanceCents += Math.round(Number(sent.amount) * 100);
        // The record is there, and the answer never arrives.
        if (state.create === "lose_answer") return new Response("{}", { status: 502 });
        return Response.json({ records: [{ id: record.id }] }, { status: 201 });
      }
      if (method === "PATCH") {
        const [patch] = JSON.parse(String(init?.body)) as Record<string, unknown>[];
        const record = records.find((one) => one.id === patch.id);
        if (record && typeof patch.counterParty === "string") record.counterParty = patch.counterParty;
        return Response.json({ results: [{ inputIndex: 0, success: record !== undefined, record }] });
      }
      const dates = url.searchParams.getAll("recordDate");
      const exact = dates.find((one) => one.startsWith("eq."))?.slice(3);
      if (exact !== undefined) {
        // The search by marker of the duplicate check.
        const marker = url.searchParams.get("note")?.replace("contains.", "") ?? "";
        const account = url.searchParams.get("accountId")?.replace("eq.", "");
        return Response.json({
          records: records.filter(
            (one) =>
              one.accountId === account &&
              String(one.recordDate).startsWith(exact) &&
              String(one.note ?? "").includes(marker),
          ),
        });
      }
      const from = dates.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
      const to = dates.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
      const inWindow = state.hideFromReadings
        ? []
        : records.filter((one) => {
            const on = String(one.recordDate).slice(0, 10);
            return on >= from && on <= to;
          });
      return Response.json({
        records: inWindow,
        appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${addDays(to, 1)}T00:00:00.000Z`],
      });
    },
  };
  const created = () => calls.filter((call) => call === "POST /api/records").length;
  return { records, calls, bodies, state, options, created };
}

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

function movement(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "expense",
    amountCents: 450n,
    on: TODAY,
    accountId,
    categoryId: null,
    payee: "Corner bar",
    note: "espresso",
    ...overrides,
  };
}

let ctx: Ctx;
let connectionId: string;
let wallet: ReturnType<typeof source>;
/** The account the source keeps, "read and write". */
let accountId: string;

const KEY = "0198a1c2-7d3e-7a4b-9c5d-2e6f7a8b9c0d";

async function update(): Promise<void> {
  await syncWalletNow(ctx, connectionId, { clientOptions: wallet.options, categoryWriter: null });
}

async function rows() {
  return listTransactions(ctx, { includeHidden: true, sort: "date", direction: "asc" });
}

async function balance(): Promise<bigint | undefined> {
  return (await balancesOn(ctx, [accountId], TODAY)).get(accountId);
}

async function lastRun(kind: string) {
  return (await listRuns(ctx, { limit: 20 })).find((run) => run.kind === kind);
}

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  connectionId = (
    await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "test-token-1" } })
  ).id;
  wallet = source();
  // The first update: the accounts and the categories of the source are here.
  await update();
  const account = (await listAccounts(ctx)).find((one) => one.providerAccountId === "wa-general");
  if (!account) throw new Error("the account of the source was not adopted");
  accountId = account.id;
});
afterAll(closeDatabase);

describe("a manual movement on a read-and-write account", () => {
  it("is offered by the dialog, under the name of its source", async () => {
    const offered = (await manualAccounts(ctx)).find((one) => one.id === accountId);
    expect(offered).toMatchObject({ mode: "two_way", source: { waiting: false } });
    expect(offered?.source?.name).toBeTruthy();
  });

  it("changes the balance at once, waits, and after the update is the source's own: one row (criterion 1)", async () => {
    expect(await balance()).toBe(261_539n);
    const { transaction } = await createManual(ctx, movement(accountId), KEY);

    // At once: the balance, and the state the row shows.
    expect(await balance()).toBe(261_089n);
    expect(await rows()).toMatchObject([{ id: transaction.id, origin: "manual", sendState: "to_send" }]);
    expect(wallet.created()).toBe(0);
    expect((await sendSourceNames(ctx, [accountId])).get(accountId)).toBeTruthy();

    await update();

    // One record on the source, with the marker of the movement and the payee.
    expect(wallet.records).toHaveLength(1);
    expect(wallet.records[0]).toMatchObject({
      accountId: "wa-general",
      amount: { value: -4.5 },
      note: `espresso\n${sendMarker(KEY)}`,
      counterParty: "Corner bar",
    });
    // One row here: the same one, now the source's, with the source's id and no marker in its note.
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: transaction.id,
      origin: "provider",
      sendState: null,
      payee: "Corner bar",
      note: "espresso",
      amountCents: -450n,
    });
    const linked = await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["wr-sent-1"]);
    expect(linked.get("wr-sent-1")).toBe(transaction.id);
    // The balance is the source's (criterion 2 of the plan).
    expect(await balance()).toBe(261_089n);
    expect((await lastRun("transactions"))?.counts).toMatchObject({ sent: 1 });

    // Another update asks for nothing and changes nothing.
    await update();
    expect(wallet.created()).toBe(1);
    expect(await rows()).toHaveLength(1);
    expect((await lastRun("transactions"))?.counts).not.toHaveProperty("sent");
  });

  it("is sent before anything is read, so the balance read in the same update holds it", async () => {
    await createManual(ctx, movement(accountId), KEY);
    wallet.calls.length = 0;
    await update();
    const firstRead = wallet.calls.findIndex((call) => call === "GET /api/accounts");
    expect(wallet.calls.indexOf("POST /api/records")).toBeGreaterThanOrEqual(0);
    expect(wallet.calls.indexOf("POST /api/records")).toBeLessThan(firstRead);
  });

  it("can be changed and deleted while it waits, like every manual movement", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    await updateManual(ctx, transaction.id, movement(accountId, { amountCents: 700n }));
    expect(await rows()).toMatchObject([{ amountCents: -700n, sendState: "to_send" }]);
    expect(await balance()).toBe(260_839n);

    await deleteManual(ctx, transaction.id);
    expect(await rows()).toHaveLength(0);
    expect(await balance()).toBe(261_539n);
    await update();
    expect(wallet.created()).toBe(0);
  });

  it("is sent with the amount it has when the update comes", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    await updateManual(ctx, transaction.id, movement(accountId, { amountCents: 700n, kind: "income" }));
    await update();
    expect(wallet.records).toMatchObject([{ amount: { value: 7 } }]);
    expect(await rows()).toMatchObject([{ origin: "provider", amountCents: 700n, type: "income" }]);
  });

  it("does not go while it is hidden, and goes when it is brought back", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    await getDb().execute(`update transactions set hidden_at = now() where id = '${transaction.id}'`);
    await update();
    expect(wallet.created()).toBe(0);
    await getDb().execute(`update transactions set hidden_at = null where id = '${transaction.id}'`);
    await update();
    expect(wallet.created()).toBe(1);
  });

  it("never sends a manual movement that was written before this release", async () => {
    // What the image before wrote on such an account, had it been allowed: a movement with no state.
    await createManualTransaction(ctx, movement(accountId), KEY);
    await update();
    await update();
    expect(wallet.created()).toBe(0);
    expect(await rows()).toMatchObject([{ origin: "manual", sendState: null }]);
  });
});

describe("a movement the source does not take (criterion 2)", () => {
  it("stays here as not sent, with its balance, and goes with the next update", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "refuse";
    await update();

    expect(await rows()).toMatchObject([{ id: transaction.id, origin: "manual", sendState: "not_sent" }]);
    expect(wallet.records).toHaveLength(0);
    // A refusal of one movement is not a failure of the connection (12-account-modes.md §12.8, 7).
    expect(await lastRun("transactions")).toMatchObject({ state: "success" });
    expect((await lastRun("transactions"))?.counts).toMatchObject({ notSent: 1 });

    wallet.state.create = "ok";
    await update();
    expect(wallet.records).toHaveLength(1);
    expect(await rows()).toMatchObject([{ id: transaction.id, origin: "provider", sendState: null }]);
  });

  it("fails the pass of the movements when the connection is what failed", async () => {
    await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "down";
    await expect(update()).rejects.toThrow();

    expect(await rows()).toMatchObject([{ origin: "manual", sendState: "not_sent" }]);
    expect(await lastRun("transactions")).toMatchObject({ state: "failed" });
    // The readings were still made: the accounts' pass is fine.
    expect(await lastRun("accounts")).toMatchObject({ state: "success" });
  });

  it("is sent by 'Retry sending', which updates the source now", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "refuse";
    await update();
    wallet.state.create = "ok";

    const started: string[] = [];
    const result = await retrySend(ctx, transaction.id, async (provider) => {
      started.push(provider);
      await update();
    });
    expect(started).toEqual([WALLET_PROVIDER]);
    expect(result).toEqual({ sent: true });
    expect(await rows()).toMatchObject([{ origin: "provider", sendState: null }]);
  });

  it("is not sent while the connection is paused, and goes when it is resumed", async () => {
    await createManual(ctx, movement(accountId), KEY);
    const scheduled = (await manualAccounts(ctx)).find((one) => one.id === accountId);
    expect(scheduled?.source?.waiting).toBe(false);

    await saveSchedule(ctx, connectionId, { rules: [] });
    expect((await manualAccounts(ctx)).find((one) => one.id === accountId)?.source?.waiting).toBe(true);
    await update();
    expect(wallet.created()).toBe(0);
    expect(await rows()).toMatchObject([{ origin: "manual", sendState: "to_send" }]);

    await saveSchedule(ctx, connectionId, DEFAULT_SYNC_SCHEDULE);
    await update();
    expect(wallet.created()).toBe(1);
    expect(await rows()).toMatchObject([{ origin: "provider", sendState: null }]);
  });
});

describe("the same key sent twice (criterion 3)", () => {
  it("is one record on the source when the answer of the first request is lost and the reading sees it", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "lose_answer";
    // The request fails, as far as this app can tell; the reading of the same update finds the
    // record by its marker and takes the waiting movement for it.
    await expect(update()).rejects.toThrow();
    expect(wallet.records).toHaveLength(1);
    expect(await rows()).toMatchObject([{ id: transaction.id, origin: "provider", sendState: null }]);

    wallet.state.create = "ok";
    await update();
    expect(wallet.created()).toBe(1);
    expect(wallet.records).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("is one record on the source when the answer is lost and no reading sees it: the next update looks first", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "lose_answer";
    wallet.state.hideFromReadings = true;
    await expect(update()).rejects.toThrow();
    expect(wallet.records).toHaveLength(1);
    expect(await rows()).toMatchObject([{ id: transaction.id, origin: "manual", sendState: "not_sent" }]);

    wallet.state.create = "ok";
    wallet.state.hideFromReadings = false;
    await update();
    // Not asked a second time: found by its marker and taken.
    expect(wallet.created()).toBe(1);
    expect(wallet.records).toHaveLength(1);
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: transaction.id, origin: "provider", sendState: null });
  });

  it("is one record on the source when the day is changed after a lost answer: it is looked for where it was asked", async () => {
    const { transaction } = await createManual(ctx, movement(accountId), KEY);
    wallet.state.create = "lose_answer";
    wallet.state.hideFromReadings = true;
    await expect(update()).rejects.toThrow();
    await updateManual(ctx, transaction.id, movement(accountId, { on: addDays(TODAY, -1) }));

    wallet.state.create = "ok";
    wallet.state.hideFromReadings = false;
    await update();
    expect(wallet.created()).toBe(1);
    expect(wallet.records).toHaveLength(1);
    // The record the source holds is the movement from here on.
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: transaction.id, origin: "provider", sendState: null, on: TODAY });
  });

  it("is one row here when the dialog sends the same key twice", async () => {
    const first = await createManual(ctx, movement(accountId), KEY);
    const second = await createManual(ctx, movement(accountId), KEY);
    expect(second).toMatchObject({ created: false, transaction: { id: first.transaction.id } });
    await update();
    expect(wallet.records).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });
});

describe("the category a movement is sent with", () => {
  async function category(name: string) {
    const found = (await listCategories(ctx)).find((one) => one.name === name);
    if (!found) throw new Error(`no category ${name}`);
    return found;
  }

  it("is the source's category that counts under the chosen one, and stays the source's after", async () => {
    const groceries = await category("Spesa");
    await createManual(ctx, movement(accountId, { categoryId: groceries.id }), KEY);
    await update();

    expect(wallet.bodies[0]).toMatchObject({ categoryId: "wc-groceries" });
    const [row] = await rows();
    expect(row).toMatchObject({ categoryId: groceries.id, categoryState: "chosen" });
    expect(row.locallyEdited).toEqual([]);
  });

  it("follows a match: a movement written under the matched category goes with the source's own", async () => {
    const salary = await category("Stipendio");
    const unsorted = (await listSourceCategories(ctx)).find((one) => one.name === "Da classificare");
    // "Da classificare" of the source now counts under "Stipendio": two of the source's categories
    // count under it, and the one with its name is the one a movement goes with.
    await getDb().transaction((tx) =>
      chooseSourceCategory(ctx, { id: unsorted!.id, categoryId: salary.id }, tx),
    );
    await createManual(ctx, movement(accountId, { categoryId: salary.id, kind: "income" }), KEY);
    await update();
    expect(wallet.bodies[0]).toMatchObject({ categoryId: "wc-salary" });
  });

  it("goes with no category when none of the source counts under it, and keeps the one chosen here", async () => {
    const [own] = await getDb()
      .execute<{ id: string }>(
        `insert into categories (user_id, name, type) values ('${ctx.userId}', 'Only here', 'expense') returning id`,
      )
      .then((result) => result.rows);
    const { transaction } = await createManual(ctx, movement(accountId, { categoryId: own.id }), KEY);
    await update();

    expect(wallet.bodies[0]).not.toHaveProperty("categoryId");
    // The source gives the record back with no category: the one chosen here stays, as a choice.
    await update();
    const [row] = await rows();
    expect(row).toMatchObject({ id: transaction.id, origin: "provider", categoryId: own.id });
    expect(row.locallyEdited).toContain("categoryId");
  });

  it("leaves a sent movement to the panel of the source's movements: its category can still be corrected", async () => {
    const groceries = await category("Spesa");
    const salary = await category("Stipendio");
    const { transaction } = await createManual(ctx, movement(accountId, { categoryId: groceries.id }), KEY);
    await update();
    await updateTransaction(ctx, transaction.id, { categoryId: salary.id });
    await update();
    expect(await rows()).toMatchObject([{ categoryId: salary.id }]);
  });
});

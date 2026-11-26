// The giroconti between a person's accounts (decisions 6A–10A of 2026-11-25), against the database:
// the pairing after a reading, the choices of the person, the proposals, the totals. Synthetic data
// only: ISO 13616's example IBANs (valid check digits, nobody's account) and made-up amounts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { getPool } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";
import { categoryTotals, listTransactions, transactionsSummary } from "./queries";
import { badgesOf, type IncomingTransaction } from "./rules";
import {
  answerTransferProposal,
  chooseTransferSide,
  linkOwnTransfers,
  listTransferProposals,
  pairByHand,
  setCategory,
  upsertFromProvider,
} from "./service";
import { createCategory } from "./taxonomy";

const IBAN_ING = "IT60X0542811101000000123456";
const IBAN_REV = "GB82WEST12345698765432";

async function newContext(): Promise<Ctx> {
  const { id } = await createTestUser();
  return {
    userId: id,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

async function anAccount(ctx: Ctx, name: string, iban = ""): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: iban,
    iban,
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

/** One movement as a source with no categories hands it over (a bank). */
function movement(
  over: Partial<IncomingTransaction> & Pick<IncomingTransaction, "externalId">,
): IncomingTransaction {
  const amountCents = over.amountCents ?? -50_000n;
  return {
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T11:00:00Z"),
    amountCents,
    currency: "EUR",
    type: amountCents < 0n ? "expense" : "income",
    state: "cleared",
    payee: null,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...over,
  };
}

async function read(ctx: Ctx, accountId: string, movements: IncomingTransaction[]): Promise<void> {
  await upsertFromProvider(ctx, accountId, movements, { provider: WALLET_PROVIDER });
}

async function rows(ctx: Ctx) {
  const all = await listTransactions(ctx, { includeHidden: true, limit: 100 });
  return new Map(all.map((row) => [row.payee ?? row.note ?? row.id, row]));
}

let ctx: Ctx;
let ing: string;
let rev: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  ing = await anAccount(ctx, "Conto uno", IBAN_ING);
  rev = await anAccount(ctx, "Conto due", IBAN_REV);
});
afterAll(closeDatabase);

describe("the giroconti found after a reading", () => {
  it("pairs the two legs of the screenshot by IBAN, and leaves the third to choose", async () => {
    // Three of the same amount on the same day: money out of the second account, money into the
    // first naming the second's IBAN, money into the second from a pocket nobody linked. All three
    // were filed under "Savings", so they are giroconti that wait (the migration's `type` marker).
    const leg = { type: "transfer" as const };
    await read(ctx, rev, [
      movement({ externalId: "a", ...leg, amountCents: -25_100n, payee: "A out" }),
      movement({ externalId: "c", ...leg, amountCents: 25_100n, payee: "C pocket" }),
    ]);
    await read(ctx, ing, [
      movement({ externalId: "b", ...leg, amountCents: 25_100n, payee: "B in", note: `Da ${IBAN_REV}` }),
    ]);
    const found = await rows(ctx);
    const [a, b, c] = ["A out", "B in", "C pocket"].map((name) => found.get(name)!);
    expect(a.transferGroupId).not.toBeNull();
    expect(b.transferGroupId).toBe(a.transferGroupId);
    expect([a.transferAccountId, b.transferAccountId]).toEqual([ing, rev]);
    expect(c.transferGroupId).toBeNull();
    expect(badgesOf(c)).toContain("unpaired");
    expect(badgesOf(a)).toEqual(["transfer"]);
    expect((await transactionsSummary(ctx)).unpairedTransferCount).toBe(1);
    expect(await listTransferProposals(ctx)).toEqual([]);
    expect(await linkOwnTransfers(ctx)).toBe(0);
  });

  it("makes a giroconto of a bank movement that names another account's IBAN (8A)", async () => {
    await read(ctx, ing, [movement({ externalId: "out", payee: "Bonifico", note: `A ${IBAN_REV}` })]);
    let out = (await rows(ctx)).get("Bonifico")!;
    // Its twin has not arrived: it waits in the account the IBAN names, out of the spending.
    expect(out).toMatchObject({ type: "transfer", transferGroupId: null, transferAccountId: rev });
    expect(badgesOf(out)).toEqual(["transfer"]);
    expect((await transactionsSummary(ctx)).expenseCents).toBe(0n);

    await read(ctx, rev, [movement({ externalId: "in", amountCents: 50_000n, payee: "Arrivo" })]);
    const both = await rows(ctx);
    out = both.get("Bonifico")!;
    expect(out.transferGroupId).not.toBeNull();
    expect(both.get("Arrivo")).toMatchObject({ type: "transfer", transferGroupId: out.transferGroupId });
  });
});

describe("the proposals: a tie is never decided", () => {
  beforeEach(async () => {
    await read(ctx, ing, [movement({ externalId: "o", type: "transfer", payee: "Out" })]);
    await read(ctx, rev, [
      movement({ externalId: "i1", amountCents: 50_000n, payee: "In one" }),
      movement({ externalId: "i2", amountCents: 50_000n, payee: "In two" }),
    ]);
  });

  it("proposes both pairs of equal amounts and pairs nothing", async () => {
    const found = await rows(ctx);
    expect([...found.values()].every((row) => row.transferGroupId === null)).toBe(true);
    const proposals = await listTransferProposals(ctx);
    expect(proposals.map((one) => [one.out.payee, one.in.payee]).sort()).toEqual([
      ["Out", "In one"],
      ["Out", "In two"],
    ]);
    expect(proposals[0].out).toMatchObject({ accountId: ing, amountCents: -50_000n, on: "2026-03-10" });
  });

  it("pairs by hand on «yes», and the other proposal goes", async () => {
    const [first] = await listTransferProposals(ctx);
    await answerTransferProposal(ctx, first.id, true);
    const found = await rows(ctx);
    expect(found.get("Out")!.transferGroupId).toBe(found.get(first.in.payee!)!.transferGroupId);
    expect(found.get("Out")!.locallyEdited).toContain("transferGroupId");
    expect(await listTransferProposals(ctx)).toEqual([]);
    // A hand-made pair stays whatever the rules would say now.
    expect(await linkOwnTransfers(ctx)).toBe(0);
  });

  it("keeps a «no», and pairs the one candidate left", async () => {
    const proposals = await listTransferProposals(ctx);
    const refused = proposals.find((one) => one.in.payee === "In one")!;
    await answerTransferProposal(ctx, refused.id, false);
    const found = await rows(ctx);
    expect(found.get("Out")!.transferGroupId).toBe(found.get("In two")!.transferGroupId);
    expect(found.get("In one")!.transferGroupId).toBeNull();
    expect(await listTransferProposals(ctx)).toEqual([]);
    await expect(answerTransferProposal(ctx, refused.id, true)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("what the person decides", () => {
  it("pairs by hand across amounts, and no rule moves the pair", async () => {
    await read(ctx, ing, [movement({ externalId: "o", type: "transfer", payee: "Out" })]);
    await read(ctx, rev, [
      movement({ externalId: "i1", amountCents: 49_000n, payee: "Changed" }),
      movement({ externalId: "i2", amountCents: 50_000n, type: "transfer", payee: "Same" }),
    ]);
    let found = await rows(ctx);
    // The rules pair the same amount…
    expect(found.get("Out")!.transferGroupId).toBe(found.get("Same")!.transferGroupId);
    // …the person says otherwise: the pair moves, the left leg waits for them.
    await pairByHand(ctx, found.get("Out")!.id, found.get("Changed")!.id);
    expect(await linkOwnTransfers(ctx)).toBe(0);
    found = await rows(ctx);
    expect(found.get("Out")!.transferGroupId).toBe(found.get("Changed")!.transferGroupId);
    expect(found.get("Changed")!.type).toBe("transfer");
    expect(found.get("Same")).toMatchObject({ transferGroupId: null, type: "transfer" });
    expect(badgesOf(found.get("Same")!)).toContain("unpaired");
    await expect(pairByHand(ctx, found.get("Out")!.id, found.get("Out")!.id)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("chooses an account, pairing the leg that is unique there", async () => {
    await read(ctx, ing, [movement({ externalId: "o", payee: "Out" })]);
    await read(ctx, rev, [movement({ externalId: "i", amountCents: 50_000n, payee: "In" })]);
    let found = await rows(ctx);
    expect(found.get("Out")!.type).toBe("expense");
    await chooseTransferSide(ctx, found.get("Out")!.id, { kind: "account", accountId: rev });
    found = await rows(ctx);
    expect(found.get("Out")!.transferGroupId).toBe(found.get("In")!.transferGroupId);
    expect(found.get("Out")!.transferAccountId).toBe(rev);
    await expect(
      chooseTransferSide(ctx, found.get("Out")!.id, { kind: "account", accountId: ing }),
    ).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("sends a giroconto outside: out of income, spending, categories and «choose the account»", async () => {
    const groceries = await createCategory(ctx, {
      name: "Spesa",
      type: "expense",
      parentId: null,
      color: null,
    });
    await read(ctx, ing, [
      movement({ externalId: "o", payee: "To a friend", amountCents: -7_000n }),
      movement({ externalId: "s", payee: "Shop", amountCents: -1_000n }),
    ]);
    let found = await rows(ctx);
    await setCategory(ctx, [found.get("To a friend")!.id, found.get("Shop")!.id], groceries.id);
    await chooseTransferSide(ctx, found.get("To a friend")!.id, { kind: "outside" });
    found = await rows(ctx);
    expect(found.get("To a friend")).toMatchObject({
      type: "transfer",
      transferOutside: true,
      categoryId: null,
      transferAccountId: null,
    });
    expect(badgesOf(found.get("To a friend")!)).toEqual(["edited", "transfer"]); // the category chosen first
    expect(await transactionsSummary(ctx)).toMatchObject({
      expenseCents: -1_000n,
      incomeCents: 0n,
      transferCount: 1,
      unpairedTransferCount: 0,
    });
    expect((await categoryTotals(ctx)).map((one) => [one.categoryId, one.totalCents])).toEqual([
      [groceries.id, -1_000n],
    ]);
    // A category is never given to a giroconto: the selection leaves it alone.
    expect(await setCategory(ctx, [found.get("To a friend")!.id], groceries.id)).toBe(0);
  });

  it("makes a giroconto «not a giroconto» again, and its partner waits for the person", async () => {
    await read(ctx, ing, [movement({ externalId: "o", payee: "Out", note: IBAN_REV })]);
    await read(ctx, rev, [movement({ externalId: "i", amountCents: 50_000n, payee: "In" })]);
    let found = await rows(ctx);
    expect(found.get("Out")!.transferGroupId).not.toBeNull();
    await chooseTransferSide(ctx, found.get("Out")!.id, { kind: "none" });
    found = await rows(ctx);
    expect(found.get("Out")).toMatchObject({ type: "expense", transferGroupId: null });
    expect(found.get("In")).toMatchObject({ type: "transfer", transferGroupId: null });
    expect(badgesOf(found.get("In")!)).toContain("unpaired");
    // The IBAN is still in its text: the person's word wins over it.
    expect(await linkOwnTransfers(ctx)).toBe(0);
    expect((await transactionsSummary(ctx)).expenseCents).toBe(-50_000n);
  });
});

describe("a run of the rules never undoes what the person did meanwhile", () => {
  it("leaves a category filed between the run's read and its write, and plans again", async () => {
    const groceries = await createCategory(ctx, {
      name: "Spesa",
      type: "expense",
      parentId: null,
      color: null,
    });
    await read(ctx, ing, [movement({ externalId: "o", payee: "Bonifico" })]);
    const id = (await rows(ctx)).get("Bonifico")!.id;
    // The IBAN of the other account lands in its text with no run: the next run makes it a giroconto.
    const pool = getPool();
    await pool.query("UPDATE transactions SET note = $1 WHERE id = $2", [`A ${IBAN_REV}`, id]);
    // The person files it, in a transaction that holds the row while the run reads and plans.
    const person = await pool.connect();
    try {
      await person.query("BEGIN");
      await person.query("UPDATE transactions SET category_id = $1, category_origin = 'user' WHERE id = $2", [
        groceries.id,
        id,
      ]);
      const run = linkOwnTransfers(ctx);
      await waitForALockWait();
      await person.query("COMMIT");
      expect(await run).toBe(0);
    } finally {
      person.release();
    }
    expect((await rows(ctx)).get("Bonifico")).toMatchObject({
      type: "expense",
      categoryId: groceries.id,
      transferAccountId: null,
    });
  });
});

/** Until a statement of the database waits for a row lock: the run has read, planned and tries to write. */
async function waitForALockWait(): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    const { rows: waiting } = await getPool().query(
      "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (waiting.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the run never waited for the row");
}

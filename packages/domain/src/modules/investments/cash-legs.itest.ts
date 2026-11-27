// The deposits and withdrawals of Investments as giroconti in the accounts (PERS-651), against the
// database: the leg on the investment account, its pairing with the bank's movement (one candidate,
// several, none), what follows an edit and a deletion, a provider's events read again, the history
// linked once, and the money that does not change. Synthetic data only: made-up names and amounts.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readingsAt } from "../accounts";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { saveRates } from "../../platform/fx/service";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";
import { updateManualTransaction } from "../transactions";
import { listTransactions, transactionsSummary } from "../transactions/queries";
import {
  chooseTransferSide,
  deleteHiddenTransactions,
  hideTransactions,
  listTransferProposals,
  upsertFromProvider,
} from "../transactions/service";
import { serviceActivity } from "./queries/activity-tab";
import { investmentEvents } from "./schema";
import {
  createPortfolioWithAccount,
  deleteOperation,
  insertEvent,
  linkAllCashLegs,
  linkCashLegs,
  lockInvestmentAccount,
  readOperation,
  recordOperation,
  updateOperation,
} from "./service";

const DAY = "2026-03-10";
let ctx: Ctx;
let bank: string;
let broker: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  bank = await anAccount(ctx, "Conto corrente");
  ({ accountId: broker } = await createPortfolioWithAccount(ctx, {
    name: "Broker",
    currency: "EUR",
    url: null,
  }));
});
afterAll(closeDatabase);

/** The bank's movement of `cents` on `day`, as its source reads it, with no category. */
const readBank = (cents: bigint, day = DAY, payee = "Bonifico") =>
  upsertFromProvider(
    ctx,
    bank,
    [
      movement({
        occurredAt: new Date(`${day}T09:00:00Z`),
        amountCents: cents,
        type: cents < 0n ? "expense" : "income",
        payee,
        categoryName: null,
      }),
    ],
    { provider: WALLET_PROVIDER },
  );

const legsOf = async (accountId: string) =>
  (await listTransactions(ctx, { includeHidden: true, limit: 100 })).filter(
    (row) => row.accountId === accountId && row.origin === "investments",
  );

const deposit = (amountCents: bigint, on = DAY, extra: Record<string, unknown> = {}) =>
  recordOperation(ctx, broker, { kind: "deposit", on, amountCents, ...extra });

async function bankRow(payee = "Bonifico") {
  const rows = await listTransactions(ctx, { includeHidden: true, limit: 100 });
  return rows.find((row) => row.accountId === bank && row.payee === payee)!;
}

describe("a deposit's leg in the accounts", () => {
  it("pairs with the one bank movement that matches, and changes no money", async () => {
    await readBank(-1_000_00n);
    const valueBefore = (await readingsAt(ctx, [broker], DAY)).get(broker);
    const { eventId } = await deposit(1_000_00n);

    const [leg] = await legsOf(broker);
    expect(leg).toMatchObject({ amountCents: 1_000_00n, type: "transfer", transferOutside: false });
    expect(leg.transferGroupId).not.toBeNull();
    expect((await bankRow()).transferGroupId).toBe(leg.transferGroupId);
    const [event] = await getDb().select().from(investmentEvents).where(eq(investmentEvents.id, eventId));
    expect(event.legTransactionId).toBe(leg.id);

    // The value is the portfolio's cash: the leg moves nothing; the giroconto is out of the totals.
    expect((await readingsAt(ctx, [broker], DAY)).get(broker)).toBe(1_000_00n);
    expect(valueBefore ?? 0n).toBe(0n);
    expect(await transactionsSummary(ctx, {})).toMatchObject({
      incomeCents: 0n,
      expenseCents: 0n,
      unpairedTransferCount: 0,
    });
    const activity = await serviceActivity(ctx, broker, {
      from: null,
      to: DAY,
      family: null,
      q: null,
      assetId: null,
      page: 1,
    });
    expect(activity?.sums.depositsCents).toBe(1_000_00n);
    expect(activity?.rows[0]).toMatchObject({ id: eventId, legTransactionId: leg.id });
  });

  it("is a proposal with two candidates, never a choice", async () => {
    await readBank(-500_00n, DAY, "Primo");
    await readBank(-500_00n, DAY, "Secondo");
    await deposit(500_00n);
    const [leg] = await legsOf(broker);
    expect(leg).toMatchObject({ type: "transfer", transferGroupId: null, transferOutside: false });
    expect(await listTransferProposals(ctx)).toHaveLength(2);
  });

  it("comes from an account outside with no candidate, and pairs when the bank's movement arrives", async () => {
    await deposit(300_00n);
    const [leg] = await legsOf(broker);
    expect(leg).toMatchObject({ type: "transfer", transferOutside: true, transferGroupId: null });
    await readBank(-300_00n);
    const [paired] = await legsOf(broker);
    expect(paired).toMatchObject({
      transferOutside: false,
      transferGroupId: (await bankRow()).transferGroupId,
    });
    expect(paired.transferGroupId).not.toBeNull();
  });

  it("keeps the side the person chose: an income stays one", async () => {
    await readBank(-200_00n);
    await deposit(200_00n, DAY, { counterpart: { kind: "none" } });
    const [leg] = await legsOf(broker);
    expect(leg).toMatchObject({ type: "income", transferGroupId: null, transferOutside: false });
    expect((await bankRow()).transferGroupId).toBeNull();
  });

  it("a withdrawal is money out of the investment account, paired with the bank's income", async () => {
    await deposit(1_000_00n, "2026-03-01");
    await readBank(400_00n, DAY, "Rientro");
    await recordOperation(ctx, broker, { kind: "withdrawal", on: DAY, amountCents: 400_00n });
    const out = (await legsOf(broker)).find((leg) => leg.amountCents < 0n)!;
    expect(out.amountCents).toBe(-400_00n);
    expect(out.transferGroupId).toBe((await bankRow("Rientro")).transferGroupId);
  });
});

describe("the leg follows its deposit", () => {
  it("a new amount takes it out of the pair: the bank's movement waits again", async () => {
    await readBank(-1_000_00n);
    const { eventId } = await deposit(1_000_00n);
    await updateOperation(ctx, eventId, { kind: "deposit", on: DAY, amountCents: 900_00n });
    const [leg] = await legsOf(broker);
    expect(leg).toMatchObject({ amountCents: 900_00n, transferGroupId: null, transferOutside: true });
    const bankLeg = await bankRow();
    expect(bankLeg).toMatchObject({
      type: "transfer",
      transferGroupId: null,
      transferOutside: false,
      transferAccountId: null,
    });
  });

  it("follows the account the person chose: the old one's movement waits again, the new one's pairs (PERS-683)", async () => {
    const savings = await anAccount(ctx, "Conto risparmio");
    await readBank(-400_00n);
    await upsertFromProvider(
      ctx,
      savings,
      [
        movement({
          occurredAt: new Date(`${DAY}T09:00:00Z`),
          amountCents: -400_00n,
          type: "expense",
          payee: "Risparmio",
          categoryName: null,
        }),
      ],
      { provider: WALLET_PROVIDER },
    );
    const balances = async () => readingsAt(ctx, [bank, savings, broker], DAY);
    const { eventId } = await deposit(400_00n, DAY, { counterpart: { kind: "account", accountId: bank } });
    const before = await balances();
    const [leg] = await legsOf(broker);
    expect(leg.transferAccountId).toBe(bank);
    expect(leg.transferGroupId).toBe((await bankRow()).transferGroupId);

    await updateOperation(
      ctx,
      eventId,
      {
        kind: "deposit",
        on: DAY,
        amountCents: 400_00n,
        counterpart: { kind: "account", accountId: savings },
      },
      broker,
    );
    const [moved] = await legsOf(broker);
    expect(moved).toMatchObject({ id: leg.id, transferAccountId: savings, amountCents: 400_00n });
    expect(moved.transferGroupId).not.toBeNull();
    const savingsRow = (await listTransactions(ctx, { includeHidden: true, limit: 100 })).find(
      (row) => row.accountId === savings,
    )!;
    expect(moved.transferGroupId).toBe(savingsRow.transferGroupId);
    expect((await bankRow()).transferGroupId).toBeNull();
    // Each account's balance is its own movements': the pairing moves, no money does.
    expect(await balances()).toEqual(before);

    // A new amount: the broker's leg and its value follow.
    await updateOperation(ctx, eventId, { kind: "deposit", on: DAY, amountCents: 300_00n }, broker);
    expect((await legsOf(broker))[0].amountCents).toBe(300_00n);
    expect((await readingsAt(ctx, [broker], DAY)).get(broker)).toBe(300_00n);
  });

  it("reads the side the rules paired as the deposit's counterpart, and the side sent back keeps the pair (PERS-695)", async () => {
    await readBank(-400_00n);
    const { eventId } = await deposit(400_00n);
    const pair = (await bankRow()).transferGroupId;
    expect(pair).not.toBeNull();
    const [legBefore] = await legsOf(broker);
    const read = await readOperation(ctx, broker, eventId);
    expect(read).toMatchObject({
      kind: "deposit",
      amountCents: 400_00n,
      transactionId: null,
      counterpart: { kind: "account", accountId: bank },
    });
    if (read.kind !== "deposit") throw new Error("a deposit");
    await updateOperation(
      ctx,
      eventId,
      { kind: "deposit", on: read.on, amountCents: read.amountCents, counterpart: read.counterpart },
      broker,
    );
    // The side read sent back is no new choice: the pair stays…
    expect((await bankRow()).transferGroupId).toBe(pair);
    // …and the leg stays the rules' own, with no choice of the person on it.
    expect((await legsOf(broker))[0]).toEqual(legBefore);
  });

  it("goes with its deposit; the bank's movement stays and waits", async () => {
    await readBank(-1_000_00n);
    const { eventId } = await deposit(1_000_00n);
    await deleteOperation(ctx, eventId, broker);
    expect(await legsOf(broker)).toEqual([]);
    expect(await bankRow()).toMatchObject({ type: "transfer", transferGroupId: null });
  });

  it("is not the person's to delete or rewrite in Expenses, only to retype", async () => {
    await deposit(100_00n);
    const [leg] = await legsOf(broker);
    await hideTransactions(ctx, [leg.id]);
    expect(await deleteHiddenTransactions(ctx, [leg.id])).toBe(0);
    await expect(
      updateManualTransaction(ctx, leg.id, { kind: "income", accountId: broker, on: DAY, amountCents: 1n }),
    ).rejects.toMatchObject({ code: "not_manual" });
    await chooseTransferSide(ctx, leg.id, { kind: "none" });
    expect((await legsOf(broker))[0]).toMatchObject({ type: "income", amountCents: 100_00n });
  });
});

describe("the history and a provider's events", () => {
  it("links a deposit written before the release once: a second run changes nothing", async () => {
    await readBank(-1_000_00n);
    const { eventId } = await deposit(1_000_00n);
    // As before the release: no leg.
    await getDb()
      .update(investmentEvents)
      .set({ legTransactionId: null })
      .where(eq(investmentEvents.id, eventId));
    await getDb().execute(sql`delete from transactions where origin = 'investments'`);
    await getDb().execute(sql`update transactions set transfer_group_id = null where account_id = ${bank}`);
    expect((await bankRow()).transferGroupId).toBeNull();

    expect(await linkAllCashLegs(ctx)).toBeGreaterThan(0);
    const [leg] = await legsOf(broker);
    expect(leg.transferGroupId).toBe((await bankRow()).transferGroupId);
    expect(await linkAllCashLegs(ctx)).toBe(0);
    expect(await legsOf(broker)).toHaveLength(1);
  });

  it("gives a provider's deposit its leg once, however often the pass runs", async () => {
    await readBank(-250_00n);
    await getDb().transaction(async (trx) => {
      const investment = await lockInvestmentAccount(ctx, broker, trx);
      await insertEvent(ctx, trx, investment.id, {
        on: DAY,
        occurredAt: new Date(`${DAY}T10:00:00Z`),
        origin: "provider",
        legs: [{ leg: "main", kind: "deposit", amountCents: 250_00n }],
      });
    });
    expect(await linkCashLegs(ctx, broker)).toBeGreaterThan(0);
    expect(await linkCashLegs(ctx, broker)).toBe(0);
    const legs = await legsOf(broker);
    expect(legs).toHaveLength(1);
    expect(legs[0].transferGroupId).toBe((await bankRow()).transferGroupId);
  });
});

describe("a leg in another currency than the bank's movement (PERS-659)", () => {
  let usdBroker: string;
  beforeEach(async () => {
    ({ accountId: usdBroker } = await createPortfolioWithAccount(ctx, {
      name: "Broker USD",
      currency: "USD",
      url: null,
    }));
    // 1 EUR = 1.10 USD: 500.00 EUR are 550.00 USD.
    await saveRates([{ on: DAY, currency: "USD", eurPerUnit: "0.9090909091" }]);
  });
  const depositUsd = (amountCents: bigint) =>
    recordOperation(ctx, usdBroker, { kind: "deposit", on: DAY, amountCents });

  it("pairs within 3 % of the bank's amount converted on its day", async () => {
    await readBank(-500_00n);
    await depositUsd(540_00n);
    const [leg] = await legsOf(usdBroker);
    expect(leg).toMatchObject({ currency: "USD", transferOutside: false });
    expect(leg.transferGroupId).toBe((await bankRow()).transferGroupId);
  });

  it("comes from an account outside beyond the gap; the bank's movement waits", async () => {
    await readBank(-500_00n);
    await depositUsd(520_00n);
    const [leg] = await legsOf(usdBroker);
    expect(leg).toMatchObject({ transferOutside: true, transferGroupId: null });
    expect((await bankRow()).transferGroupId).toBeNull();
  });

  it("is a proposal with two bank movements that fit", async () => {
    await readBank(-500_00n, DAY, "Bonifico");
    await readBank(-500_00n, DAY, "Bonifico bis");
    await depositUsd(545_00n);
    expect(await listTransferProposals(ctx)).toHaveLength(2);
    expect((await legsOf(usdBroker))[0]).toMatchObject({ transferOutside: false, transferGroupId: null });
  });

  it("links a provider's deposit and the history once", async () => {
    await readBank(-500_00n);
    await getDb().transaction(async (trx) => {
      const investment = await lockInvestmentAccount(ctx, usdBroker, trx);
      await insertEvent(ctx, trx, investment.id, {
        on: DAY,
        occurredAt: new Date(`${DAY}T10:00:00Z`),
        origin: "provider",
        legs: [{ leg: "main", kind: "deposit", amountCents: 545_00n }],
      });
    });
    expect(await linkAllCashLegs(ctx)).toBeGreaterThan(0);
    expect(await linkAllCashLegs(ctx)).toBe(0);
    const legs = await legsOf(usdBroker);
    expect(legs).toHaveLength(1);
    expect(legs[0].transferGroupId).toBe((await bankRow()).transferGroupId);
  });
});

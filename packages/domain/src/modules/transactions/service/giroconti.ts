// modules/transactions/service/giroconti.ts — the giroconti between a person's accounts (decisions
// 6A–10A of 2026-11-25): the automatic pairing after every write that can make one, and what the
// person decides by hand — the other account, an account outside, "not a giroconto", a pair, an
// answer to a proposal. The rules are `rules/giroconti.ts`; this file reads and writes.
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getAccount, listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, civilDateIn } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { normalizeIban, type OwnIban, type OwnTransferPlan, planOwnTransfers, proposalKey } from "../rules";
import { retypeMovements } from "../macro";
import { transactions, girocontoProposals } from "../schema";
import { TransactionError, parseId, requireTransaction } from "./guards";

type Who = Pick<Ctx, "userId">;

/** The marker of a pair a person made or confirmed: no rule ever takes it apart or moves it. */
export const PAIRED_BY_HAND = "transferGroupId";

/** A giroconto has accounts, not a category: what a row loses when it becomes one. */
const NO_CATEGORY = {
  categoryId: null,
  categoryOrigin: null,
  categoryConfidence: null,
  categoryModelVersion: null,
  categoryReason: null,
  categoryReasonParams: null,
  categoryRuleId: null,
  suggestedCategoryId: null,
} as const;

const withMarkers = (current: readonly string[], ...added: string[]) =>
  [...new Set([...current, ...added])].sort();

/* Automatic pairing */

/** The person's own IBANs, archived accounts included: a transfer to one is still a giroconto. */
async function ownIbans(ctx: Who): Promise<OwnIban[]> {
  return (await listAccounts(ctx, { includeArchived: true })).flatMap((account) => {
    const iban = normalizeIban(account.iban);
    return iban === null ? [] : [{ accountId: account.id, iban }];
  });
}

/** The movements that count — not hidden, not gone — as the rules of the giroconti read them. */
function pairingRows(ctx: Who, only?: SQL) {
  return getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      type: transactions.type,
      origin: transactions.origin,
      transferGroupId: transactions.transferGroupId,
      transferOutside: transactions.transferOutside,
      transferAccountId: transactions.transferAccountId,
      payee: transactions.payee,
      note: transactions.note,
      rawText: transactions.rawText,
      bankTransactionCode: transactions.bankTransactionCode,
      categoryOrigin: transactions.categoryOrigin,
      locallyEdited: transactions.locallyEdited,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
        only,
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
}

/**
 * The rows the rules can join to `seeds`: the rules pair only the same amount (both signs), and a
 * pair counts its members; so the seeds, the rows of their amounts and the members of their pairs,
 * again until no new amount or pair appears. The plan over these is the plan over all, on them.
 */
async function rowsAround(ctx: Who, seeds: readonly string[]): Promise<PairingRow[]> {
  const amounts = new Set<Cents>();
  const groups = new Set<string>();
  for (;;) {
    const rows = await pairingRows(
      ctx,
      or(
        inArray(transactions.id, [...seeds]),
        groups.size > 0 ? inArray(transactions.transferGroupId, [...groups]) : undefined,
        amounts.size > 0 ? inArray(transactions.amountCents, [...amounts]) : undefined,
      ),
    );
    const known = amounts.size + groups.size;
    for (const row of rows) {
      amounts.add(row.amountCents).add(-row.amountCents);
      if (row.transferGroupId !== null) groups.add(row.transferGroupId);
    }
    if (amounts.size + groups.size === known) return rows;
  }
}

function proposalRows(ctx: Who) {
  return getDb()
    .select({
      id: girocontoProposals.id,
      outId: girocontoProposals.outId,
      inId: girocontoProposals.inId,
      state: girocontoProposals.state,
    })
    .from(girocontoProposals)
    .where(userScoped(ctx).owns(girocontoProposals))
    .orderBy(girocontoProposals.id);
}

type PairingRow = Awaited<ReturnType<typeof pairingRows>>[number];

/** A row changed between the read and the write of a run: the run plans again. */
class StalePlan extends Error {}

/** The row is still as the run read it: nobody paired it, retyped it, filed it or hid it since. */
const unchanged = (row: PairingRow) =>
  and(
    eq(transactions.type, row.type),
    eq(transactions.transferOutside, row.transferOutside),
    sql`${transactions.transferGroupId} is not distinct from ${row.transferGroupId}`,
    sql`${transactions.transferAccountId} is not distinct from ${row.transferAccountId}`,
    sql`${transactions.categoryOrigin} is not distinct from ${row.categoryOrigin}`,
    isNull(transactions.hiddenAt),
  );

/** Writes what the rules decided, inside the caller's transaction, on rows nobody changed since. */
async function writePlan(
  trx: Tx,
  ctx: Who,
  plan: OwnTransferPlan,
  byId: ReadonlyMap<string, PairingRow>,
): Promise<void> {
  const write = async (id: string, values: Partial<typeof transactions.$inferInsert>) => {
    const written = await trx
      .update(transactions)
      .set(values)
      .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions), unchanged(byId.get(id)!)))
      .returning({ id: transactions.id });
    if (written.length === 0) throw new StalePlan();
  };
  for (const one of plan.transfers) {
    await write(one.id, {
      ...NO_CATEGORY,
      type: "transfer",
      transferAccountId: one.transferAccountId,
      transferOutside: false,
      locallyEdited: withMarkers(byId.get(one.id)!.locallyEdited, "type"),
    });
  }
  for (const one of plan.groups) {
    await write(
      one.id,
      one.transferGroupId === null
        ? { transferGroupId: null }
        : {
            ...NO_CATEGORY,
            type: "transfer",
            transferGroupId: one.transferGroupId,
            transferAccountId: null,
            transferOutside: false,
          },
    );
  }
}

/**
 * Pairs the giroconti of a person by the rules of `planOwnTransfers` (IBAN, then amount and day),
 * makes a giroconto of a movement that names another account's IBAN, and keeps the proposals in
 * line: a new tie is proposed, a proposal whose legs are no longer free goes. Reads first, then one
 * short transaction. Run after every write that can make a giroconto: a reading, a choice of the
 * person, a saved IBAN. Returns how many rows changed. A choice of the person or a category that
 * lands between the read and the write wins: the run reads and plans again (3 times at most).
 * With `around` (the rows a request just changed) it reads only the rows the rules can join to
 * them, and only their proposals go stale: the same pairs, without reading every movement.
 */
export async function linkOwnTransfers(ctx: Who, around?: readonly string[]): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await linkOnce(ctx, around);
    } catch (error) {
      if (!(error instanceof StalePlan) || attempt === 3) throw error;
    }
  }
}

async function linkOnce(ctx: Who, around: readonly string[] | undefined): Promise<number> {
  const [own, rows, proposals] = await Promise.all([
    ownIbans(ctx),
    around === undefined ? pairingRows(ctx) : rowsAround(ctx, around),
    proposalRows(ctx),
  ]);
  const read = new Set(rows.map((row) => row.id));
  const keyOf = (one: { outId: string; inId: string }) => proposalKey(one.outId, one.inId);
  const rejected = new Set(proposals.filter((one) => one.state === "rejected").map(keyOf));
  const plan = planOwnTransfers(own, rows, rejected);
  const wanted = new Set(plan.proposals.map(keyOf));
  const open = proposals.filter((one) => one.state === "open");
  const stale = open
    .filter((one) => !wanted.has(keyOf(one)))
    .filter((one) => around === undefined || read.has(one.outId) || read.has(one.inId))
    .map((one) => one.id);
  const known = new Set(open.map(keyOf));
  const fresh = plan.proposals.filter((one) => !known.has(keyOf(one)));
  if (plan.groups.length + plan.transfers.length + stale.length + fresh.length === 0) return 0;

  await getDb().transaction(async (trx) => {
    await writePlan(trx, ctx, plan, new Map(rows.map((row) => [row.id, row])));
    if (stale.length > 0) {
      await trx
        .delete(girocontoProposals)
        .where(and(userScoped(ctx).owns(girocontoProposals), inArray(girocontoProposals.id, stale)));
    }
    if (fresh.length > 0) {
      await trx
        .insert(girocontoProposals)
        .values(fresh.map((one) => userScoped(ctx).stamp(one)))
        .onConflictDoNothing();
    }
    await retypeMovements(trx, ctx);
  });
  return plan.groups.length + plan.transfers.length;
}

/* What the person decides */

/** The other side of a giroconto, as the person chooses it. */
export const transferSideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), accountId: z.uuid() }),
  z.object({ kind: z.literal("outside") }),
  z.object({ kind: z.literal("none") }),
]);
export type TransferSide = z.infer<typeof transferSideSchema>;

/** Takes the row and its partner out of their pair; the partner stays a giroconto to choose for. Returns the legs. */
export async function unpair(trx: Tx, ctx: Who, groupId: string | null): Promise<string[]> {
  if (groupId === null) return [];
  const legs = await trx
    .select({ id: transactions.id, locallyEdited: transactions.locallyEdited })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.transferGroupId, groupId)));
  for (const leg of legs) {
    await trx
      .update(transactions)
      .set({
        transferGroupId: null,
        // The partner stays a giroconto, as the person last saw it: "Scegli il conto".
        locallyEdited: withMarkers(
          leg.locallyEdited.filter((field) => field !== PAIRED_BY_HAND),
          "type",
        ),
      })
      .where(and(eq(transactions.id, leg.id), userScoped(ctx).owns(transactions)));
  }
  return legs.map((leg) => leg.id);
}

/** The open proposals that name one of these rows: they are answered by what the person did. */
async function dropProposals(trx: Tx, ctx: Who, ids: readonly string[]): Promise<void> {
  await trx
    .delete(girocontoProposals)
    .where(
      and(
        userScoped(ctx).owns(girocontoProposals),
        eq(girocontoProposals.state, "open"),
        or(inArray(girocontoProposals.outId, [...ids]), inArray(girocontoProposals.inId, [...ids])),
      ),
    );
}

/**
 * The other side of a giroconto (decision 9A), chosen by the person: one of their accounts — the
 * leg waits for its twin there, and is paired the moment one is unique —, an account outside
 * Ledgerly, or "not a giroconto" (an income or a spending again, by its sign). A leg of a pair
 * leaves it first; its partner goes back to "Scegli il conto". Every choice is the person's: the
 * `type` marker keeps it from the rules and from the source's next reading.
 */
export async function chooseTransferSide(ctx: Who, id: string, input: unknown): Promise<void> {
  const transactionId = parseId(id);
  const side = transferSideSchema.parse(input);
  const row = await requireTransaction(ctx, transactionId);
  if (side.kind === "account") {
    const account = await getAccount(ctx, side.accountId);
    if (!account || account.id === row.accountId) throw new TransactionError("invalid_reference");
  }
  const touched = await getDb().transaction(async (trx) => {
    const legs = await unpair(trx, ctx, row.transferGroupId);
    const [current] = await trx
      .select({ locallyEdited: transactions.locallyEdited })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), userScoped(ctx).owns(transactions)));
    const locallyEdited = withMarkers(current!.locallyEdited, "type");
    const values =
      side.kind === "none"
        ? {
            type: row.amountCents < 0n ? ("expense" as const) : ("income" as const),
            transferOutside: false,
            transferAccountId: null,
            locallyEdited,
          }
        : {
            ...NO_CATEGORY,
            type: "transfer" as const,
            transferOutside: side.kind === "outside",
            transferAccountId: side.kind === "account" ? side.accountId : null,
            locallyEdited,
          };
    await trx
      .update(transactions)
      .set(values)
      .where(and(eq(transactions.id, transactionId), userScoped(ctx).owns(transactions)));
    await dropProposals(trx, ctx, [transactionId]);
    await retypeMovements(trx, ctx);
    return [transactionId, ...legs];
  });
  await linkOwnTransfers(ctx, touched);
}

/**
 * Two movements paired by hand (or a proposal confirmed): a giroconto whatever the rules say, of
 * any two of the person's accounts — the amounts may differ, as in two currencies. Each leaves a
 * pair it was in. The pair carries {@link PAIRED_BY_HAND}, and no rule takes it apart.
 */
export async function pairByHand(ctx: Who, firstId: string, secondId: string): Promise<void> {
  const [firstLeg, secondLeg] = [parseId(firstId), parseId(secondId)];
  if (firstLeg === secondLeg) throw new TransactionError("invalid");
  const first = await requireTransaction(ctx, firstLeg);
  const second = await requireTransaction(ctx, secondLeg);
  if (first.accountId === second.accountId) throw new TransactionError("invalid");
  if (first.amountCents < 0n === second.amountCents < 0n) throw new TransactionError("invalid");
  if (first.transferGroupId !== null && first.transferGroupId === second.transferGroupId) return;
  const touched = await getDb().transaction(async (trx) => {
    const legs = [
      ...(await unpair(trx, ctx, first.transferGroupId)),
      ...(await unpair(trx, ctx, second.transferGroupId)),
    ];
    const group = firstLeg < secondLeg ? firstLeg : secondLeg;
    for (const id of [firstLeg, secondLeg]) {
      const [current] = await trx
        .select({ locallyEdited: transactions.locallyEdited })
        .from(transactions)
        .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
      await trx
        .update(transactions)
        .set({
          ...NO_CATEGORY,
          type: "transfer",
          transferGroupId: group,
          transferOutside: false,
          transferAccountId: null,
          locallyEdited: withMarkers(current!.locallyEdited, "type", PAIRED_BY_HAND),
        })
        .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
    }
    await dropProposals(trx, ctx, [firstLeg, secondLeg]);
    await retypeMovements(trx, ctx);
    return [firstLeg, secondLeg, ...legs];
  });
  await linkOwnTransfers(ctx, touched);
}

/** One leg of a proposed giroconto, as the person is shown it. */
interface ProposalLeg {
  id: string;
  accountId: string;
  on: CivilDate;
  amountCents: Cents;
  currency: string;
  payee: string | null;
}

export interface TransferProposal {
  id: string;
  out: ProposalLeg;
  in: ProposalLeg;
}

/** The proposals that wait for the person (rule 3, a tie): the oldest money out first. */
export async function listTransferProposals(
  ctx: Pick<Ctx, "userId" | "timeZone">,
): Promise<TransferProposal[]> {
  const proposals = await getDb()
    .select({ id: girocontoProposals.id, outId: girocontoProposals.outId, inId: girocontoProposals.inId })
    .from(girocontoProposals)
    .where(and(userScoped(ctx).owns(girocontoProposals), eq(girocontoProposals.state, "open")))
    .orderBy(girocontoProposals.id);
  if (proposals.length === 0) return [];
  const ids = [...new Set(proposals.flatMap((one) => [one.outId, one.inId]))];
  const legs = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      payee: transactions.payee,
    })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), inArray(transactions.id, ids)))
    .orderBy(transactions.id);
  const leg = new Map(
    legs.map((row) => [
      row.id,
      {
        id: row.id,
        accountId: row.accountId,
        on: civilDateIn(row.occurredAt, ctx.timeZone),
        amountCents: row.amountCents,
        currency: row.currency,
        payee: row.payee,
      },
    ]),
  );
  return proposals
    .flatMap((one) => {
      const out = leg.get(one.outId);
      const into = leg.get(one.inId);
      return out && into ? [{ id: one.id, out, in: into }] : [];
    })
    .sort((x, y) => (x.out.on < y.out.on ? -1 : x.out.on > y.out.on ? 1 : x.id < y.id ? -1 : 1));
}

/**
 * The person's answer to a proposal: "yes" pairs the two by hand and the other proposals of the
 * same legs go; "no" is kept, so the same pair is never proposed again, and the pairing runs again.
 */
export async function answerTransferProposal(ctx: Who, id: string, accept: boolean): Promise<void> {
  const proposalId = parseId(id);
  const [proposal] = await getDb()
    .select({ outId: girocontoProposals.outId, inId: girocontoProposals.inId })
    .from(girocontoProposals)
    .where(
      and(
        userScoped(ctx).owns(girocontoProposals),
        eq(girocontoProposals.id, proposalId),
        eq(girocontoProposals.state, "open"),
      ),
    );
  if (!proposal) throw new TransactionError("not_found");
  if (accept) {
    await pairByHand(ctx, proposal.outId, proposal.inId);
    return;
  }
  await getDb()
    .update(girocontoProposals)
    .set({ state: "rejected" })
    .where(and(userScoped(ctx).owns(girocontoProposals), eq(girocontoProposals.id, proposalId)));
  // Without the pair refused, a leg may have one candidate left: it is paired now.
  await linkOwnTransfers(ctx, [proposal.outId, proposal.inId]);
}

// modules/transactions/service/legs.ts — the account's side of an Investments deposit, withdrawal
// or contribution (PERS-651, docs/design/investments-cash-movements.md): a giroconto of origin
// `investments` on the investment account, out of the balance (the value is the service's). The
// module that owns the operation hands the legs an account should have; this writes them in its
// transaction, then pairs them with the bank's movement by the rules of the giroconti.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { WantedLeg, WrittenLegs } from "../../../shared/cash-legs";
import { manualOccurredAt } from "../manual-rules";
import { girocontoProposals, transactions } from "../schema";
import { chooseTransferSide, linkOwnTransfers, PAIRED_BY_HAND, pairByHand, unpair } from "./giroconti";
import { TransactionError } from "./guards";

type Who = Pick<Ctx, "userId" | "timeZone">;
type Account = { id: string; currency: string };

/** The legs Investments wrote on the account, and the wanted ones wherever they are now. */
function currentLegs(trx: Tx, ctx: Who, account: Account, known: readonly string[]) {
  return trx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      transferGroupId: transactions.transferGroupId,
      locallyEdited: transactions.locallyEdited,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.origin, "investments"),
        or(eq(transactions.accountId, account.id), inArray(transactions.id, [...known])),
      ),
    );
}

type LegRow = Awaited<ReturnType<typeof currentLegs>>[number];

const NO_MARKERS: readonly string[] = [];

async function insertLeg(trx: Tx, ctx: Who, account: Account, leg: WantedLeg): Promise<string> {
  const [inserted] = await trx
    .insert(transactions)
    .values(
      userScoped(ctx).stamp({
        accountId: account.id,
        occurredAt: manualOccurredAt(leg.on, ctx.timeZone),
        amountCents: leg.amountCents,
        currency: account.currency,
        type: "transfer" as const,
        origin: "investments" as const,
        note: leg.note,
      }),
    )
    .returning({ id: transactions.id });
  return inserted.id;
}

/**
 * A leg follows its operation's amount and day. A pair the new amount no longer fits comes apart
 * (its bank movement waits again) and the leg is the rules' again; same amount on another day, the
 * pair stays. Returns the rows to settle (none when nothing changed) and the markers it has now.
 */
async function followLeg(
  trx: Tx,
  ctx: Who,
  row: LegRow,
  leg: WantedLeg,
): Promise<{ touched: string[]; locallyEdited: readonly string[] }> {
  const occurredAt = manualOccurredAt(leg.on, ctx.timeZone);
  const moved = row.amountCents !== leg.amountCents;
  if (!moved && row.occurredAt.getTime() === occurredAt.getTime())
    return { touched: [], locallyEdited: row.locallyEdited };
  const unpaired = moved && row.transferGroupId !== null;
  const partners = unpaired ? await unpair(trx, ctx, row.transferGroupId) : [];
  const locallyEdited = unpaired
    ? row.locallyEdited.filter((field) => field !== "type" && field !== PAIRED_BY_HAND)
    : row.locallyEdited;
  await trx
    .update(transactions)
    .set({ occurredAt, amountCents: leg.amountCents, locallyEdited })
    .where(and(eq(transactions.id, row.id), userScoped(ctx).owns(transactions)));
  return { touched: [row.id, ...partners.filter((id) => id !== row.id)], locallyEdited };
}

/** Legs whose operation is gone go; their partners wait again. Returns the partners. */
async function dropLegs(trx: Tx, ctx: Who, rows: readonly LegRow[]): Promise<string[]> {
  const partners: string[] = [];
  for (const row of rows) {
    partners.push(...(await unpair(trx, ctx, row.transferGroupId)).filter((id) => id !== row.id));
    await trx
      .delete(transactions)
      .where(
        and(
          eq(transactions.id, row.id),
          eq(transactions.origin, "investments"),
          userScoped(ctx).owns(transactions),
        ),
      );
  }
  return partners;
}

/**
 * Writes the legs of one account inside the caller's transaction: a wanted leg with none is
 * created, one whose amount or day changed follows it ({@link followLeg}), and a leg nobody wants any
 * more — its operation is gone, or it is on another account (a fund that moved its value) — goes,
 * its partner waiting again. A leg the person retyped in Expenses keeps their choice.
 */
export async function writeLegs(
  trx: Tx,
  ctx: Who,
  account: Account,
  wanted: readonly WantedLeg[],
): Promise<WrittenLegs> {
  const current = await currentLegs(
    trx,
    ctx,
    account,
    wanted.flatMap((leg) => (leg.legId === null ? [] : [leg.legId])),
  );
  const here = new Map(current.filter((row) => row.accountId === account.id).map((row) => [row.id, row]));
  const written: WrittenLegs = { legIds: [], touched: [], choices: new Map() };
  for (const leg of wanted) {
    const row = leg.legId === null ? undefined : here.get(leg.legId);
    const placed = row
      ? { id: row.id, grouped: row.transferGroupId !== null, ...(await followLeg(trx, ctx, row, leg)) }
      : {
          id: await insertLeg(trx, ctx, account, leg),
          grouped: false,
          touched: null,
          locallyEdited: NO_MARKERS,
        };
    const touched = placed.touched ?? [placed.id];
    written.legIds.push(placed.id);
    written.touched.push(...touched);
    // The bank movement the operation names: for a leg that changed or is in no pair, unless the
    // person chose its side.
    const open = touched.length > 0 || !placed.grouped;
    if (leg.pairWith !== null && open && !placed.locallyEdited.includes("type"))
      written.choices.set(placed.id, { kind: "pair", transactionId: leg.pairWith });
  }
  const kept = new Set(written.legIds);
  const gone = current.filter((row) => !kept.has(row.id));
  written.touched.push(...(await dropLegs(trx, ctx, gone)));
  const goneIds = new Set(gone.map((row) => row.id));
  written.touched = [...new Set(written.touched)].filter((id) => !goneIds.has(id));
  return written;
}

/**
 * After the caller's transaction: each leg goes with what the person chose, or with the bank
 * movement its operation names; the others are paired by the rules of the giroconti (one candidate
 * pairs, several are a proposal), and a leg nothing matches is a giroconto from an account outside
 * (decision 1) — free to pair with the bank's movement when it arrives.
 */
export async function settleLegs(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  written: Pick<WrittenLegs, "touched" | "choices">,
): Promise<void> {
  for (const [id, choice] of written.choices) {
    if (choice.kind === "pair") {
      // A movement that cannot be the other leg (same sign, same account) leaves the leg to the rules.
      await pairByHand(ctx, id, choice.transactionId).catch((error: unknown) => {
        if (!(error instanceof TransactionError)) throw error;
      });
    } else if (choice.kind !== "auto") {
      await chooseTransferSide(ctx, id, choice);
    }
  }
  if (written.touched.length === 0) return;
  await linkOwnTransfers(ctx, written.touched);
  const open = getDb()
    .select({ one: sql`1` })
    .from(girocontoProposals)
    .where(
      and(
        eq(girocontoProposals.state, "open"),
        or(eq(girocontoProposals.outId, transactions.id), eq(girocontoProposals.inId, transactions.id)),
      ),
    );
  await getDb()
    .update(transactions)
    .set({ transferOutside: true })
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.id, written.touched),
        eq(transactions.origin, "investments"),
        eq(transactions.type, "transfer"),
        eq(transactions.transferOutside, false),
        isNull(transactions.transferGroupId),
        isNull(transactions.transferAccountId),
        sql`not ('type' = any(${transactions.locallyEdited}))`,
        sql`not exists (${open})`,
      ),
    );
}

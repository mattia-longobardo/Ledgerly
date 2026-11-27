// modules/transactions/service/twins.ts — the other leg of a giroconto with a manual account
// (PERS-733). An account no source reads never brings its leg, so the server writes it there: the
// opposite amount, in the account's currency, at the same moment, paired at once. The written leg
// follows the leg it was written for — its amount and day, and goes when that leg goes or stops
// being a giroconto with that account — until the person changes it by hand: then it is theirs.
// A leg the source stops returning keeps its twin: the mark is undone when the source sends it
// again, and the deletion for good takes the twin with it (`twin_of` cascades).
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getAccount, rebuildDerivedBalances } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { convertCents, ratesOn } from "../../../platform/fx";
import { civilDateIn } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { girocontoProposals, transactions } from "../schema";
import { PAIRED_BY_HAND, withMarkers } from "./pairing-marks";

type WhoWhere = Pick<Ctx, "userId" | "timeZone">;

const LEG = {
  id: transactions.id,
  occurredAt: transactions.occurredAt,
  amountCents: transactions.amountCents,
  currency: transactions.currency,
  type: transactions.type,
  transferGroupId: transactions.transferGroupId,
  transferAccountId: transactions.transferAccountId,
  twinOf: transactions.twinOf,
  hiddenAt: transactions.hiddenAt,
  removedUpstreamAt: transactions.removedUpstreamAt,
  locallyEdited: transactions.locallyEdited,
};
type Leg = Awaited<ReturnType<typeof legsOf>>[number];

function legsOf(ctx: WhoWhere, ids: readonly string[]) {
  return getDb()
    .select(LEG)
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), inArray(transactions.id, [...ids])));
}

/** The opposite of the leg in `currency`, at the rate of the leg's day; `null` without a rate. */
async function oppositeIn(ctx: WhoWhere, leg: Leg, currency: string): Promise<Cents | null> {
  const day = civilDateIn(leg.occurredAt, ctx.timeZone);
  const rates = await ratesOn([leg.currency, currency], day, day);
  return convertCents(-leg.amountCents, leg.currency, currency, day, rates);
}

/** The leg joins its written twin: the pair is the twin's id, so the leg is free again when it goes. */
async function pairWithTwin(trx: Tx, ctx: WhoWhere, leg: Leg, twinId: string): Promise<void> {
  await trx
    .update(transactions)
    .set({
      transferGroupId: twinId,
      transferAccountId: null,
      transferOutside: false,
      locallyEdited: withMarkers(leg.locallyEdited, "type", PAIRED_BY_HAND),
    })
    .where(
      and(eq(transactions.id, leg.id), userScoped(ctx).owns(transactions), eq(transactions.type, "transfer")),
    );
}

/** The balances of the manual accounts whose written legs changed. */
export async function rebuildTwinBalances(ctx: WhoWhere, accountIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(accountIds)];
  if (ids.length > 0) await rebuildDerivedBalances(ctx, ids, { manualChanged: true });
}

/** The leg changed between the read and the write: nothing is written. */
class LegChanged extends Error {}

/** The leg can have a twin written: a giroconto that waits for its leg on one account, alone. */
const waitsForTwin = (leg: Leg | undefined): leg is Leg & { transferAccountId: string } =>
  leg !== undefined &&
  leg.type === "transfer" &&
  leg.transferGroupId === null &&
  leg.transferAccountId !== null &&
  leg.twinOf === null &&
  leg.hiddenAt === null &&
  leg.removedUpstreamAt === null;

async function hasOpenProposal(ctx: WhoWhere, id: string): Promise<boolean> {
  const [open] = await getDb()
    .select({ id: girocontoProposals.id })
    .from(girocontoProposals)
    .where(
      and(
        userScoped(ctx).owns(girocontoProposals),
        eq(girocontoProposals.state, "open"),
        or(eq(girocontoProposals.outId, id), eq(girocontoProposals.inId, id)),
      ),
    )
    .limit(1);
  return open !== undefined;
}

/**
 * Writes the other leg of the giroconto `id` on its account, when that account is a manual one and
 * the leg still waits after the pairing ran: a leg the rules paired, or one with a tie for the person
 * to answer, has its other leg already. Without the rate of the day for two currencies the leg keeps
 * waiting. Written once: a second call, or two at the same time, write nothing more.
 */
export async function writeTwin(ctx: WhoWhere, id: string): Promise<void> {
  const [leg] = await legsOf(ctx, [id]);
  if (!waitsForTwin(leg)) return;
  const account = await getAccount(ctx, leg.transferAccountId);
  if (!account || account.origin !== "manual" || (await hasOpenProposal(ctx, leg.id))) return;
  const amountCents = await oppositeIn(ctx, leg, account.currency);
  if (amountCents === null) return;
  const written = await getDb()
    .transaction(async (trx) => {
      const [twin] = await trx
        .insert(transactions)
        .values(
          userScoped(ctx).stamp({
            accountId: account.id,
            occurredAt: leg.occurredAt,
            amountCents,
            currency: account.currency,
            type: "transfer" as const,
            origin: "manual" as const,
            twinOf: leg.id,
            locallyEdited: withMarkers([], "type", PAIRED_BY_HAND),
          }),
        )
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      if (!twin) return false;
      await trx.update(transactions).set({ transferGroupId: twin.id }).where(eq(transactions.id, twin.id));
      const paired = await trx
        .update(transactions)
        .set({
          transferGroupId: twin.id,
          transferAccountId: null,
          locallyEdited: withMarkers(leg.locallyEdited, "type", PAIRED_BY_HAND),
        })
        .where(
          and(
            eq(transactions.id, leg.id),
            userScoped(ctx).owns(transactions),
            isNull(transactions.transferGroupId),
            eq(transactions.transferAccountId, account.id),
          ),
        )
        .returning({ id: transactions.id });
      if (paired.length === 0) throw new LegChanged();
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof LegChanged) return false;
      throw error;
    });
  if (written) await rebuildTwinBalances(ctx, [account.id]);
}

/**
 * The twin still belongs to its leg: a giroconto with the twin's account, there or paired to it. The
 * pair is the twin's id: while the source leaves the leg out, the rules see the twin alone and free
 * it, and the pair is made again when the leg is back.
 */
const follows = (leg: Leg, twin: { id: string; accountId: string; transferGroupId: string | null }) =>
  leg.type === "transfer" &&
  (leg.transferAccountId === twin.accountId ||
    leg.transferGroupId === twin.id ||
    (leg.transferGroupId !== null && leg.transferGroupId === twin.transferGroupId));

/**
 * Keeps the written legs of `ids` (of every leg, without) in line with them: the amount and the
 * moment follow, the pair is made again after the leg left it to the same account, and the twin goes
 * when its leg went to another account or to none. A twin the person changed is no longer
 * one (`twinOf` is cleared by every change by hand) and is never touched here.
 */
export async function refreshTwins(ctx: WhoWhere, ids?: readonly string[]): Promise<void> {
  if (ids !== undefined && ids.length === 0) return;
  const twins = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      transferGroupId: transactions.transferGroupId,
      twinOf: transactions.twinOf,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        ids === undefined ? isNotNull(transactions.twinOf) : inArray(transactions.twinOf, [...ids]),
      ),
    );
  if (twins.length === 0) return;
  const legs = new Map(
    (
      await legsOf(
        ctx,
        twins.map((twin) => twin.twinOf!),
      )
    ).map((leg) => [leg.id, leg]),
  );
  const changed: string[] = [];
  for (const twin of twins) {
    const leg = legs.get(twin.twinOf!)!;
    const untouched = and(eq(transactions.id, twin.id), eq(transactions.twinOf, leg.id));
    if (!follows(leg, twin)) {
      await getDb()
        .delete(transactions)
        .where(and(untouched, userScoped(ctx).owns(transactions)));
      changed.push(twin.accountId);
      continue;
    }
    // Without the rate of the new day the twin keeps the amount it has.
    const amountCents = (await oppositeIn(ctx, leg, twin.currency)) ?? twin.amountCents;
    const repair = leg.transferGroupId !== twin.id || twin.transferGroupId !== twin.id;
    const moved = amountCents !== twin.amountCents || leg.occurredAt.getTime() !== twin.occurredAt.getTime();
    if (!repair && !moved) continue;
    await getDb().transaction(async (trx) => {
      const [kept] = await trx
        .update(transactions)
        .set({ amountCents, occurredAt: leg.occurredAt, transferGroupId: twin.id })
        .where(and(untouched, userScoped(ctx).owns(transactions)))
        .returning({ id: transactions.id });
      if (kept && repair) await pairWithTwin(trx, ctx, leg, twin.id);
    });
    changed.push(twin.accountId);
  }
  await rebuildTwinBalances(ctx, changed);
}

/** The accounts of the written legs of `ids`: the caller rebuilds them after `ids` go. */
export async function twinAccountsOf(ctx: Pick<Ctx, "userId">, ids: readonly string[]): Promise<string[]> {
  const rows = await getDb()
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), inArray(transactions.twinOf, [...ids])));
  return rows.map((row) => row.accountId);
}

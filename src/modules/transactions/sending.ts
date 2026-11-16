// modules/transactions/sending.ts — the manual movements of a "read and write" account on their way
// to the source (rewrite plan N3.1, 04-now.md §4.5): which ones wait, and what becomes of one when
// the source has taken it or refused it. Nothing here reaches the network: the pass of the source
// makes the call and tells this file the answer.
//
// A movement the source has taken is the source's own from then on: it gets the source's id in
// `provider_links`, which is how the reading that follows finds the same row instead of writing a
// second one.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { type CivilDate, civilDateIn } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { linkExternal } from "@/platform/integrations/service";
import type { Cents } from "@/platform/money";
import type { SendState } from "./rules";
import { transactions } from "./schema";

type Who = Pick<Ctx, "userId">;

/** A manual movement that waits for its source. */
export interface PendingSend {
  id: string;
  accountId: string;
  /** The key the source is asked with: the same key asked twice is one movement there. */
  key: string;
  state: SendState;
  on: CivilDate;
  /** The day the source was last asked to create it on, when it was asked: where to look for it. */
  askedOn: CivilDate | null;
  amountCents: Cents;
  payee: string | null;
  note: string | null;
  categoryId: string | null;
}

/** How many movements one update sends: the rest go with the next one. */
export const MAX_SENDS_PER_PASS = 20;

/** The key of a movement on its way: the one its dialog made, or the row's own id. */
function keyOf(row: { id: string; idempotencyKey: string | null }): string {
  return row.idempotencyKey ?? row.id;
}

/**
 * The movements of these accounts that wait for the source, the oldest first. A hidden one does
 * not go: it is out of the balance and of the totals, and goes when the person brings it back.
 */
export async function pendingSends(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
  limit: number = MAX_SENDS_PER_PASS,
): Promise<PendingSend[]> {
  if (accountIds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        isNotNull(transactions.sendState),
        eq(transactions.origin, "manual"),
        isNull(transactions.hiddenAt),
      ),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    key: keyOf(row),
    state: row.sendState as SendState,
    on: civilDateIn(row.occurredAt, ctx.timeZone),
    askedOn: row.sendAskedOn as CivilDate | null,
    amountCents: row.amountCents,
    payee: row.payee,
    note: row.note,
    categoryId: row.categoryId,
  }));
}

/**
 * Marks a movement as one the source did not take, or may have taken without saying so: the next
 * update looks for it there before it asks again. Written **before** the source is asked, so a
 * request whose answer is lost is never asked a second time blind. `askedOn` is the day the
 * request names: it is where the record is, if the request arrived.
 */
export async function markNotSent(ctx: Who, id: string, askedOn?: CivilDate): Promise<void> {
  await getDb()
    .update(transactions)
    .set({ sendState: "not_sent", ...(askedOn === undefined ? {} : { sendAskedOn: askedOn }) })
    .where(
      and(
        eq(transactions.id, id),
        userScoped(ctx).owns(transactions),
        eq(transactions.origin, "manual"),
        isNotNull(transactions.sendState),
      ),
    );
}

export interface SentAs {
  provider: string;
  /** The source's own id of the movement it made. */
  externalId: string;
  /** The row of the source's category it was sent with; `null` when it went with none. */
  sourceCategoryId: string | null;
  /** The source was given the payee: `false` keeps the one written here. */
  payeeSent: boolean;
}

/**
 * The source has taken the movement: from here on it is the source's (no state, the source's id),
 * in one transaction. A category the source has none for stays the person's choice, and a payee
 * the source was not given stays the one written here: the reading that follows leaves both.
 * `false` when the movement is no longer waiting — changed or deleted while the source was asked.
 */
export async function settleSent(
  ctx: Who,
  id: string,
  sent: SentAs,
  now: Date = new Date(),
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          userScoped(ctx).owns(transactions),
          eq(transactions.origin, "manual"),
          isNotNull(transactions.sendState),
        ),
      )
      .for("update");
    if (!row) return false;
    const keepsCategory = sent.sourceCategoryId === null && row.categoryId !== null;
    await tx
      .update(transactions)
      .set({
        origin: "provider",
        sendState: null,
        sendAskedOn: null,
        sourceCategoryId: sent.sourceCategoryId,
        categoryOrigin: row.categoryId === null ? null : keepsCategory ? "user" : "provider",
        locallyEdited: [...(keepsCategory ? ["categoryId"] : []), ...(sent.payeeSent ? [] : ["payee"])],
      })
      .where(and(eq(transactions.id, row.id), userScoped(ctx).owns(transactions)));
    await linkExternal(
      ctx,
      { provider: sent.provider, entityType: "transaction", entityId: row.id, externalId: sent.externalId },
      now,
      tx,
    );
    return true;
  });
}

/**
 * The movement waiting for the source that was sent with `key`, on one of these accounts: what a
 * reading asks when the source gives back a movement that carries the key of one written here.
 */
export async function pendingSendByKey(
  ctx: Who,
  accountId: string,
  key: string,
): Promise<{ id: string } | null> {
  const [row] = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, accountId),
        eq(transactions.origin, "manual"),
        isNotNull(transactions.sendState),
        or(eq(transactions.idempotencyKey, key), isUuid(key) ? eq(transactions.id, key) : undefined),
      ),
    )
    .orderBy(asc(transactions.id))
    .limit(1);
  return row ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

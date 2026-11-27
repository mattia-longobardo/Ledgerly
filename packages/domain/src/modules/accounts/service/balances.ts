import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, isCivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type Cents } from "../../../shared/money";
import { managedAccounts } from "../ports";
import { type BalanceEntryInput, balanceEntrySchema, type BeforeOpening, isFutureDate } from "../rules";
import { type BalanceEntry } from "../queries";
import { accounts, balanceEntries } from "../schema";
import { openedNoLaterThan, rebuildDerivedBalances } from "./derived-balances";
import { AccountError, refuseManaged, requireAccount, writeBalanceEntry } from "./guards";

/**
 * A manual balance for a date. On a synced account it is a correction that wins for that date, so
 * it is stored as its own `manual` row beside the provider's rather than overwriting it.
 */
export async function saveBalanceEntry(ctx: Ctx, accountId: string, input: unknown): Promise<BalanceEntry> {
  await requireAccount(ctx, accountId);
  const parsed: BalanceEntryInput = balanceEntrySchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new AccountError("future_date");
  await refuseManaged(ctx, accountId, parsed.on);
  const values = {
    balanceCents: parsed.cents,
    availableCents: parsed.availableCents,
    note: parsed.note,
    capturedAt: new Date(),
  };
  const row = await writeBalanceEntry(getDb(), ctx, { accountId, on: parsed.on, source: "manual" }, values);
  // A correction on a synced account moves the month ends rebuilt before it (F2.5).
  await rebuildDerivedBalances(ctx, [accountId]);
  return row;
}

/**
 * A manual balance corrected in place: its date, its amount, what was available and its note.
 *
 * Only `manual` rows are a person's to edit — a provider's reading, a snapshot and a rebuilt month
 * end are records of what happened, not entries — so anything else is `not_found`, as is another
 * user's row.
 *
 * Moving it to another date is why this is one call and not a delete plus a
 * {@link saveBalanceEntry}: the unique key is `(account, on, source)`, so a manual balance already
 * standing on the new date would collide. In one transaction that one goes and the edited row takes
 * its place, so the day ends with one manual balance and never two, and no moment exists in which
 * the balance is on neither date. `rebuildDerivedBalances` follows as in {@link saveBalanceEntry}:
 * which month ends get rebuilt depends on the manual corrections, and here two dates moved.
 * A balance moved earlier moves the account's opening day back with it (`openedNoLaterThan`), and
 * `beforeOpening` says the manual movements left before the first reading (PERS-678). With
 * `replace: false` a manual balance already on the new date is `balance_exists` and stays: «Move
 * the opening» never deletes a balance written since its banner was read (PERS-725).
 *
 * The same day and amount keep the moment of the reading: a note is no new count of the balance,
 * so it takes nothing more of the movements of its day (decision 12, PERS-725).
 */
export async function updateBalanceEntry(
  ctx: Ctx,
  id: string,
  input: unknown,
  {
    accountId,
    replace = true,
  }: {
    /** When given, an entry of another account is `not_found`, as the route of the account says. */
    accountId?: string;
    replace?: boolean;
  } = {},
): Promise<BalanceEntry & { beforeOpening: BeforeOpening | null }> {
  const parsed: BalanceEntryInput = balanceEntrySchema.parse(input);
  const [current] = await getDb()
    .select()
    .from(balanceEntries)
    .where(
      and(
        eq(balanceEntries.id, id),
        eq(balanceEntries.source, "manual"),
        accountId === undefined ? undefined : eq(balanceEntries.accountId, accountId),
        userScoped(ctx).owns(balanceEntries),
      ),
    );
  if (!current) throw new AccountError("not_found");
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new AccountError("future_date");
  await refuseManaged(ctx, current.accountId, current.on < parsed.on ? current.on : parsed.on);
  const values = {
    on: parsed.on,
    balanceCents: parsed.cents,
    availableCents: parsed.availableCents,
    note: parsed.note,
    capturedAt:
      parsed.on === current.on && parsed.cents === current.balanceCents ? current.capturedAt : new Date(),
  };
  const row = await getDb().transaction(async (trx) => {
    if (parsed.on !== current.on) {
      const onTarget = and(
        userScoped(ctx).owns(balanceEntries),
        eq(balanceEntries.accountId, current.accountId),
        eq(balanceEntries.on, parsed.on),
        eq(balanceEntries.source, "manual"),
      );
      const [taken] = replace
        ? []
        : await trx.select({ id: balanceEntries.id }).from(balanceEntries).where(onTarget);
      if (taken) throw new AccountError("balance_exists");
      await trx.delete(balanceEntries).where(onTarget);
    }
    const [updated] = await trx
      .update(balanceEntries)
      .set(values)
      .where(and(eq(balanceEntries.id, id), userScoped(ctx).owns(balanceEntries)))
      .returning();
    if (parsed.on < current.on) await openedNoLaterThan(ctx, current.accountId, parsed.on, trx);
    return updated;
  });
  const { beforeOpening } = await rebuildDerivedBalances(ctx, [current.accountId]);
  return { ...row, beforeOpening: beforeOpening.get(current.accountId) ?? null };
}

/** A provider's reading of a balance, as a provider's sync hands it over (spec §9.1). */
export interface ProviderBalanceInput {
  /** The civil date of the reading **in the user's zone** (spec §9.1): the caller's to compute. */
  on: CivilDate;
  cents: Cents;
  availableCents?: Cents | null;
}

/**
 * A balance a provider published, stored as its own `provider` row (spec §9.1).
 *
 * Deliberately separate from {@link saveBalanceEntry}, which writes `manual` and only ever that:
 * the unique key is `(account, on, source)`, so the two never collide, and a manual balance stays
 * the correction that wins for its date (spec §7.1, `SOURCE_RANK`). Idempotent on that key — the
 * same reading applied twice updates one row instead of adding a second — and no future-date check
 * is needed, because "the date of the reading" cannot be in the future.
 *
 * It also moves `accounts.last_synced_at`: §7.1 measures staleness from the last *reading*, and a
 * provider balance written is exactly the evidence that one happened. `applyProviderAccounts`
 * stamps it only on the accounts its reconciliation had a step for, so an account that came back
 * unchanged would otherwise go stale while being read every hour. Same transaction as the balance,
 * so the two facts cannot disagree.
 *
 * An account Investments manages (a provider's account handed over to a service, §1.3, A4) takes no
 * provider balance from `managed_since` on: its value there is the `portfolio` source alone. The
 * reading still happened, so `last_synced_at` moves and the account does not go stale; `null` says
 * no balance was written.
 */
export async function saveProviderBalance(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: ProviderBalanceInput,
  now: Date = new Date(),
): Promise<BalanceEntry | null> {
  await requireAccount(ctx, accountId);
  if (!isCivilDate(input.on)) throw new RangeError(`Not a civil date: "${input.on}"`);
  const since = await managedAccounts().managedSinceOf(ctx, accountId);
  if (since !== null && input.on >= since) {
    await getDb()
      .update(accounts)
      .set({ lastSyncedAt: now })
      .where(and(eq(accounts.id, accountId), userScoped(ctx).owns(accounts)));
    return null;
  }
  const values = {
    balanceCents: input.cents,
    availableCents: input.availableCents ?? null,
    capturedAt: now,
  };
  return getDb().transaction(async (trx) => {
    const row = await writeBalanceEntry(trx, ctx, { accountId, on: input.on, source: "provider" }, values);
    await trx
      .update(accounts)
      .set({ lastSyncedAt: now })
      .where(and(eq(accounts.id, accountId), userScoped(ctx).owns(accounts)));
    return row;
  });
}

/**
 * A balance read from an imported document (spec §6 `import`; F6: a pension statement), inside the
 * caller's transaction. Its own source, so a person's `manual` correction for the same day still
 * wins; the same day imported again updates the one row.
 */
export async function saveImportBalance(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: { on: CivilDate; cents: Cents; note: string | null },
  trx: Tx,
): Promise<BalanceEntry> {
  if (!isCivilDate(input.on)) throw new RangeError(`Not a civil date: "${input.on}"`);
  await requireAccount(ctx, accountId, trx);
  const values = { balanceCents: input.cents, note: input.note, capturedAt: new Date() };
  return writeBalanceEntry(trx, ctx, { accountId, on: input.on, source: "import" }, values);
}

export async function deleteBalanceEntry(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  /** When given, an entry of another account stays: nothing is deleted. */
  accountId?: string,
): Promise<void> {
  const [entry] = await getDb()
    .select({ accountId: balanceEntries.accountId, on: balanceEntries.on })
    .from(balanceEntries)
    .where(and(eq(balanceEntries.id, id), userScoped(ctx).owns(balanceEntries)));
  if (!entry || (accountId !== undefined && entry.accountId !== accountId)) return;
  await refuseManaged(ctx, entry.accountId, entry.on);
  const [row] = await getDb()
    .delete(balanceEntries)
    .where(
      and(
        eq(balanceEntries.id, id),
        eq(balanceEntries.source, "manual"),
        userScoped(ctx).owns(balanceEntries),
      ),
    )
    .returning({ accountId: balanceEntries.accountId });
  if (row) await rebuildDerivedBalances(ctx, [row.accountId]);
}

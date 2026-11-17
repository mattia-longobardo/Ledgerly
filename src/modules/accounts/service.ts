import "server-only";
import { z } from "zod";
import { and, asc, eq, gt, gte, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import {
  type CivilDate,
  addDays,
  addMonths,
  isCivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  today,
} from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { FOREIGN_KEY_VIOLATION, hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { convertCents } from "@/platform/fx/rules";
import { ratesOn } from "@/platform/fx/service";
import { syncsTransactions } from "@/platform/integrations/rules";
import { unlinkEntitiesOfEveryProvider } from "@/platform/integrations/service";
import { normalizeIban } from "@/platform/iban";
import { type Cents, sumCents } from "@/platform/money";
import { managedSinceOf, serviceAccountIds } from "@/modules/investments/managed";
import {
  dailyNetByAccount,
  manualMovementsByAccount,
  transactionIdsOfAccount,
} from "@/modules/transactions/queries";
import {
  type AccountCreateInput,
  accountCreateSchema,
  type AccountSettingsInput,
  type AccountType,
  accountSettingsSchema,
  type BalanceEntryInput,
  balanceEntrySchema,
  CONNECTION_CHANNELS,
  dailySeries,
  hasIbanField,
  ibanConflict,
  DEFAULT_STALE_AFTER_HOURS,
  deriveMonthEnds,
  isFutureDate,
  isStale,
  movementBalances,
  type RemoteAccount,
  reconcileProviderAccounts,
  settingsForSynced,
  withMovementPoints,
} from "./rules";
import {
  type Account,
  accountsToRebuild,
  type BalanceEntry,
  balancesOn,
  listAccounts,
  movementBasis,
  observedDays,
} from "./queries";
import {
  accountConnections,
  accounts,
  accountSwitches,
  balanceEntries,
  manualMovementAccounts,
  snapshotRuns,
} from "./schema";
import { switchedAwayFrom } from "./switching";

/** Every service failure a caller is expected to handle carries one of these codes. */
export type AccountErrorCode =
  | "not_found"
  | "future_date"
  | "synced_locked"
  | "currency_locked"
  | "managed_locked"
  | "duplicate_name"
  | "duplicate_connection"
  | "iban_invalid"
  | "iban_exists"
  | "iban_archived"
  /** Something of another module still rests on the account: move it first (`removeAccount`). */
  | "in_use"
  | "invalid";

export class AccountError extends Error {
  /** `iban_exists` and `iban_archived`: the name of the account that has the IBAN. Never the IBAN. */
  constructor(
    readonly code: AccountErrorCode,
    readonly other: string | null = null,
  ) {
    super(code);
    this.name = "AccountError";
  }
}

/**
 * One writer of IBANs at a time for a person (04-now.md §4.6.1, point 2): the check "one IBAN, one
 * account" and the write that follows it run inside the same transaction, after this lock.
 */
async function lockIbans(tx: Tx, ctx: Pick<Ctx, "userId">): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`accounts-iban:${ctx.userId}`}))`);
}

/** The person's accounts as the rule "one IBAN, one account" reads them, inside the lock. */
async function ibanHolders(tx: Tx, ctx: Pick<Ctx, "userId">) {
  return tx
    .select({ id: accounts.id, name: accounts.name, iban: accounts.iban, state: accounts.state })
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), sql`${accounts.iban} is not null`))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
}

/**
 * The IBAN a person writes on an account (§2.4.1 of the N4 specification): `null` for a type
 * without the field (H47) or an empty field; the value the source gave when the account has one
 * (read-only); otherwise the typed value, checked, and refused when another account has it.
 */
async function personIban(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  typed: string | null,
  type: AccountType,
  current: { id: string; iban: string | null; ibanFromSource: boolean } | null,
): Promise<{ iban: string | null; ibanFromSource: boolean }> {
  if (!hasIbanField(type)) return { iban: null, ibanFromSource: false };
  if (current?.ibanFromSource && current.iban !== null) return { iban: current.iban, ibanFromSource: true };
  if (typed === null) return { iban: null, ibanFromSource: false };
  const iban = normalizeIban(typed);
  if (iban === null) throw new AccountError("iban_invalid");
  await lockIbans(tx, ctx);
  const conflict = ibanConflict(iban, await ibanHolders(tx, ctx), current?.id ?? null);
  if (conflict !== null) {
    throw new AccountError(conflict.kind === "exists" ? "iban_exists" : "iban_archived", conflict.name);
  }
  return { iban, ibanFromSource: false };
}

async function hasBalanceEntries(ctx: Pick<Ctx, "userId">, accountId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: balanceEntries.id })
    .from(balanceEntries)
    .where(and(eq(balanceEntries.accountId, accountId), userScoped(ctx).owns(balanceEntries)))
    .limit(1);
  return row !== undefined;
}

async function requireAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<Account> {
  const [row] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  if (!row) throw new AccountError("not_found");
  return row;
}

/**
 * An account Investments manages takes no manual balance from `managed_since` on (§1.3, A4): its
 * value there is the `portfolio` source alone, and the service page is where it changes.
 */
async function refuseManaged(ctx: Pick<Ctx, "userId">, accountId: string, on: CivilDate): Promise<void> {
  const since = await managedSinceOf(ctx, accountId);
  if (since !== null && on >= since) throw new AccountError("managed_locked");
}

async function nextSortOrder(ctx: Pick<Ctx, "userId">): Promise<number> {
  const [row] = await getDb()
    .select({ highest: max(accounts.sortOrder) })
    .from(accounts)
    .where(userScoped(ctx).owns(accounts));
  return (row?.highest ?? -1) + 1;
}

/**
 * A manual account, with its optional opening balance written in the same transaction so an
 * account never exists for a moment with a balance the caller believes it already has.
 */
export async function createAccount(ctx: Ctx, input: unknown, outer?: Tx): Promise<Account> {
  const parsed: AccountCreateInput = accountCreateSchema.parse(input);
  if (parsed.openingBalance && isFutureDate(parsed.openingBalance.on, today(ctx.timeZone))) {
    throw new AccountError("future_date");
  }
  const sortOrder = await nextSortOrder(ctx);
  const run = <T>(work: (tx: Tx) => Promise<T>): Promise<T> =>
    outer ? work(outer) : getDb().transaction(work);
  return run(async (tx) => {
    const iban = await personIban(tx, ctx, parsed.iban, parsed.type, null);
    const [account] = await tx
      .insert(accounts)
      .values(
        userScoped(ctx).stamp({
          name: parsed.name,
          type: parsed.type,
          currency: parsed.currency,
          groupId: parsed.groupId,
          color: parsed.color,
          reference: parsed.reference,
          ...iban,
          purpose: parsed.purpose,
          openedOn: parsed.openedOn,
          notes: parsed.notes,
          origin: "manual" as const,
          state: "active" as const,
          countsAsLiquid: parsed.type === "checking" || parsed.type === "cash" || parsed.type === "savings",
          staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
          sortOrder,
        }),
      )
      .returning();
    if (parsed.openingBalance) {
      await tx.insert(balanceEntries).values(
        userScoped(ctx).stamp({
          accountId: account.id,
          on: parsed.openingBalance.on,
          balanceCents: parsed.openingBalance.cents,
          source: "manual" as const,
        }),
      );
    }
    return account;
  });
}

/**
 * The Settings tab. A synced account keeps the provider's currency (spec §7.1); its type may be
 * changed here, and from then on the sync stops following the provider's (`retyped_locally`).
 *
 * An account with a balance keeps its currency (docs/design/investments.md §1.8): a new one would
 * reinterpret every amount already recorded, so the change is refused with `currency_locked`.
 */
export async function updateAccountSettings(ctx: Ctx, id: string, input: unknown): Promise<Account> {
  const current = await requireAccount(ctx, id);
  const parsed: AccountSettingsInput = accountSettingsSchema.parse(input);
  const settings = current.origin === "synced" ? settingsForSynced(parsed, current) : parsed;
  if (settings.currency !== current.currency && (await hasBalanceEntries(ctx, id))) {
    throw new AccountError("currency_locked");
  }
  // A service of Investments stays an investment or crypto account (§1.3, D13).
  if (
    settings.type !== current.type &&
    settings.type !== "investment" &&
    settings.type !== "crypto" &&
    (await serviceAccountIds(ctx, [id])).has(id)
  ) {
    throw new AccountError("managed_locked");
  }
  return getDb().transaction(async (tx) => {
    const iban = await personIban(tx, ctx, settings.iban, settings.type, current);
    const [row] = await tx
      .update(accounts)
      .set({
        name: settings.name,
        type: settings.type,
        currency: settings.currency,
        groupId: settings.groupId,
        color: settings.color,
        reference: settings.reference,
        ...iban,
        purpose: settings.purpose,
        openedOn: settings.openedOn,
        notes: settings.notes,
        inNetWorth: settings.inNetWorth,
        inSnapshot: settings.inSnapshot,
        countsAsLiquid: settings.countsAsLiquid,
        lowBalanceCents: settings.lowBalanceCents,
        staleAfterHours: settings.staleAfterHours,
        reminder: settings.reminder,
        betweenEntries: settings.betweenEntries,
        // A provider rename is followed only until the name is changed here (spec §7.1).
        renamedLocally: current.renamedLocally || settings.name !== current.name,
        retypedLocally:
          current.retypedLocally || (current.origin === "synced" && settings.type !== current.type),
      })
      .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)))
      .returning();
    return row;
  });
}

export async function archiveAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await requireAccount(ctx, id);
  await getDb()
    .update(accounts)
    .set({ state: "archived", archivedAt: new Date() })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
}

export async function restoreAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await requireAccount(ctx, id);
  await getDb()
    .update(accounts)
    .set({ state: "active", archivedAt: null })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
}

/** The source an account came from, as a deletion leaves it for the caller to tell that source. */
export interface DeletedAccount {
  /** The sources that brought it here: its own, and the one it was switched away from, if any. */
  sources: { provider: string; providerAccountId: string }[];
}

/**
 * Deletes the account, with every movement and balance entry it holds, whatever its source. It
 * never archives: archiving is its own action (`archiveAccount`), and a button that archived in
 * secret took five accounts off the list in one evening (PERS-359).
 *
 * What depends on an account lives in other modules — pockets, subscriptions, budget limits,
 * interest rules, funds and their sources — and this module does not read their tables (§4.2).
 * Their foreign keys to `accounts` are `on delete no action`, so the database itself refuses the
 * deletion (23503) of an account something still rests on: that refusal is `in_use`. The use case
 * of the application lists and moves those things first (`app/(app)/accounts/[id]/delete.ts`).
 *
 * A deletion also forgets the provider links of the movements it takes with it, through the
 * integrations service (§4.3: one owner per table — this module never writes `provider_links`
 * itself), for every provider: an account switched from one source to another holds the links of
 * both. The provider ids of the *account* live in `accounts.provider_account_id` (§11.4), so they
 * go with the row; the caller gets them back to tell the source the account is no longer chosen.
 */
export async function removeAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<DeletedAccount> {
  const account = await requireAccount(ctx, id);
  // The ids before the delete, because the movements fall by foreign key and their
  // `provider_links` rows do not (`entity_id` is not a real foreign key: the deviation of §11.4).
  // Left behind they would hold the entity unique key of rows nothing can resolve, and a source
  // chosen again would take its movements for known ones and never import them back.
  const movementIds = await transactionIdsOfAccount(ctx, id);
  // A switch goes with the account (`on delete cascade`): without it, the source the account left
  // would no longer know that id is read elsewhere, and would bring the account back.
  const switched = await getDb()
    .select({
      provider: accountSwitches.fromProvider,
      providerAccountId: accountSwitches.fromProviderAccountId,
    })
    .from(accountSwitches)
    .where(
      and(
        eq(accountSwitches.accountId, id),
        isNull(accountSwitches.undoneAt),
        userScoped(ctx).owns(accountSwitches),
      ),
    )
    .orderBy(asc(accountSwitches.id));
  try {
    await getDb()
      .delete(accounts)
      .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  } catch (error) {
    if (!hasPgError(error, FOREIGN_KEY_VIOLATION)) throw error;
    throw new AccountError("in_use");
  }
  // After the delete, never before. A link removed while its row survives is worse than an
  // orphan: the next sync would not recognise the movement and would import it a second time,
  // which is wrong money in every total. This way the failure mode is the one we already have.
  await unlinkEntitiesOfEveryProvider(ctx, "transaction", movementIds);
  const own =
    account.provider !== null && account.providerAccountId !== null
      ? [{ provider: account.provider, providerAccountId: account.providerAccountId }]
      : [];
  return { sources: [...own, ...switched] };
}

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
  const [row] = await getDb()
    .insert(balanceEntries)
    .values(userScoped(ctx).stamp({ accountId, on: parsed.on, source: "manual" as const, ...values }))
    .onConflictDoUpdate({
      target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
      set: values,
    })
    .returning();
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
 */
export async function updateBalanceEntry(ctx: Ctx, id: string, input: unknown): Promise<BalanceEntry> {
  const parsed: BalanceEntryInput = balanceEntrySchema.parse(input);
  const [current] = await getDb()
    .select()
    .from(balanceEntries)
    .where(
      and(
        eq(balanceEntries.id, id),
        eq(balanceEntries.source, "manual"),
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
    capturedAt: new Date(),
  };
  const row = await getDb().transaction(async (tx) => {
    if (parsed.on !== current.on) {
      await tx
        .delete(balanceEntries)
        .where(
          and(
            userScoped(ctx).owns(balanceEntries),
            eq(balanceEntries.accountId, current.accountId),
            eq(balanceEntries.on, parsed.on),
            eq(balanceEntries.source, "manual"),
          ),
        );
    }
    const [updated] = await tx
      .update(balanceEntries)
      .set(values)
      .where(and(eq(balanceEntries.id, id), userScoped(ctx).owns(balanceEntries)))
      .returning();
    return updated;
  });
  await rebuildDerivedBalances(ctx, [current.accountId]);
  return row;
}

/** A provider's reading of a balance, as the Wallet sync hands it over (spec §9.1). */
export interface ProviderBalanceInput {
  /** The civil date of the reading **in the user's zone** (spec §9.1): the caller's to compute. */
  on: CivilDate;
  cents: Cents;
  availableCents?: Cents | null;
}

/**
 * A balance Wallet published, stored as its own `provider` row (spec §9.1).
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
 * An account Investments manages (a Wallet account handed over to a service, §1.3, A4) takes no
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
  const since = await managedSinceOf(ctx, accountId);
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
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(balanceEntries)
      .values(userScoped(ctx).stamp({ accountId, on: input.on, source: "provider" as const, ...values }))
      .onConflictDoUpdate({
        target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
        set: values,
      })
      .returning();
    await tx
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
  tx: Tx,
): Promise<BalanceEntry> {
  if (!isCivilDate(input.on)) throw new RangeError(`Not a civil date: "${input.on}"`);
  const [owned] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), userScoped(ctx).owns(accounts)));
  if (!owned) throw new AccountError("not_found");
  const values = { balanceCents: input.cents, note: input.note, capturedAt: new Date() };
  const [row] = await tx
    .insert(balanceEntries)
    .values(userScoped(ctx).stamp({ accountId, on: input.on, source: "import" as const, ...values }))
    .onConflictDoUpdate({
      target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
      set: values,
    })
    .returning();
  return row;
}

export async function deleteBalanceEntry(ctx: Pick<Ctx, "userId" | "timeZone">, id: string): Promise<void> {
  const [entry] = await getDb()
    .select({ accountId: balanceEntries.accountId, on: balanceEntries.on })
    .from(balanceEntries)
    .where(and(eq(balanceEntries.id, id), userScoped(ctx).owns(balanceEntries)));
  if (entry) await refuseManaged(ctx, entry.accountId, entry.on);
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

/**
 * Several accounts' balances on every day of a window, in one read (spec §7.1, F2.5): a synced
 * account's from its readings and its movements, a manual one's held between entries
 * (`dailySeries`). Both ends included; a window reaching past today is the caller's to trim. An id
 * that is not one of this user's accounts is simply absent from `series`.
 */
export async function dailyBalancesOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
  window: { from: CivilDate; to: CivilDate },
): Promise<{ days: CivilDate[]; series: Map<string, { values: (Cents | null)[]; estimated: boolean[] }> }> {
  const wanted = new Set(accountIds);
  const owned = (await listAccounts(ctx, { includeArchived: true })).filter((account) =>
    wanted.has(account.id),
  );
  const syncedIds = owned.filter((account) => account.origin === "synced").map((account) => account.id);
  const [basis, daily] = await Promise.all([
    movementBasis(
      ctx,
      owned.map((account) => account.id),
    ),
    dailyNetByAccount(ctx, syncedIds),
  ]);
  const days: CivilDate[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) days.push(day);
  const series = new Map(
    owned.map((account) => {
      const { readings = [], points = [] } = basis.get(account.id) ?? {};
      const read = dailySeries(
        readings,
        daily.get(account.id) ?? [],
        days,
        account.origin === "synced" ? "movements" : "hold",
      );
      // The movements written by hand are in neither the readings nor the provider's movements.
      return [account.id, { ...read, values: withMovementPoints(read.values, days, readings, points) }];
    }),
  );
  return { days, series };
}

/** One account day by day, for Account detail's day grain (see {@link dailyBalancesOf}). */
export async function accountDailyBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  window: { from: CivilDate; to: CivilDate },
): Promise<{ days: CivilDate[]; values: (Cents | null)[]; estimated: boolean[] }> {
  const account = await requireAccount(ctx, accountId);
  const { days, series } = await dailyBalancesOf(ctx, [account.id], window);
  const one = series.get(account.id) ?? { values: days.map(() => null), estimated: days.map(() => false) };
  return { days, ...one };
}

/**
 * The month ends of the user's synced accounts rebuilt from their movements (spec §7.1, F2.5),
 * from scratch: every `derived` row of those accounts goes, and `deriveMonthEnds` writes the ones
 * the current readings and movements support, in one transaction — so running it twice changes
 * nothing, and a reading or a correction added since simply moves what gets rebuilt. A manual
 * account has no movements, so there is nothing to rebuild it from, and neither has the account of a
 * provider that syncs no movements (`syncsTransactions`: an investment provider).
 *
 * Reads first, writes after, and no network anywhere (spec §4.3): the sync calls it once its own
 * reads are over.
 */
export async function rebuildDerivedBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds?: readonly string[],
  options: { manualChanged?: boolean } = {},
): Promise<{ written: number }> {
  const wanted = (await accountsToRebuild(ctx)).filter(
    ({ account }) => accountIds === undefined || accountIds.includes(account.id),
  );
  const monthEnds = await rebuildMonthEnds(
    ctx,
    wanted.map(({ account }) => account),
  );
  // After the month ends: a rebuilt end that follows a manual movement has to show it too. Only
  // the accounts that have a manual movement, or whose manual movements the caller just changed:
  // a balance written on any other account starts nothing here.
  const manual = options.manualChanged ? wanted : wanted.filter((one) => one.hasManualMovements);
  if (manual.length > 0) {
    await rebuildMovementBalances(
      ctx,
      manual.map((one) => ({ id: one.account.id, marked: one.hasManualMovements })),
    );
  }
  return monthEnds;
}

/**
 * The balance after the movements a person wrote by hand (rewrite plan, 12-account-modes.md
 * §12.2), from scratch like the month ends: every `movement` row of the accounts goes and
 * `movementBalances` writes the ones the readings and the manual movements support, in one
 * transaction. It runs wherever a reading or a manual movement changes, so every read of a
 * balance — Accounts, Overview, the net worth, the API — finds the number already there. The same
 * transaction keeps the mark of the account (`manual_movement_accounts`) true to it.
 */
async function rebuildMovementBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  wanted: readonly { id: string; marked: boolean }[],
): Promise<void> {
  const ids = wanted.map((account) => account.id);
  const manual = await manualMovementsByAccount(ctx, ids);
  const basis = await movementBasis(ctx, [...manual.keys()]);
  const capturedAt = new Date();
  const rows = [...manual].flatMap(([accountId, movements]) => {
    const { readings = [], copies = [] } = basis.get(accountId) ?? {};
    return movementBalances(readings, movements, copies).map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "movement" as const,
        capturedAt,
      }),
    );
  });
  await getDb().transaction(async (tx) => {
    await tx
      .delete(balanceEntries)
      .where(
        and(
          userScoped(ctx).owns(balanceEntries),
          eq(balanceEntries.source, "movement"),
          inArray(balanceEntries.accountId, ids),
        ),
      );
    if (rows.length > 0) await tx.insert(balanceEntries).values(rows);
    const marked = wanted.filter((account) => manual.has(account.id) && !account.marked);
    if (marked.length > 0) {
      await tx
        .insert(manualMovementAccounts)
        .values(marked.map((account) => userScoped(ctx).stamp({ accountId: account.id })))
        .onConflictDoNothing();
    }
    const unmarked = wanted.filter((account) => !manual.has(account.id) && account.marked);
    if (unmarked.length > 0) {
      await tx.delete(manualMovementAccounts).where(
        and(
          userScoped(ctx).owns(manualMovementAccounts),
          inArray(
            manualMovementAccounts.accountId,
            unmarked.map((account) => account.id),
          ),
        ),
      );
    }
  });
}

async function rebuildMonthEnds(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  wanted: readonly Account[],
): Promise<{ written: number }> {
  const synced = wanted.filter(
    (account) => account.origin === "synced" && syncsTransactions(account.provider),
  );
  if (synced.length === 0) return { written: 0 };
  const ids = synced.map((account) => account.id);
  const [observed, daily] = await Promise.all([observedDays(ctx, ids), dailyNetByAccount(ctx, ids)]);
  const capturedAt = new Date();
  const rows = ids.flatMap((accountId) =>
    deriveMonthEnds(observed.get(accountId) ?? [], daily.get(accountId) ?? []).map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "derived" as const,
        capturedAt,
      }),
    ),
  );
  await getDb().transaction(async (tx) => {
    await tx
      .delete(balanceEntries)
      .where(
        and(
          userScoped(ctx).owns(balanceEntries),
          inArray(balanceEntries.accountId, ids),
          eq(balanceEntries.source, "derived"),
        ),
      );
    if (rows.length > 0) await tx.insert(balanceEntries).values(rows);
  });
  return { written: rows.length };
}

/**
 * The `portfolio` points of an account Investments manages (docs/design/investments.md §1.7),
 * inside the caller's transaction: every point from `from` on goes and `points` take their place,
 * so a rewrite from the oldest day a change touches leaves every day before it as it was.
 */
export async function replacePortfolioPoints(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  from: CivilDate,
  points: readonly { on: CivilDate; cents: Cents }[],
  tx: Tx,
): Promise<{ written: number }> {
  const [owned] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), userScoped(ctx).owns(accounts)));
  if (!owned) throw new AccountError("not_found");
  await tx
    .delete(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        eq(balanceEntries.accountId, accountId),
        eq(balanceEntries.source, "portfolio"),
        gte(balanceEntries.on, from),
      ),
    );
  const capturedAt = new Date();
  const rows = points
    .filter((point) => point.on >= from)
    .map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "portfolio" as const,
        capturedAt,
      }),
    );
  if (rows.length > 0) await tx.insert(balanceEntries).values(rows);
  return { written: rows.length };
}

/**
 * Moves an account's opening back to `on` when its history turns out to start earlier (PERS-100:
 * the estimated history of a service), inside the caller's transaction. Never moves it forward.
 */
export async function openedNoLaterThan(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  on: CivilDate,
  tx: Tx,
): Promise<void> {
  await tx
    .update(accounts)
    .set({ openedOn: on })
    .where(
      and(
        eq(accounts.id, accountId),
        userScoped(ctx).owns(accounts),
        or(isNull(accounts.openedOn), gt(accounts.openedOn, on)),
      ),
    );
}

/**
 * The handover of an existing account to Investments at `T` (§1.3, A4), inside the caller's
 * transaction: the `manual`, `import` and `provider` entries from `T` on are removed and returned,
 * for the caller to archive in the same transaction; the ones before `T` stay.
 */
export async function takeOverEntries(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  from: CivilDate,
  tx: Tx,
): Promise<BalanceEntry[]> {
  return tx
    .delete(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        eq(balanceEntries.accountId, accountId),
        inArray(balanceEntries.source, ["manual", "import", "provider"]),
        gte(balanceEntries.on, from),
      ),
    )
    .returning();
}

export interface SnapshotOutcome {
  month: MonthKey;
  written: number;
  skipped: number;
  /** In `currency`, the display currency of the day it ran: each account converted, then summed. */
  total: Cents | null;
  currency: string;
  warnings: string[];
}

/**
 * The monthly snapshot of spec §7.1: for every account included in it, a `system` balance on the
 * last day of `month`, copied from the last balance known up to that day. Accounts with no data
 * are skipped, and running it twice changes nothing — both the balances and the `snapshot_runs`
 * row are upserts, so a retry after a partial failure is safe.
 *
 * Each `system` balance is a copy in the account's own currency. The run's total is in the display
 * currency (docs/design/investments.md §2.3): every balance converted at the month end's rate, then
 * summed, and saved with `total_currency`, so a later change of the preference never rewrites it.
 * A balance with no rate stays out of the total, never counted 1:1.
 */
export async function runSnapshot(
  ctx: Pick<Ctx, "userId" | "displayCurrency">,
  month: MonthKey,
  now: Date = new Date(),
): Promise<SnapshotOutcome> {
  const on = lastDayOfMonth(month);
  const included = await getDb()
    .select()
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), eq(accounts.inSnapshot, true)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const open = included.filter((account) => account.state !== "archived");

  const balances =
    open.length === 0
      ? new Map()
      : await balancesOn(
          ctx,
          open.map((a) => a.id),
          on,
          { observed: true },
        );
  const warnings: string[] = [];
  const values: (typeof balanceEntries.$inferInsert)[] = [];
  for (const account of open) {
    const balance = balances.get(account.id);
    if (balance === undefined) continue;
    if (account.origin === "synced" && isStale(account.lastSyncedAt, account.staleAfterHours, now)) {
      warnings.push(account.name);
    }
    values.push(
      userScoped(ctx).stamp({
        accountId: account.id,
        on,
        balanceCents: balance,
        source: "system" as const,
        capturedAt: now,
      }),
    );
  }

  if (values.length > 0) {
    await getDb()
      .insert(balanceEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
        set: { balanceCents: sql`excluded.balance_cents`, capturedAt: now },
      });
  }

  const currency = ctx.displayCurrency;
  const currencyOf = new Map(open.map((account) => [account.id, account.currency]));
  const rates = await ratesOn(
    open.some((account) => account.currency !== currency) ? [currency, ...currencyOf.values()] : [],
    on,
    on,
  );
  const { total } = sumCents(
    values.map((value) =>
      convertCents(
        value.balanceCents as Cents,
        currencyOf.get(value.accountId) ?? currency,
        currency,
        on,
        rates,
      ),
    ),
  );
  const outcome: SnapshotOutcome = {
    month: monthKey(month),
    written: values.length,
    skipped: open.length - values.length,
    total,
    currency,
    warnings,
  };
  const row = {
    state: warnings.length > 0 ? ("warning" as const) : ("success" as const),
    accountsWritten: outcome.written,
    accountsSkipped: outcome.skipped,
    totalCents: total,
    totalCurrency: currency,
    warnings,
    ranAt: now,
  };
  await getDb()
    .insert(snapshotRuns)
    .values(userScoped(ctx).stamp({ month: outcome.month, ...row }))
    .onConflictDoUpdate({ target: [snapshotRuns.userId, snapshotRuns.month], set: row });
  return outcome;
}

/** The month the snapshot of `on` covers: the month before it (spec §10.2, the 1st at 00:05). */
export function snapshotMonthFor(on: CivilDate): MonthKey {
  return addMonths(monthKey(on), -1);
}

/* Accounts a person ties to a provider by hand (rewrite plan N1: the accounts of a bank) */

/** What a person chose for one account a provider exposes: a new account here, or one of theirs. */
export interface ProviderAccountChoice {
  /** The provider's own id of the account, the one that stays the same across accesses. */
  providerAccountId: string;
  currency: string;
  target: { kind: "new"; name: string; type: AccountType } | { kind: "existing"; accountId: string };
  /** The account's IBAN as the source gives it, in any form: checked here; `null` when none. */
  iban?: string | null;
}

const choiceNameSchema = z.string().trim().min(1).max(80);

/**
 * The accounts a person may hand to a provider that reads a bank: kept by hand, active, not one
 * a service of Investments manages, and of a kind a bank holds. The currency is the caller's to
 * compare: an account keeps its own.
 */
export async function accountsOpenToProvider(ctx: Pick<Ctx, "userId">): Promise<Account[]> {
  const all = await listAccounts(ctx);
  const managed = await serviceAccountIds(
    ctx,
    all.map((account) => account.id),
  );
  return all.filter(
    (account) =>
      account.origin === "manual" &&
      account.state === "active" &&
      !managed.has(account.id) &&
      (account.type === "checking" ||
        account.type === "savings" ||
        account.type === "cash" ||
        account.type === "credit" ||
        account.type === "other"),
  );
}

/**
 * Ties the accounts a provider exposes to accounts here, as the person chose: a new account, or
 * an existing one kept by hand — whose balances stay, with the provider's readings beside them
 * (decision H26). One transaction: either every choice is applied or none.
 *
 * An account already tied to this provider's id is left as it is, so applying the same choices
 * twice changes nothing. Returns the local account of each provider id.
 */
export async function linkProviderAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  choices: readonly ProviderAccountChoice[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const linked = new Map<string, string>();
  const existing = choices.flatMap((choice) =>
    choice.target.kind === "existing" ? [choice.target.accountId] : [],
  );
  if (new Set(existing).size !== existing.length) throw new AccountError("invalid");
  if (new Set(choices.map((choice) => choice.providerAccountId)).size !== choices.length) {
    throw new AccountError("invalid");
  }
  const open = new Map((await accountsOpenToProvider(ctx)).map((account) => [account.id, account]));
  const already = new Map(
    (await listAccounts(ctx, { includeArchived: true }))
      .filter((account) => account.provider === provider && account.providerAccountId !== null)
      .map((account) => [account.providerAccountId as string, account.id]),
  );
  let sortOrder = await nextSortOrder(ctx);

  await getDb().transaction(async (tx) => {
    await lockIbans(tx, ctx);
    const holders = await ibanHolders(tx, ctx);
    for (const choice of choices) {
      const known = already.get(choice.providerAccountId);
      if (known !== undefined) {
        linked.set(choice.providerAccountId, known);
        continue;
      }
      const iban = normalizeIban(choice.iban);
      const tie = {
        origin: "synced" as const,
        provider,
        providerAccountId: choice.providerAccountId,
        lastSyncedAt: now,
      };
      if (choice.target.kind === "existing") {
        const account = open.get(choice.target.accountId);
        if (!account || account.currency !== choice.currency) throw new AccountError("invalid");
        // The source writes the IBAN it gives on the account it is tied to (§2.4.3).
        const fromSource = iban !== null && hasIbanField(account.type) ? { iban, ibanFromSource: true } : {};
        await tx
          .update(accounts)
          .set({ ...tie, ...fromSource })
          .where(and(eq(accounts.id, account.id), userScoped(ctx).owns(accounts)));
        linked.set(choice.providerAccountId, account.id);
        continue;
      }
      const name = choiceNameSchema.safeParse(choice.target.name);
      if (!name.success) throw new AccountError("invalid");
      const type = choice.target.type;
      // One IBAN, one account (H39): a new account never takes an IBAN an open account has.
      const conflict = iban === null ? null : ibanConflict(iban, holders);
      if (conflict !== null && conflict.kind === "exists")
        throw new AccountError("iban_exists", conflict.name);
      const withIban = iban !== null && hasIbanField(type) ? { iban, ibanFromSource: true } : {};
      const [row] = await tx
        .insert(accounts)
        .values(
          userScoped(ctx).stamp({
            ...tie,
            ...withIban,
            name: name.data,
            type,
            currency: choice.currency,
            state: "active" as const,
            countsAsLiquid: type === "checking" || type === "cash" || type === "savings",
            staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
            sortOrder: sortOrder++,
          }),
        )
        .returning({ id: accounts.id });
      linked.set(choice.providerAccountId, row.id);
      if (withIban.iban !== undefined) {
        holders.push({ id: row.id, name: name.data, iban: withIban.iban, state: "active" });
      }
    }
  });
  return linked;
}

/** The accounts tied to a provider, by the provider's own id of each. */
export async function accountsOfProvider(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<Map<string, Account>> {
  return new Map(
    (await listAccounts(ctx, { includeArchived: true }))
      .filter((account) => account.provider === provider && account.providerAccountId !== null)
      .map((account) => [account.providerAccountId as string, account]),
  );
}

/**
 * Applies a provider's account list (spec §7.1). F2's sync engine fetches the accounts outside any
 * transaction and hands them here; the rules that decide what happens live in `rules.ts`.
 */
export async function applyProviderAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  remote: readonly RemoteAccount[],
  now: Date = new Date(),
): Promise<{ ibanConflicts: string[] }> {
  const local = await getDb()
    .select()
    .from(accounts)
    .where(userScoped(ctx).owns(accounts))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  // An account switched away from this source is not this source's any more: its source's account
  // is neither tied again nor created again, nor marked as gone (rewrite plan N4, §9.2).
  const away = await switchedAwayFrom(ctx, provider);
  const steps = reconcileProviderAccounts(
    local,
    remote.filter((one) => !away.has(one.providerAccountId)),
    provider,
  );
  // The accounts here whose IBAN a new account of the source carries: that account is not created
  // (H39, case 5 of §2.4.2), and the row of the connection says so.
  const ibanConflicts = [
    ...new Set(steps.flatMap((step) => (step.action === "ibanExists" ? [step.accountId] : []))),
  ];
  if (steps.length === ibanConflicts.length && steps.every((step) => step.action === "ibanExists")) {
    return { ibanConflicts };
  }
  let sortOrder = await nextSortOrder(ctx);
  const sourceIban = (remote: RemoteAccount) =>
    remote.iban != null && hasIbanField(remote.type) ? { iban: remote.iban, ibanFromSource: true } : {};

  await getDb().transaction(async (tx) => {
    await lockIbans(tx, ctx);
    for (const step of steps) {
      switch (step.action) {
        case "ibanExists":
          break;
        case "iban":
          await tx
            .update(accounts)
            .set({ iban: step.iban, ibanFromSource: true })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
        case "create":
          await tx.insert(accounts).values(
            userScoped(ctx).stamp({
              ...sourceIban(step.remote),
              name: step.remote.name,
              type: step.remote.type,
              currency: step.remote.currency,
              origin: "synced" as const,
              provider: step.remote.provider,
              providerAccountId: step.remote.providerAccountId,
              state: "active" as const,
              staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
              lastSyncedAt: now,
              sortOrder: sortOrder++,
            }),
          );
          break;
        case "adopt":
          await tx
            .update(accounts)
            .set({
              ...sourceIban(step.remote),
              origin: "synced",
              provider: step.remote.provider,
              providerAccountId: step.remote.providerAccountId,
              type: step.remote.type,
              currency: step.remote.currency,
              lastSyncedAt: now,
            })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
        case "retype":
          await tx
            .update(accounts)
            .set({ type: step.type, lastSyncedAt: now })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
        case "rename":
          await tx
            .update(accounts)
            .set({ name: step.name, lastSyncedAt: now })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
        case "reappear":
          await tx
            .update(accounts)
            .set({ state: "active", lastSyncedAt: now })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
        case "unavailable":
          await tx
            .update(accounts)
            .set({ state: "unavailable" })
            .where(and(eq(accounts.id, step.id), userScoped(ctx).owns(accounts)));
          break;
      }
    }
  });
  return { ibanConflicts };
}

/**
 * For each number a source gives, the open account here that has it as its IBAN (H39): the
 * procedure of a source warns before it would add an account twice. Numbers that are not an IBAN
 * and IBANs nobody has are left out. The map is keyed by the number as given; the owner carries
 * no IBAN.
 */
export async function ibanOwnersOf(
  ctx: Pick<Ctx, "userId">,
  numbers: readonly (string | null)[],
): Promise<Map<string, { id: string; name: string; manual: boolean }>> {
  const owners = new Map<string, { id: string; name: string; manual: boolean }>();
  const wanted = numbers.flatMap((number) => {
    const iban = normalizeIban(number);
    return number !== null && iban !== null ? [{ number, iban }] : [];
  });
  if (wanted.length === 0) return owners;
  const holders = await getDb()
    .select({
      id: accounts.id,
      name: accounts.name,
      iban: accounts.iban,
      state: accounts.state,
      origin: accounts.origin,
    })
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), sql`${accounts.iban} is not null`))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  for (const { number, iban } of wanted) {
    const conflict = ibanConflict(iban, holders);
    if (conflict === null || conflict.kind !== "exists") continue;
    const holder = holders.find((one) => one.id === conflict.accountId)!;
    owners.set(number, { id: holder.id, name: holder.name, manual: holder.origin === "manual" });
  }
  return owners;
}

/**
 * The IBANs a source gives for the accounts tied to it, written at each reading (H39: "the source
 * fills the field when it gives it"). A value that is not an IBAN, or one already there, changes
 * nothing; an account of a type without the field is left alone (H47). Another account with the
 * same IBAN does not stop the write (04-now.md §4.6.1, point 6).
 */
export async function saveSourceIbans(
  ctx: Pick<Ctx, "userId">,
  given: readonly { accountId: string; iban: string | null }[],
): Promise<number> {
  const wanted = new Map<string, string>();
  for (const one of given) {
    const iban = normalizeIban(one.iban);
    if (iban !== null) wanted.set(one.accountId, iban);
  }
  if (wanted.size === 0) return 0;
  return getDb().transaction(async (tx) => {
    await lockIbans(tx, ctx);
    const rows = await tx
      .select({ id: accounts.id, type: accounts.type, iban: accounts.iban, from: accounts.ibanFromSource })
      .from(accounts)
      .where(and(userScoped(ctx).owns(accounts), inArray(accounts.id, [...wanted.keys()])));
    let written = 0;
    for (const row of rows) {
      const iban = wanted.get(row.id) as string;
      if (!hasIbanField(row.type) || (row.iban === iban && row.from)) continue;
      await tx
        .update(accounts)
        .set({ iban, ibanFromSource: true })
        .where(and(eq(accounts.id, row.id), userScoped(ctx).owns(accounts)));
      written += 1;
    }
    return written;
  });
}

// ——— What hangs off an account (spec §7.1; owner, 2026-09-21) ———————————————————————————————————

export type AccountConnection = typeof accountConnections.$inferSelect;

const connectionSchema = z.object({
  channel: z.enum(CONNECTION_CHANNELS),
  name: z.string().trim().min(1).max(60),
  note: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});
export type ConnectionInput = z.input<typeof connectionSchema>;

/** The unique key is case-insensitive, so "Paypal" twice on one channel is one connection. */
function connectionWrite<T>(write: Promise<T>): Promise<T> {
  return write.catch((error: unknown) => {
    if (hasPgError(error, UNIQUE_VIOLATION, "account_connections_uq")) {
      throw new AccountError("duplicate_connection");
    }
    throw error;
  });
}

/**
 * Everything hanging off one account, the IBAN's before the card's and alphabetical inside each:
 * the order a person reads a list in, and one a second query cannot shuffle.
 */
export async function connectionsOf(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<AccountConnection[]> {
  return getDb()
    .select()
    .from(accountConnections)
    .where(and(eq(accountConnections.accountId, accountId), userScoped(ctx).owns(accountConnections)))
    .orderBy(
      asc(accountConnections.channel),
      asc(sql`lower(${accountConnections.name})`),
      asc(accountConnections.id),
    );
}

/** The same, for several accounts at once: the list page draws them all and asks once. */
export async function connectionsByAccount(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, AccountConnection[]>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(accountConnections)
    .where(
      and(userScoped(ctx).owns(accountConnections), inArray(accountConnections.accountId, [...accountIds])),
    )
    .orderBy(
      asc(accountConnections.channel),
      asc(sql`lower(${accountConnections.name})`),
      asc(accountConnections.id),
    );
  const byAccount = new Map<string, AccountConnection[]>();
  for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  return byAccount;
}

export async function addConnection(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: ConnectionInput,
): Promise<AccountConnection> {
  await requireAccount(ctx, accountId);
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) throw new AccountError("invalid");
  const [row] = await connectionWrite(
    getDb()
      .insert(accountConnections)
      .values(userScoped(ctx).stamp({ accountId, ...parsed.data }))
      .returning(),
  );
  return row;
}

export async function updateConnection(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: ConnectionInput,
): Promise<AccountConnection> {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) throw new AccountError("invalid");
  const [row] = await connectionWrite(
    getDb()
      .update(accountConnections)
      .set(parsed.data)
      .where(and(eq(accountConnections.id, id), userScoped(ctx).owns(accountConnections)))
      .returning(),
  );
  if (!row) throw new AccountError("not_found");
  return row;
}

export async function removeConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const removed = await getDb()
    .delete(accountConnections)
    .where(and(eq(accountConnections.id, id), userScoped(ctx).owns(accountConnections)))
    .returning({ id: accountConnections.id });
  if (removed.length === 0) throw new AccountError("not_found");
}

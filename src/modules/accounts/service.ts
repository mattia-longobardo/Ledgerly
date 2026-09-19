import "server-only";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
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
import { getDb } from "@/platform/db/client";
import { FOREIGN_KEY_VIOLATION, hasPgError } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { PROVIDERS } from "@/platform/integrations/rules";
import { unlinkEntities } from "@/platform/integrations/service";
import { type Cents, sumCents } from "@/platform/money";
import { dailyNetByAccount, transactionIdsOfAccount } from "@/modules/transactions/queries";
import {
  type AccountCreateInput,
  accountCreateSchema,
  type AccountSettingsInput,
  accountSettingsSchema,
  type BalanceEntryInput,
  balanceEntrySchema,
  canDelete,
  dailySeries,
  DEFAULT_STALE_AFTER_HOURS,
  deriveMonthEnds,
  isFutureDate,
  isStale,
  type RemoteAccount,
  reconcileProviderAccounts,
  settingsForSynced,
} from "./rules";
import {
  type Account,
  type AccountGroup,
  type BalanceEntry,
  balancesOn,
  listAccounts,
  observedDays,
} from "./queries";
import { accountGroups, accounts, balanceEntries, snapshotRuns } from "./schema";

/** Every service failure a caller is expected to handle carries one of these codes. */
export type AccountErrorCode = "not_found" | "future_date" | "synced_locked" | "duplicate_name";

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
    this.name = "AccountError";
  }
}

async function requireAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<Account> {
  const [row] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  if (!row) throw new AccountError("not_found");
  return row;
}

async function nextSortOrder(ctx: Pick<Ctx, "userId">): Promise<number> {
  const [row] = await getDb()
    .select({ highest: max(accounts.sortOrder) })
    .from(accounts)
    .where(userScoped(ctx).owns(accounts));
  return (row?.highest ?? -1) + 1;
}

export async function listGroups(ctx: Pick<Ctx, "userId">): Promise<AccountGroup[]> {
  return getDb()
    .select()
    .from(accountGroups)
    .where(userScoped(ctx).owns(accountGroups))
    .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.id));
}

/**
 * A manual account, with its optional opening balance written in the same transaction so an
 * account never exists for a moment with a balance the caller believes it already has.
 */
export async function createAccount(ctx: Ctx, input: unknown): Promise<Account> {
  const parsed: AccountCreateInput = accountCreateSchema.parse(input);
  if (parsed.openingBalance && isFutureDate(parsed.openingBalance.on, today(ctx.timeZone))) {
    throw new AccountError("future_date");
  }
  const sortOrder = await nextSortOrder(ctx);
  return getDb().transaction(async (tx) => {
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

/** The Settings tab. A synced account keeps the provider's type and currency (spec §7.1). */
export async function updateAccountSettings(ctx: Ctx, id: string, input: unknown): Promise<Account> {
  const current = await requireAccount(ctx, id);
  const parsed: AccountSettingsInput = accountSettingsSchema.parse(input);
  const settings = current.origin === "synced" ? settingsForSynced(parsed, current) : parsed;
  const [row] = await getDb()
    .update(accounts)
    .set({
      name: settings.name,
      type: settings.type,
      currency: settings.currency,
      groupId: settings.groupId,
      color: settings.color,
      reference: settings.reference,
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
    })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)))
    .returning();
  return row;
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

/**
 * Deletion when nothing depends on the account, archiving otherwise (spec §7.1). The caller is
 * told which of the two happened so the interface can say so.
 *
 * What depends on an account lives in other modules — pockets, subscriptions, and from F4 interest
 * rules and funds — and this module does not read their tables (§4.2). Their foreign keys to
 * `accounts` are `on delete no action`, so the database itself refuses the deletion (23503) of an
 * account something still rests on, and that refusal is the reference count. A provider's account
 * is never deleted at all.
 *
 * A real deletion also forgets the provider links of the movements it takes with it, through the
 * integrations service (§4.3: one owner per table — this module never writes `provider_links`
 * itself). The provider ids of the *account* are not there at all: they live in
 * `accounts.provider_account_id` (§11.4), so they go with the row.
 */
export async function removeAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
): Promise<"deleted" | "archived"> {
  const account = await requireAccount(ctx, id);
  if (!canDelete(account, 0)) {
    await archiveAccount(ctx, id);
    return "archived";
  }
  // The ids before the delete, because the movements fall by foreign key and their
  // `provider_links` rows do not (`entity_id` is not a real foreign key: the deviation of §11.4).
  // Left behind they would hold the entity unique key of rows nothing can resolve, and claim a
  // `first_seen_at` for movements that no longer exist.
  const movementIds = await transactionIdsOfAccount(ctx, id);
  try {
    await getDb()
      .delete(accounts)
      .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  } catch (error) {
    if (!hasPgError(error, FOREIGN_KEY_VIOLATION)) throw error;
    await archiveAccount(ctx, id);
    return "archived";
  }
  // After the delete, never before. A link removed while its row survives is worse than an
  // orphan: the next sync would not recognise the movement and would import it a second time,
  // which is wrong money in every total. This way the failure mode is the one we already have.
  for (const provider of PROVIDERS) {
    await unlinkEntities(ctx, provider, "transaction", movementIds);
  }
  return "deleted";
}

/**
 * A manual balance for a date. On a synced account it is a correction that wins for that date, so
 * it is stored as its own `manual` row beside the provider's rather than overwriting it.
 */
export async function saveBalanceEntry(ctx: Ctx, accountId: string, input: unknown): Promise<BalanceEntry> {
  await requireAccount(ctx, accountId);
  const parsed: BalanceEntryInput = balanceEntrySchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new AccountError("future_date");
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
 */
export async function saveProviderBalance(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  input: ProviderBalanceInput,
  now: Date = new Date(),
): Promise<BalanceEntry> {
  await requireAccount(ctx, accountId);
  if (!isCivilDate(input.on)) throw new RangeError(`Not a civil date: "${input.on}"`);
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

export async function deleteBalanceEntry(ctx: Pick<Ctx, "userId" | "timeZone">, id: string): Promise<void> {
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
  const [observed, daily] = await Promise.all([
    observedDays(
      ctx,
      owned.map((account) => account.id),
    ),
    dailyNetByAccount(ctx, syncedIds),
  ]);
  const days: CivilDate[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) days.push(day);
  const series = new Map(
    owned.map((account) => [
      account.id,
      dailySeries(
        observed.get(account.id) ?? [],
        daily.get(account.id) ?? [],
        days,
        account.origin === "synced" ? "movements" : "hold",
      ),
    ]),
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
 * account has no movements, so there is nothing to rebuild it from.
 *
 * Reads first, writes after, and no network anywhere (spec §4.3): the sync calls it once its own
 * reads are over.
 */
export async function rebuildDerivedBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds?: readonly string[],
): Promise<{ written: number }> {
  const synced = (await listAccounts(ctx, { includeArchived: true })).filter(
    (account) => account.origin === "synced" && (accountIds === undefined || accountIds.includes(account.id)),
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

export interface SnapshotOutcome {
  month: MonthKey;
  written: number;
  skipped: number;
  total: Cents | null;
  warnings: string[];
}

/**
 * The monthly snapshot of spec §7.1: for every account included in it, a `system` balance on the
 * last day of `month`, copied from the last balance known up to that day. Accounts with no data
 * are skipped, and running it twice changes nothing — both the balances and the `snapshot_runs`
 * row are upserts, so a retry after a partial failure is safe.
 */
export async function runSnapshot(
  ctx: Pick<Ctx, "userId">,
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

  const { total } = sumCents(values.map((value) => value.balanceCents as Cents));
  const outcome: SnapshotOutcome = {
    month: monthKey(month),
    written: values.length,
    skipped: open.length - values.length,
    total,
    warnings,
  };
  const row = {
    state: warnings.length > 0 ? ("warning" as const) : ("success" as const),
    accountsWritten: outcome.written,
    accountsSkipped: outcome.skipped,
    totalCents: total,
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

/**
 * Applies a provider's account list (spec §7.1). F2's sync engine fetches the accounts outside any
 * transaction and hands them here; the rules that decide what happens live in `rules.ts`.
 */
export async function applyProviderAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  remote: readonly RemoteAccount[],
  now: Date = new Date(),
): Promise<void> {
  const local = await getDb()
    .select()
    .from(accounts)
    .where(userScoped(ctx).owns(accounts))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const steps = reconcileProviderAccounts(local, remote, provider);
  if (steps.length === 0) return;
  let sortOrder = await nextSortOrder(ctx);

  await getDb().transaction(async (tx) => {
    for (const step of steps) {
      switch (step.action) {
        case "create":
          await tx.insert(accounts).values(
            userScoped(ctx).stamp({
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
              origin: "synced",
              provider: step.remote.provider,
              providerAccountId: step.remote.providerAccountId,
              type: step.remote.type,
              currency: step.remote.currency,
              lastSyncedAt: now,
            })
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
}

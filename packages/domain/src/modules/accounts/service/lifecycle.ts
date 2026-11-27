import { and, asc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { FOREIGN_KEY_VIOLATION, hasPgError } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import {
  linkExternal,
  linksOf,
  linksOfEntity,
  unlinkEntities,
  unlinkEntitiesOfEveryProvider,
} from "../../../platform/integrations/service";
import { managedAccounts, movements } from "../ports";
import {
  type AccountCreateInput,
  accountCreateSchema,
  type AccountSettingsInput,
  accountSettingsSchema,
  DEFAULT_STALE_AFTER_HOURS,
  isFutureDate,
  settingsForSynced,
} from "../rules";
import { type Account, listAccounts } from "../queries";
import { accounts, accountSwitches, balanceEntries } from "../schema";
import { AccountError, hasBalanceEntries, nextSortOrder, personIban, requireAccount } from "./guards";
import { rebuildDerivedBalances } from "./derived-balances";

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
  const run = <T>(work: (trx: Tx) => Promise<T>): Promise<T> =>
    outer ? work(outer) : getDb().transaction(work);
  return run(async (trx) => {
    const iban = await personIban(trx, ctx, { typed: parsed.iban, type: parsed.type }, null);
    const [account] = await trx
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
      await trx.insert(balanceEntries).values(
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
 * A new name for an account another module keeps in step with its own record — a fund's name
 * (PERS-589). Only the name: a rename here stops following the provider's, as in the form.
 */
export async function renameAccount(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<void> {
  const current = await requireAccount(ctx, id);
  if (current.name === name) return;
  await getDb()
    .update(accounts)
    .set({ name, renamedLocally: true })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
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
    (await managedAccounts().serviceAccountIds(ctx, [id])).has(id)
  ) {
    throw new AccountError("managed_locked");
  }
  const saved = await getDb().transaction(async (trx) => {
    const iban = await personIban(trx, ctx, { typed: settings.iban, type: settings.type }, current);
    const [row] = await trx
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
  // A new IBAN may make giroconti of movements already stored (F2.5): the form, the route and any
  // other caller get them joined by this one use case.
  await movements().linkOwnTransfers(ctx);
  return saved;
}

/**
 * The account this one doubles (decision H58). Open: the first account here, open and in the same
 * currency, whose movements hold every movement of this one, as the dialog of "Archive" says it
 * before. Archived: the twin recorded when it was archived. `null` when it doubles none.
 */
export async function twinAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
): Promise<Account | null> {
  const account = await requireAccount(ctx, id);
  const all = await listAccounts(ctx, { includeArchived: true });
  if (account.state === "archived") {
    const recorded = (await movements().duplicatesOf(ctx, [id])).get(id);
    return all.find((one) => one.id === recorded) ?? null;
  }
  const open = all.filter(
    (one) => one.id !== id && one.state !== "archived" && one.currency === account.currency,
  );
  const twinId = await movements().twinOf(
    ctx,
    id,
    open.map((one) => one.id),
  );
  return open.find((one) => one.id === twinId) ?? null;
}

/** Archives an account; a double of another stops counting in the months (H58) until it is restored. */
export async function archiveAccount(ctx: Pick<Ctx, "userId" | "timeZone">, id: string): Promise<void> {
  const twin = await twinAccount(ctx, id);
  await getDb()
    .update(accounts)
    .set({ state: "archived", archivedAt: new Date() })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  await movements().markDuplicate(ctx, id, twin?.id ?? null);
}

export async function restoreAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await requireAccount(ctx, id);
  await getDb()
    .update(accounts)
    .set({ state: "active", archivedAt: null })
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  await movements().markDuplicate(ctx, id, null);
}

/** The source an account came from, as a deletion leaves it for the caller to tell that source. */
export interface DeletedAccount {
  /**
   * The sources that brought it here: its own, the one it was switched away from, and the one it
   * was converted from when its source was turned off (plugin-settings.md §4.3).
   */
  sources: { provider: string; providerAccountId: string }[];
  name: string;
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
export async function removeAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
): Promise<DeletedAccount> {
  const account = await requireAccount(ctx, id);
  // The ids before the delete, because the movements fall by foreign key and their
  // `provider_links` rows do not (`entity_id` is not a real foreign key: the deviation of §11.4).
  // Left behind they would hold the entity unique key of rows nothing can resolve, and a source
  // chosen again would take its movements for known ones and never import them back.
  const movementIds = await movements().transactionIdsOfAccount(ctx, id);
  // The legs the server wrote for them on manual accounts go with them (`twin_of` cascades).
  const twinAccounts = (await movements().twinAccountsOf(ctx, movementIds)).filter((one) => one !== id);
  // An account of a source turned off is kept by hand and keeps the source's id as a link only.
  const converted = await linksOfEntity(ctx, "account", id);
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
  await unlinkEntitiesOfEveryProvider(ctx, "account", [id]);
  if (twinAccounts.length > 0) await rebuildDerivedBalances(ctx, twinAccounts, { manualChanged: true });
  const own =
    account.provider !== null && account.providerAccountId !== null
      ? [{ provider: account.provider, providerAccountId: account.providerAccountId }]
      : [];
  const linked = converted.map((one) => ({ provider: one.provider, providerAccountId: one.externalId }));
  return { sources: [...own, ...switched, ...linked], name: account.name };
}

/**
 * "Turn off" a source (plugin-settings.md §3.2), the accounts' part, inside the caller's
 * transaction: every account of the source becomes an account kept by hand, with the same name,
 * group, IBAN, balances and movements — the readings stay, so the balance of today is the last one
 * read. The source's id of each stays as a link of the core, never shown, so turning the source on
 * again ties the same account back (§3.4) instead of making a second one. Returns the accounts.
 */
export async function releaseSourceAccounts(
  trx: Tx,
  ctx: Pick<Ctx, "userId">,
  provider: string,
  now: Date = new Date(),
): Promise<{ id: string; providerAccountId: string }[]> {
  const rows = await trx
    .select({ id: accounts.id, providerAccountId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.provider, provider), userScoped(ctx).owns(accounts)))
    .orderBy(asc(accounts.id))
    .for("update");
  const released = rows.flatMap((row) =>
    row.providerAccountId === null ? [] : [{ id: row.id, providerAccountId: row.providerAccountId }],
  );
  // An account holds one link of a type per provider: an older one (an id the account had before a
  // switch) would refuse the new one and undo the whole turn-off.
  await unlinkEntities(
    ctx,
    provider,
    "account",
    released.map((one) => one.id),
    trx,
  );
  for (const one of released) {
    await linkExternal(
      ctx,
      {
        provider,
        entityType: "account",
        entityId: one.id,
        externalId: one.providerAccountId,
        metadata: null,
      },
      now,
      trx,
    );
  }
  if (rows.length > 0) {
    // The IBAN stays, now the person's to change: no source writes it any more.
    await trx
      .update(accounts)
      .set({
        origin: "manual",
        provider: null,
        providerAccountId: null,
        ibanFromSource: false,
        updatedAt: now,
      })
      .where(and(eq(accounts.provider, provider), userScoped(ctx).owns(accounts)));
  }
  return released;
}

/**
 * The first connection of a source turned on again (plugin-settings.md §3.4): each account kept by
 * hand that the source's link names is tied back to the source, so its next reading finds it and
 * brings no double. A movement written by hand meanwhile stays one. An account that has a source
 * again, or that another account of the source took, is left alone. Returns how many came back.
 */
export async function restoreSourceAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  /** The source's ids the new connection reads (a bank's access); every one when absent. */
  only?: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<number> {
  const links = new Map(
    [...(await linksOf(ctx, provider, "account"))].filter(([id]) => only === undefined || only.has(id)),
  );
  if (links.size === 0) return 0;
  let restored = 0;
  await getDb().transaction(async (trx) => {
    const taken = new Set(
      (
        await trx
          .select({ id: accounts.providerAccountId })
          .from(accounts)
          .where(and(eq(accounts.provider, provider), userScoped(ctx).owns(accounts)))
      ).map((row) => row.id),
    );
    for (const [externalId, accountId] of links) {
      if (taken.has(externalId)) continue;
      const back = await trx
        .update(accounts)
        .set({ origin: "synced", provider, providerAccountId: externalId, updatedAt: now })
        .where(and(eq(accounts.id, accountId), isNull(accounts.provider), userScoped(ctx).owns(accounts)))
        .returning({ id: accounts.id });
      restored += back.length;
    }
  });
  return restored;
}

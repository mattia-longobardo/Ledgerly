import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { normalizeIban } from "../../../platform/iban";
import { serviceAccountIds } from "../../investments/managed";
import {
  type AccountType,
  hasIbanField,
  ibanConflict,
  DEFAULT_STALE_AFTER_HOURS,
  type RemoteAccount,
  reconcileProviderAccounts,
} from "../rules";
import { type Account, listAccounts } from "../queries";
import { accounts } from "../schema";
import { switchedAwayFrom } from "../switching";
import { AccountError, ibanHolders, lockIbans, nextSortOrder } from "./guards";

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

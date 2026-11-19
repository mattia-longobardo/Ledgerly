import { and, asc, eq, max, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { type Db, getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { normalizeIban } from "../../../platform/iban";
import { managedAccounts } from "../ports";
import { type AccountType, hasIbanField, ibanConflict } from "../rules";
import { type Account, type BalanceEntry } from "../queries";
import { accounts, balanceEntries } from "../schema";

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
export async function lockIbans(tx: Tx, ctx: Pick<Ctx, "userId">): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`accounts-iban:${ctx.userId}`}))`);
}

/** The person's accounts as the rule "one IBAN, one account" reads them, inside the lock. */
export async function ibanHolders(tx: Tx, ctx: Pick<Ctx, "userId">) {
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
export async function personIban(
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

export async function hasBalanceEntries(ctx: Pick<Ctx, "userId">, accountId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: balanceEntries.id })
    .from(balanceEntries)
    .where(and(eq(balanceEntries.accountId, accountId), userScoped(ctx).owns(balanceEntries)))
    .limit(1);
  return row !== undefined;
}

/** The person's account, or `not_found`: the one check of ownership of the module (ACC-6). */
export async function requireAccount(
  ctx: Pick<Ctx, "userId">,
  id: string,
  executor: Db | Tx = getDb(),
): Promise<Account> {
  const [row] = await executor
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
export async function refuseManaged(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  on: CivilDate,
): Promise<void> {
  const since = await managedAccounts().managedSinceOf(ctx, accountId);
  if (since !== null && on >= since) throw new AccountError("managed_locked");
}

/**
 * Writes the balance of a day from one source: a second write of the same day and source replaces
 * the first (the unique key). The one upsert of `balance_entries` (ACC-6).
 */
export async function writeBalanceEntry(
  executor: Db | Tx,
  ctx: Pick<Ctx, "userId">,
  entry: { accountId: string; on: CivilDate; source: "manual" | "provider" | "import" },
  values: {
    balanceCents: bigint;
    availableCents?: bigint | null;
    note?: string | null;
    capturedAt: Date;
  },
): Promise<BalanceEntry> {
  const [row] = await executor
    .insert(balanceEntries)
    .values(userScoped(ctx).stamp({ ...entry, ...values }))
    .onConflictDoUpdate({
      target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
      set: values,
    })
    .returning();
  return row;
}

export async function nextSortOrder(ctx: Pick<Ctx, "userId">): Promise<number> {
  const [row] = await getDb()
    .select({ highest: max(accounts.sortOrder) })
    .from(accounts)
    .where(userScoped(ctx).owns(accounts));
  return (row?.highest ?? -1) + 1;
}

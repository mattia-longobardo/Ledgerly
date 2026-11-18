/**
 * The accounts' side of moving an account from one source to another (rewrite plan N4, 04-now.md
 * §4.6 and §4.6.1): the account changes its source, the switch is recorded, and "Undo switch" puts
 * the account back. The use case that joins the modules is in the application
 * (`app/(app)/accounts/[id]/switch/switch.ts`); every write here takes its transaction.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../platform/dates";
import { getDb, type Tx } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { normalizeIban } from "../../platform/iban";
import { hasIbanField } from "./rules";
import { accounts, accountSwitches, balanceEntries } from "./schema";

type Who = Pick<Ctx, "userId">;

type AccountSwitch = typeof accountSwitches.$inferSelect;

/** The open switch of an account, `null` when it has none (one at most: `account_switches_open_uq`). */
export async function openSwitchOf(ctx: Who, accountId: string): Promise<AccountSwitch | null> {
  const [row] = await getDb()
    .select()
    .from(accountSwitches)
    .where(
      and(
        eq(accountSwitches.accountId, accountId),
        isNull(accountSwitches.undoneAt),
        userScoped(ctx).owns(accountSwitches),
      ),
    );
  return row ?? null;
}

/** Every open switch of the person, the newest first. */
export async function openSwitches(ctx: Who): Promise<AccountSwitch[]> {
  return getDb()
    .select()
    .from(accountSwitches)
    .where(and(isNull(accountSwitches.undoneAt), userScoped(ctx).owns(accountSwitches)))
    .orderBy(desc(accountSwitches.appliedAt), asc(accountSwitches.id));
}

/**
 * The last balance a source wrote for an account: what the comparison of the switch reads as the
 * balance here (`12-account-modes.md` §12.5: without the manual movements). `null` when the source
 * never wrote one.
 */
export async function lastSourceBalance(
  ctx: Who,
  accountId: string,
): Promise<{ on: CivilDate; cents: bigint } | null> {
  const [row] = await getDb()
    .select({ on: balanceEntries.on, cents: balanceEntries.balanceCents })
    .from(balanceEntries)
    .where(
      and(
        eq(balanceEntries.accountId, accountId),
        eq(balanceEntries.source, "provider"),
        userScoped(ctx).owns(balanceEntries),
      ),
    )
    .orderBy(desc(balanceEntries.on))
    .limit(1);
  return row ? { on: row.on as CivilDate, cents: row.cents } : null;
}

interface SwitchRecord {
  accountId: string;
  toProvider: string;
  toProviderAccountId: string;
  connectionId: string;
  cutDate: CivilDate;
  /** The number the bank gives for the account: kept as its IBAN when the account has none. */
  identifier: string | null;
  interestModes: { ruleId: string; mode: string }[];
  counts: Record<string, number>;
  /**
   * The account of the bank already here that the switch joins (H39 for already imported accounts):
   * it gives its bank to the account and stays as an account kept by hand, archived. `null` when the
   * account of the bank is not here.
   */
  mergedAccountId: string | null;
}

/**
 * The account now comes from the bank (§9.1 of the specification): its source and the bank's id of
 * it change, the switch is recorded with what was there before. Inside the caller's transaction.
 * Returns the id of the switch.
 */
export async function recordSwitch(tx: Tx, ctx: Who, input: SwitchRecord, now: Date): Promise<string> {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), userScoped(ctx).owns(accounts)))
    .for("update");
  if (!account || account.provider === null || account.providerAccountId === null) {
    throw new Error("the account has no source to switch from");
  }
  const merged = input.mergedAccountId === null ? null : await releaseJoined(tx, ctx, input, now);
  const iban = normalizeIban(input.identifier);
  const ibanTaken = account.iban === null && iban !== null && hasIbanField(account.type);
  await tx
    .update(accounts)
    .set({
      provider: input.toProvider,
      providerAccountId: input.toProviderAccountId,
      origin: "synced",
      lastSyncedAt: now,
      ...(ibanTaken ? { iban, ibanFromSource: true } : {}),
    })
    .where(and(eq(accounts.id, account.id), userScoped(ctx).owns(accounts)));
  const [row] = await tx
    .insert(accountSwitches)
    .values(
      userScoped(ctx).stamp({
        accountId: account.id,
        fromProvider: account.provider,
        fromProviderAccountId: account.providerAccountId,
        toProvider: input.toProvider,
        toProviderAccountId: input.toProviderAccountId,
        connectionId: input.connectionId,
        cutDate: input.cutDate,
        ibanTaken,
        interestModes: input.interestModes,
        counts: input.counts,
        mergedAccountId: merged?.id ?? null,
        mergedState: merged?.state ?? null,
        appliedAt: now,
      }),
    )
    .returning({ id: accountSwitches.id });
  return row.id;
}

/**
 * The account of the bank already here gives its bank away before the switched account takes it (a
 * bank's id belongs to one account: `accounts_provider_uq`): it becomes an account kept by hand and is
 * archived, so it leaves the lists and the net worth and keeps every row. Returns what it was.
 */
async function releaseJoined(
  tx: Tx,
  ctx: Who,
  input: SwitchRecord,
  now: Date,
): Promise<{ id: string; state: string }> {
  const [joined] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.mergedAccountId as string), userScoped(ctx).owns(accounts)))
    .for("update");
  if (
    !joined ||
    joined.id === input.accountId ||
    joined.state === "archived" ||
    joined.provider !== input.toProvider ||
    joined.providerAccountId !== input.toProviderAccountId
  ) {
    throw new Error("the account to join is not the bank's account");
  }
  await tx
    .update(accounts)
    .set({
      origin: "manual",
      provider: null,
      providerAccountId: null,
      state: "archived",
      archivedAt: now,
      updatedAt: now,
    })
    .where(and(eq(accounts.id, joined.id), userScoped(ctx).owns(accounts)));
  return { id: joined.id, state: joined.state };
}

/**
 * "Undo switch" (§10.3): the account comes from the source of before again, with its id there; an
 * IBAN the switch gave it goes; the switch is closed. Inside the caller's transaction. Returns the
 * switch as it was, for the other modules' part of the undo.
 */
export async function closeSwitch(tx: Tx, ctx: Who, switchId: string, now: Date): Promise<AccountSwitch> {
  const [row] = await tx
    .update(accountSwitches)
    .set({ undoneAt: now })
    .where(
      and(
        eq(accountSwitches.id, switchId),
        isNull(accountSwitches.undoneAt),
        userScoped(ctx).owns(accountSwitches),
      ),
    )
    .returning();
  if (!row) throw new Error("no open switch");
  await tx
    .update(accounts)
    .set({
      provider: row.fromProvider,
      providerAccountId: row.fromProviderAccountId,
      origin: "synced",
      ...(row.ibanTaken ? { iban: null, ibanFromSource: false } : {}),
    })
    .where(and(eq(accounts.id, row.accountId), userScoped(ctx).owns(accounts)));
  // The account the switch joined takes its bank back, as it was, unless the person gave it another
  // source meanwhile (or deleted it: the column is then `null`).
  if (row.mergedAccountId !== null) {
    await tx
      .update(accounts)
      .set({
        origin: "synced",
        provider: row.toProvider,
        providerAccountId: row.toProviderAccountId,
        state: row.mergedState === "unavailable" ? "unavailable" : "active",
        archivedAt: null,
        updatedAt: now,
      })
      .where(
        and(eq(accounts.id, row.mergedAccountId), isNull(accounts.provider), userScoped(ctx).owns(accounts)),
      );
  }
  return row;
}

/** The provider ids a source no longer reads because their accounts moved away from it (§9.2). */
export async function switchedAwayFrom(ctx: Who, provider: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: accountSwitches.fromProviderAccountId })
    .from(accountSwitches)
    .where(
      and(
        eq(accountSwitches.fromProvider, provider),
        isNull(accountSwitches.undoneAt),
        userScoped(ctx).owns(accountSwitches),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** The counts of a switch, written again when a later reading finds more transfers. */
export async function addSwitchCounts(
  ctx: Who,
  switchId: string,
  more: Record<string, number>,
): Promise<void> {
  if (Object.keys(more).length === 0) return;
  const add = Object.entries(more)
    .map(
      ([key, value]) =>
        sql`jsonb_build_object(${key}::text, coalesce((${accountSwitches.counts}->>${key})::int, 0) + ${value})`,
    )
    .reduce((left, right) => sql`${left} || ${right}`);
  await getDb()
    .update(accountSwitches)
    .set({ counts: sql`${accountSwitches.counts} || ${add}` })
    .where(and(eq(accountSwitches.id, switchId), userScoped(ctx).owns(accountSwitches)));
}

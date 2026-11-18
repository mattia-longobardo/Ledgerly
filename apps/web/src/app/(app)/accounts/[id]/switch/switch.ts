// src/app/(app)/accounts/[id]/switch/switch.ts — the use case "move an account to the bank"
// (rewrite plan N4, 04-now.md §4.6 and §4.6.1; ux/n4-account-switch.md). It joins the accounts,
// the transactions, the interests, the source of before and the bank's plugin: only the
// application may (rule M8). The rules are pure (`switch-rules.ts`); this file reads, asks the
// rules and writes. No name of a provider: the source is reached through the registry of passes.
import "server-only";
import { createHash } from "node:crypto";
import { getAccount } from "@ledgerly/domain/accounts";
import { hasIbanField } from "@ledgerly/domain/accounts";
import { rebuildDerivedBalances } from "@ledgerly/domain/accounts";
import { closeSwitch, lastSourceBalance, openSwitchOf, recordSwitch } from "@ledgerly/domain/accounts";
import { publishingRulesOn } from "@ledgerly/domain/interests";
import { restorePublishing, stopPublishing } from "@ledgerly/domain/interests";
import { pendingSends } from "@ledgerly/domain/transactions";
import {
  compareSources,
  comparisonFrom,
  type DoubleMatch,
  matchDoubles,
  planTransfers,
  SWITCH_MATCH_MAX_DAYS,
  type SwitchMovement,
  type TransferPair,
} from "@ledgerly/domain/transactions";
import {
  choicesToCarry,
  doubleMovements,
  joinDoubles,
  linkFoundInBoth,
  movementsToCompare,
  retireBankRows,
  transferCandidates,
  undoJoinedDoubles,
  undoTransferPairs,
  writeTransferPairs,
} from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { addDays, type CivilDate, civilDateIn } from "@ledgerly/domain/shared/dates";
import { getDb } from "@ledgerly/domain/platform/db";
import { passFor } from "@/platform/integrations/registry";
import { pluginProvider } from "@ledgerly/domain/platform/integrations";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { withJobLock } from "@ledgerly/domain/platform/jobs";
import { parseCents } from "@ledgerly/domain/shared/money";
import { listPluginConnections } from "@ledgerly/domain/platform/plugins";
import { bankAccountNames, type BankAccountType, institutionOf } from "@ledgerly/domain/platform/plugins";
import type { Deps, Presence } from "@ledgerly/plugin-host";
import { exposedAccounts, previewBankAccount, readBank } from "@ledgerly/plugin-host";
import { BANK_PLUGIN_ID } from "../../../banks/plugin";
import { bankSink } from "../../../banks/sink";

export const BANK_PROVIDER = pluginProvider(BANK_PLUGIN_ID);

/** Every way a step of the switch can end without its result (§11): a code of a closed list. */
export type SwitchError =
  | "not_found"
  | "not_allowed"
  | "source_unavailable"
  | "bank_unavailable"
  | "consent_expired"
  | "rate_limited"
  | "account_gone"
  | "stale"
  | "busy"
  | "failed";

export class SwitchFailure extends Error {
  constructor(
    readonly code: SwitchError,
    readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = "SwitchFailure";
  }
}

/** One movement of the report, ready for a page: no id of a provider, money as text. */
interface ReportMovement {
  day: CivilDate;
  text: string;
  /** Cents, signed, as text. */
  cents: string;
}

export interface SwitchReport {
  fingerprint: string;
  connectionId: string;
  bankAccountId: string;
  bank: string;
  cutDate: CivilDate;
  from: CivilDate;
  /** Manual movements still on their way to the source (H38): when any, nothing else was read. */
  unsent: { day: CivilDate; text: string; cents: string; state: "to_send" | "not_sent" }[];
  balance: {
    kind: string | null;
    on: CivilDate | null;
    local: string | null;
    bank: string | null;
    /** True only when both are known and equal: "Apply" exists only then (H43, criterion 3). */
    equal: boolean;
  };
  matched: (ReportMovement & { bankDay: CivilDate; bankText: string })[];
  toCheck: { cents: string; local: ReportMovement[]; bank: ReportMovement[] }[];
  onlyLocal: ReportMovement[];
  onlyBank: ReportMovement[];
  fresh: ReportMovement[];
  transfers: {
    pairs: {
      outDay: CivilDate;
      inDay: CivilDate;
      from: string;
      to: string;
      cents: string;
      byPerson: boolean;
    }[];
    byYear: { year: number; count: number; cents: string }[];
    totalCents: string;
    ambiguous: number;
  };
  /** The account has an interest rule that publishes on the source of before (§9.4). */
  publishes: boolean;
  /**
   * The bank's account is already here as another account (H39 for already imported accounts): the
   * switch joins the two. "Apply" exists only when every movement of it is found in this account.
   */
  join: {
    account: string;
    total: number;
    matched: number;
    /** Movements of the account already here that this account has not got. */
    unmatched: ReportMovement[];
    /** Movements written by hand on the account already here: a join takes none. */
    manual: number;
    categories: number;
    notes: number;
  } | null;
}

/** The accounts the person may move to the bank (§2.1): from a source that is not the bank, with movements. */
export function switchable(account: {
  origin: string;
  provider: string | null;
  state: string;
  type: Parameters<typeof hasIbanField>[0];
}): boolean {
  return (
    account.origin === "synced" &&
    account.provider !== null &&
    account.provider !== BANK_PROVIDER &&
    account.state !== "archived" &&
    hasIbanField(account.type)
  );
}

/**
 * The account here that an account of the bank already feeds may be joined to another one (H39 for
 * already imported accounts) when the bank brought it as an account of its own: not the account
 * itself, not one that a switch moved to the bank, not archived, in the same currency.
 */
async function joinable(
  ctx: Ctx,
  accountId: string,
  linked: { id: string } | null,
  currency: string,
): Promise<{ id: string; name: string } | null> {
  if (linked === null || linked.id === accountId) return null;
  const here = await getAccount(ctx, linked.id);
  if (!here || here.provider !== BANK_PROVIDER || here.state === "archived" || here.currency !== currency) {
    return null;
  }
  if ((await openSwitchOf(ctx, here.id)) !== null) return null;
  return { id: here.id, name: here.name };
}

async function requireSwitchable(ctx: Ctx, accountId: string) {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new SwitchFailure("not_found");
  if (!switchable(account) || (await openSwitchOf(ctx, accountId)) !== null)
    throw new SwitchFailure("not_allowed");
  return account;
}

/**
 * The accounts of the person's banks in a currency (step "Account", §4): the ones not in Ledgerly,
 * and the ones the bank brought here as an account of their own, which the switch joins (`here`).
 * Each is named as "Choose the accounts" names it (`kindLabel`: the name of a kind of account).
 */
export async function freeBankAccounts(
  ctx: Ctx,
  accountId: string,
  currency: string,
  kindLabel: (type: BankAccountType) => string,
) {
  const banks = [];
  for (const connection of await listPluginConnections(ctx, BANK_PLUGIN_ID)) {
    const exposed = await exposedAccounts(
      ctx,
      { pluginId: BANK_PLUGIN_ID, connectionId: connection.id },
      bankSink,
    );
    const bank = institutionOf(connection.instanceKey).name;
    const names = bankAccountNames(exposed.accounts, bank, kindLabel);
    const accounts = [];
    for (const account of exposed.accounts) {
      if (account.currency !== currency) continue;
      const here = await joinable(ctx, accountId, account.linked, currency);
      if (account.linked !== null && here === null) continue;
      accounts.push({
        providerAccountId: account.providerAccountId,
        name: names.get(account.providerAccountId) ?? null,
        identifier: account.identifier,
        currency: account.currency,
        here,
      });
    }
    banks.push({
      connectionId: connection.id,
      bank,
      expired: connection.state === "revoked",
      accounts,
    });
  }
  return banks.sort((a, b) => a.bank.localeCompare(b.bank));
}

/** For the tests: the plugin's `fetch`, and the source of before without its network. */
export interface SwitchDeps extends Deps {
  source?: {
    update(provider: string): Promise<void>;
    connected(provider: string): Promise<boolean>;
  };
}

async function sourceConnected(ctx: Ctx, provider: string, deps: SwitchDeps): Promise<boolean> {
  if (deps.source) return deps.source.connected(provider);
  return (await listConnections(ctx)).some((one) => one.provider === provider);
}

/** The source of before brings what it has, and sends the manual movements that wait (H38). */
async function updateSource(ctx: Ctx, provider: string, now: Date, deps: SwitchDeps = {}): Promise<void> {
  if (deps.source) {
    await deps.source.update(provider).catch(() => {
      throw new SwitchFailure("source_unavailable");
    });
    return;
  }
  const connection = (await listConnections(ctx)).find((one) => one.provider === provider);
  const pass = passFor(provider);
  if (!connection || !pass) throw new SwitchFailure("source_unavailable");
  const outcome = await pass.run(
    { id: ctx.userId, email: "" },
    ctx,
    { ...connection, userId: ctx.userId },
    now,
  );
  if (outcome !== "answered") throw new SwitchFailure("source_unavailable");
}

const money = (cents: bigint) => cents.toString();
const asReport = (one: SwitchMovement): ReportMovement => ({
  day: one.day,
  text: one.text,
  cents: money(one.amountCents),
});

/** What the comparison decided, kept beside the report for "Apply". */
interface Plan {
  report: SwitchReport;
  matches: { transactionId: string; externalId: string }[];
  pairs: TransferPair[];
  cutDate: CivilDate;
  identifier: string | null;
  join: { accountId: string; pairs: DoubleMatch[] } | null;
}

async function compare(
  ctx: Ctx,
  accountId: string,
  target: { connectionId: string; bankAccountId: string },
  presence: Presence | null,
  now: Date,
  deps: SwitchDeps,
): Promise<Plan> {
  const account = await requireSwitchable(ctx, accountId);
  await updateSource(ctx, account.provider as string, now, deps);
  const connection = (await listPluginConnections(ctx, BANK_PLUGIN_ID)).find(
    (one) => one.id === target.connectionId,
  );
  if (!connection) throw new SwitchFailure("account_gone");
  const bank = institutionOf(connection.instanceKey).name;

  const cutDate = civilDateIn((await getAccount(ctx, accountId))?.lastSyncedAt ?? now, ctx.timeZone);
  const from = comparisonFrom(cutDate);
  const empty: SwitchReport = {
    fingerprint: "",
    connectionId: target.connectionId,
    bankAccountId: target.bankAccountId,
    bank,
    cutDate,
    from,
    unsent: [],
    balance: { kind: null, on: null, local: null, bank: null, equal: false },
    matched: [],
    toCheck: [],
    onlyLocal: [],
    onlyBank: [],
    fresh: [],
    transfers: { pairs: [], byYear: [], totalCents: "0", ambiguous: 0 },
    publishes: false,
    join: null,
  };

  // H38: a manual movement that did not reach the source stops the switch before any reading.
  const unsent = await pendingSends(ctx, [accountId]);
  if (unsent.length > 0) {
    const report = {
      ...empty,
      unsent: unsent.map((one) => ({
        day: one.on,
        text: `${one.payee ?? ""} ${one.note ?? ""}`.trim(),
        cents: money(one.amountCents),
        state: one.state,
      })),
    };
    return {
      report: { ...report, fingerprint: fingerprintOf(report) },
      matches: [],
      pairs: [],
      cutDate,
      identifier: null,
      join: null,
    };
  }

  const exposed = await exposedAccounts(
    ctx,
    { pluginId: BANK_PLUGIN_ID, connectionId: connection.id },
    bankSink,
  );
  const chosen = exposed.accounts.find((one) => one.providerAccountId === target.bankAccountId);
  if (!chosen) throw new SwitchFailure("account_gone");
  if (chosen.currency !== account.currency) throw new SwitchFailure("not_allowed");
  const joined = await joinable(ctx, accountId, chosen.linked, account.currency);
  if (chosen.linked !== null && joined === null) throw new SwitchFailure("account_gone");

  const read = await previewBankAccount(
    ctx,
    {
      pluginId: BANK_PLUGIN_ID,
      connectionId: connection.id,
      providerAccountId: target.bankAccountId,
      from,
      presence,
    },
    now,
    deps,
  );
  if (!read.ok) {
    if (read.error === "not_active" || read.error === "not_found") throw new SwitchFailure("not_found");
    throw new SwitchFailure(read.error, read.retryAt);
  }
  const preview = read.preview;
  const bankMovements = preview.movements.map((one) => ({
    id: one.externalId,
    day: one.day,
    amountCents: one.direction === "credit" ? parseCents(one.amount) : -parseCents(one.amount),
    text: `${one.payee ?? ""} ${one.note ?? ""}`.trim(),
  }));
  const local = await movementsToCompare(ctx, accountId, from, cutDate);
  const inPeriod = bankMovements.filter((one) => one.day <= cutDate && one.day >= from);
  const fresh = bankMovements.filter((one) => one.day > cutDate);
  const comparison = compareSources(local, inPeriod);

  // The balances, at the bank's date: the source's last balance less what the source saw after it.
  const sourceBalance = await lastSourceBalance(ctx, accountId);
  let localAt: bigint | null = null;
  const on = preview.balance?.on ?? null;
  if (sourceBalance !== null && on !== null && on <= sourceBalance.on) {
    const after = await movementsToCompare(ctx, accountId, addDays(on, 1), sourceBalance.on);
    localAt = sourceBalance.cents - after.reduce((sum, one) => sum + one.amountCents, 0n);
  }
  const bankAt = preview.balance === null ? null : parseCents(preview.balance.amount);

  // The account of the bank already here: each of its movements has to be one of this account's.
  let join: (SwitchReport["join"] & {}) | null = null;
  let joinPairs: DoubleMatch[] = [];
  if (joined !== null) {
    const doubles = await doubleMovements(ctx, joined.id);
    const days = doubles.movements.map((one) => one.day).sort();
    const kept =
      days.length === 0
        ? []
        : await movementsToCompare(
            ctx,
            accountId,
            addDays(days[0], -SWITCH_MATCH_MAX_DAYS),
            addDays(days[days.length - 1], SWITCH_MATCH_MAX_DAYS),
          );
    const matching = matchDoubles(doubles.movements, kept);
    const byDouble = new Map(doubles.movements.map((one) => [one.id, one]));
    joinPairs = matching.matched;
    join = {
      account: joined.name,
      total: doubles.movements.length + doubles.manual,
      matched: matching.matched.length,
      unmatched: matching.unmatched.map((id) => asReport(byDouble.get(id)!)),
      manual: doubles.manual,
      ...(await choicesToCarry(ctx, matching.matched)),
    };
  }

  // Transfers with the other accounts of the same bank, on the whole history (H40). The account
  // joined is not another account: it is this one.
  const others = exposed.accounts.flatMap((one) =>
    one.linked && one.linked.id !== joined?.id ? [one.linked.id] : [],
  );
  const candidates = await transferCandidates(ctx, [accountId, ...others]);
  const plan = planTransfers(accountId, others, candidates);
  const names = new Map<string, string>([
    [accountId, account.name],
    ...exposed.accounts.flatMap((one) => (one.linked ? [[one.linked.id, one.linked.name] as const] : [])),
  ]);
  const byPerson = new Set(candidates.filter((one) => one.categoryByPerson).map((one) => one.id));

  const byLocal = new Map(local.map((one) => [one.id, one]));
  const byBank = new Map(inPeriod.map((one) => [one.id, one]));
  const publishes = (await publishingRulesOn(ctx, accountId)) > 0;
  const report: SwitchReport = {
    ...empty,
    balance: {
      kind: preview.balance?.kind ?? null,
      on,
      local: localAt === null ? null : money(localAt),
      bank: bankAt === null ? null : money(bankAt),
      equal: localAt !== null && bankAt !== null && localAt === bankAt,
    },
    matched: comparison.matched.map((match) => {
      const mine = byLocal.get(match.localId)!;
      const theirs = byBank.get(match.bankId)!;
      return { ...asReport(mine), bankDay: theirs.day, bankText: theirs.text };
    }),
    toCheck: comparison.toCheck.map((group) => ({
      cents: money(group.amountCents),
      local: group.localIds.map((id) => asReport(byLocal.get(id)!)),
      bank: group.bankIds.map((id) => asReport(byBank.get(id)!)),
    })),
    onlyLocal: comparison.onlyLocal.map((id) => asReport(byLocal.get(id)!)),
    onlyBank: comparison.onlyBank.map((id) => asReport(byBank.get(id)!)),
    fresh: fresh.map(asReport),
    transfers: {
      pairs: plan.pairs.map((pair) => ({
        outDay: pair.outDay,
        inDay: pair.inDay,
        from: names.get(pair.fromAccountId) ?? "",
        to: names.get(pair.toAccountId) ?? "",
        cents: money(pair.amountCents),
        byPerson: byPerson.has(pair.outId) || byPerson.has(pair.inId),
      })),
      byYear: plan.byYear.map((year) => ({
        year: year.year,
        count: year.count,
        cents: money(year.amountCents),
      })),
      totalCents: money(plan.pairs.reduce((sum, pair) => sum + pair.amountCents, 0n)),
      ambiguous: plan.ambiguous,
    },
    publishes,
    join,
  };
  report.fingerprint = fingerprintOf(report);
  return {
    report,
    matches: comparison.matched.map((match) => ({ transactionId: match.localId, externalId: match.bankId })),
    pairs: plan.pairs,
    cutDate,
    identifier: preview.identifier,
    join: joined === null ? null : { accountId: joined.id, pairs: joinPairs },
  };
}

/** A join takes an account whose every movement is found here, and none written by hand. */
function joinReady(join: SwitchReport["join"]): boolean {
  return join === null || (join.unmatched.length === 0 && join.manual === 0);
}

/** The print of a report (§6.6): "Apply" sends it back, and a different one is `stale`. */
function fingerprintOf(report: SwitchReport): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...report, fingerprint: "" }))
    .digest("hex")
    .slice(0, 32);
}

/** The dry run (§6): it reads and compares, and writes nothing but the normal update of the source. */
export async function checkSwitch(
  ctx: Ctx,
  accountId: string,
  target: { connectionId: string; bankAccountId: string },
  presence: Presence | null,
  now: Date = new Date(),
  deps: SwitchDeps = {},
): Promise<SwitchReport> {
  return (await compare(ctx, accountId, target, presence, now, deps)).report;
}

/**
 * "Apply" (§8): the comparison again, inside the lock of the person; the same print as the report
 * the person read, the same equal balances; then one transaction for the account, the links, the
 * transfers and the interests; then the reading of the bank brings the new movements.
 */
export async function applySwitch(
  ctx: Ctx,
  accountId: string,
  target: { connectionId: string; bankAccountId: string; fingerprint: string },
  presence: Presence | null,
  now: Date = new Date(),
  deps: SwitchDeps = {},
): Promise<{ matched: number; transfers: number; fresh: number }> {
  const locked = await withJobLock(`account-switch:${ctx.userId}`, async () => {
    const plan = await compare(ctx, accountId, target, presence, now, deps);
    if (plan.report.fingerprint !== target.fingerprint) throw new SwitchFailure("stale");
    if (plan.report.unsent.length > 0 || !plan.report.balance.equal) throw new SwitchFailure("stale");
    if (!joinReady(plan.report.join)) throw new SwitchFailure("stale");
    let transfers = 0;
    await getDb().transaction(async (tx) => {
      const interestModes = await stopPublishing(tx, ctx, accountId);
      const switchId = await recordSwitch(
        tx,
        ctx,
        {
          accountId,
          toProvider: BANK_PROVIDER,
          toProviderAccountId: target.bankAccountId,
          connectionId: target.connectionId,
          cutDate: plan.cutDate,
          identifier: plan.identifier,
          interestModes,
          counts: {
            matched: plan.matches.length,
            fresh: plan.report.fresh.length,
            ...(plan.join === null ? {} : { joined: plan.join.pairs.length }),
          },
          mergedAccountId: plan.join?.accountId ?? null,
        },
        now,
      );
      // The joined account's movements give their bank links first: the comparison of the period
      // then links only what they did not bring.
      const moved =
        plan.join === null
          ? null
          : await joinDoubles(
              tx,
              ctx,
              { switchId, bankProvider: BANK_PROVIDER, pairs: plan.join.pairs },
              now,
            );
      const matches =
        moved === null
          ? plan.matches
          : plan.matches.filter(
              (one) => !moved.externalIds.has(one.externalId) && !moved.keptIds.has(one.transactionId),
            );
      await linkFoundInBoth(tx, ctx, BANK_PROVIDER, matches, now);
      transfers = await writeTransferPairs(tx, ctx, switchId, plan.pairs);
    });
    if (plan.join !== null) await rebuildDerivedBalances(ctx, [plan.join.accountId]);
    // The new movements come with the bank's own reading: a movement up to the cut is not written
    // (`bankSink`), so "only in the bank" and "to check" never become doubles.
    await readBank(
      ctx,
      { pluginId: BANK_PLUGIN_ID, connectionId: target.connectionId, presence },
      bankSink,
      now,
      deps,
    );
    return { matched: plan.matches.length, transfers, fresh: plan.report.fresh.length };
  });
  if (!locked.ran) throw new SwitchFailure("busy");
  return locked.value;
}

/**
 * "Undo switch" (§10): the account comes from the source of before again, every transfer of the
 * switch goes back, the bank's rows no longer count (H41), the interests publish as before; then
 * the source is asked for an update. No limit of time while the source is connected (H42).
 */
export async function undoSwitch(
  ctx: Ctx,
  accountId: string,
  now: Date = new Date(),
  deps: SwitchDeps = {},
): Promise<void> {
  const locked = await withJobLock(`account-switch:${ctx.userId}`, async () => {
    const open = await openSwitchOf(ctx, accountId);
    if (!open) throw new SwitchFailure("not_found");
    if (!(await sourceConnected(ctx, open.fromProvider, deps))) throw new SwitchFailure("not_allowed");
    await getDb().transaction(async (tx) => {
      const closed = await closeSwitch(tx, ctx, open.id, now);
      await undoTransferPairs(tx, ctx, closed.id, now);
      // Before the bank's rows retire: the joined account's links go back to its own movements.
      await undoJoinedDoubles(tx, ctx, { switchId: closed.id, bankProvider: closed.toProvider }, now);
      await retireBankRows(
        tx,
        ctx,
        { accountId, bankProvider: closed.toProvider, sourceProvider: closed.fromProvider },
        now,
      );
      await restorePublishing(tx, ctx, closed.interestModes);
    });
    await rebuildDerivedBalances(
      ctx,
      open.mergedAccountId === null ? [accountId] : [accountId, open.mergedAccountId],
    );
    try {
      await updateSource(ctx, open.fromProvider, now, deps);
    } catch {
      // The account is back on its source; the next scheduled update brings what is missing.
    }
  });
  if (!locked.ran) throw new SwitchFailure("busy");
}

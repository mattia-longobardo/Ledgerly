// src/app/(app)/banks/connect/steps.ts — what the steps «Accounts» and «Done» of "Connect a bank"
// read (ux/n1-plugin-bank.md §6.4, §6.6), as the web process lends them to `/api/v1` (rewrite plan
// R3): the bank sink and the names of the sources are the web's until E5 and R4. Reads only.
import "server-only";
import type { SourceReads } from "@ledgerly/api";
import { accountsOfProvider, listAccounts, openSwitchOf, readingsAt } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { listRuns, readSyncJob, type Connection } from "@ledgerly/domain/platform/integrations";
import {
  bankAccountNames,
  bankAccountType,
  findInstancePlugin,
  institutionOf,
  isPluginActive,
  listPluginConnections,
  maskIdentifier,
} from "@ledgerly/domain/platform/plugins";
import { today } from "@ledgerly/domain/shared/dates";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import { categoryCounts, listCategories, movementSpanByAccount } from "@ledgerly/domain/transactions";
import { exposedAccounts } from "@ledgerly/plugin-host";
import { bankKindLabel, labelOf, unnamedBankAccount } from "@/platform/integrations/registry";
import { switchable } from "../../accounts/[id]/switch/switch";
import { bankSink } from "../sink";

type Exposed = Awaited<ReturnType<typeof exposedAccounts>>["accounts"][number];

/** The person's accounts that come from another source and may be moved to the bank (ux/n4-account-switch.md §2.1). */
export async function sameAsChoices(ctx: Ctx) {
  const all = await listAccounts(ctx);
  const choices = [];
  for (const account of all.filter(switchable)) {
    if ((await openSwitchOf(ctx, account.id)) !== null) continue;
    const source = (await labelOf({ provider: account.provider ?? "", instanceKey: "" }, ctx.locale)).name;
    choices.push({ id: account.id, name: account.name, currency: account.currency, source });
  }
  return choices;
}

/** The accounts chosen as "the same account as…", from the address of the outcome: nothing was saved. */
export async function toSwitchFrom(
  ctx: Ctx,
  list: string | null,
  exposed: readonly {
    providerAccountId: string;
    identifier: string | null;
    currency: string;
    linked: unknown;
  }[],
  names: ReadonlyMap<string, string>,
) {
  if (list === null) return [];
  const mine = new Map((await listAccounts(ctx)).filter(switchable).map((account) => [account.id, account]));
  return list.split(",").flatMap((pair) => {
    const dot = pair.lastIndexOf(".");
    const bankAccountId = pair.slice(0, dot);
    const accountId = pair.slice(dot + 1);
    const bankAccount = exposed.find((one) => one.providerAccountId === bankAccountId && one.linked === null);
    const account = mine.get(accountId);
    if (!bankAccount || !account) return [];
    const legend = [names.get(bankAccountId) ?? null, maskIdentifier(bankAccount.identifier)]
      .filter((part) => part !== null)
      .join(" · ");
    return [{ bankAccountId, accountId, account: account.name, legend }];
  });
}

/**
 * The bank and what it shares, for a connection of a plugin the person has on: `null` otherwise,
 * where the page answered 404 (§6.1).
 */
async function bankOfConnection(ctx: Ctx, connection: Connection) {
  const pluginId = connection.provider.slice("plugin:".length);
  if (!(await findInstancePlugin(pluginId)) || !(await isPluginActive(ctx, pluginId))) return null;
  const bank = institutionOf(connection.instanceKey).name;
  const exposed = await exposedAccounts(ctx, { pluginId, connectionId: connection.id }, bankSink);
  // The same name here, in "Switch to the bank" and as the name of a new account.
  const names = bankAccountNames(exposed.accounts, bank, bankKindLabel(ctx.locale));
  const nameOf = (account: Exposed) => names.get(account.providerAccountId) ?? unnamedBankAccount(ctx.locale);
  const legendOf = (account: Exposed) =>
    [nameOf(account), maskIdentifier(account.identifier), account.currency]
      .filter((part) => part !== null)
      .join(" · ");
  return { pluginId, bank, exposed, names, nameOf, legendOf };
}

const NOT_FOUND = { ok: false as const, error: "not_found" };

export const bankChoice: SourceReads["choice"] = async (ctx, connection, { all }) => {
  const found = await bankOfConnection(ctx, connection);
  if (!found) return NOT_FOUND;
  const { bank, exposed, nameOf, legendOf } = found;
  // `all`: the accounts left out before are offered too; a deleted account is no longer tied.
  const toChoose = exposed.accounts.filter(
    (account) =>
      account.linked === null &&
      (all || !(exposed.chosen && exposed.skipped.includes(account.providerAccountId))),
  );
  if (exposed.chosen && toChoose.length === 0) return { ok: false, error: "complete" };
  // An account of the bank whose IBAN an account here has is not added twice (H39, §2.4.2).
  const [owners, existing, sameAs] = await Promise.all([
    bankSink.ibanOwners(
      ctx,
      toChoose.map((account) => account.identifier),
    ),
    bankSink.openAccounts(ctx),
    sameAsChoices(ctx),
  ]);
  const answer = {
    bank,
    chosen: exposed.chosen,
    accounts: toChoose.map((account) => ({
      providerAccountId: account.providerAccountId,
      legend: legendOf(account),
      currency: account.currency,
      defaultName: nameOf(account),
      defaultType: bankAccountType(account.kind),
      ibanOwner: account.identifier === null ? null : (owners.get(account.identifier) ?? null),
    })),
    linked: exposed.accounts.flatMap((account) =>
      account.linked ? [{ legend: legendOf(account), account: account.linked.name }] : [],
    ),
    existing: existing.map((one) => ({ ...one, archived: one.archived ?? false })),
    sameAs,
  };
  return { ok: true, answer };
};

type Run = Awaited<ReturnType<typeof listRuns>>[number] | undefined;
type Job = Awaited<ReturnType<typeof readSyncJob>>;

/** What the last reading did: failed, never read, or a wait the bank asked for (§6.6). */
function readingOf(run: Run, job: Job, connection: Connection) {
  const failed = run?.state === "failed";
  const retryAfter =
    failed && run.error === "rate_limited" && job?.cursor?.retryAfter
      ? new Date(job.cursor.retryAfter).toISOString()
      : null;
  return {
    failed,
    neverRead: failed && connection.lastOkAt === null,
    retryAfter,
    accountErrors: run?.counts?.accountErrors ?? 0,
  };
}

/** How the movements of the bank stand after the cascade read them (rewrite plan N3). */
function categoriesOf(counts: Awaited<ReturnType<typeof categoryCounts>>, categories: number) {
  return {
    read: counts.categorised + counts.left,
    categorised: counts.categorised,
    suggested: counts.suggested,
    open: counts.open,
    waiting: counts.left,
    any: categories > 0,
  };
}

export const bankOutcome: SourceReads["outcome"] = async (ctx, connection, { same }) => {
  const found = await bankOfConnection(ctx, connection);
  if (!found) return NOT_FOUND;
  const { pluginId, bank, exposed, names } = found;
  if (!exposed.chosen) return { ok: false, error: "not_chosen" };
  const [[run], connections] = await Promise.all([
    listRuns(ctx, { connectionId: connection.id, limit: 1 }),
    listPluginConnections(ctx, pluginId),
  ]);
  const stillShared = new Set(exposed.accounts.map((account) => account.providerAccountId));
  // With more than one bank the provider's accounts are of several banks: this bank's are the
  // ones its access shares. With one bank they are all its own, also one it no longer shares.
  const linked = [...(await accountsOfProvider(ctx, connection.provider)).entries()].filter(
    ([providerAccountId]) => connections.length <= 1 || stillShared.has(providerAccountId),
  );
  const ids = linked.map(([, account]) => account.id);
  const [spans, balances, job, counts, own, switches] = await Promise.all([
    movementSpanByAccount(ctx, ids),
    readingsAt(ctx, ids, today(ctx.timeZone)),
    readSyncJob(ctx, connection.id, "transactions"),
    categoryCounts(ctx, ids),
    listCategories(ctx),
    toSwitchFrom(ctx, same, exposed.accounts, names),
  ]);
  const answer = {
    bank,
    accounts: linked.map(([providerAccountId, account]) => {
      const span = spans.get(account.id);
      const balance = balances.get(account.id) ?? null;
      return {
        id: account.id,
        name: account.name,
        currency: account.currency,
        movements: span?.count ?? 0,
        firstOn: span?.first ?? null,
        balance: balance === null ? null : centsToDecimal(balance),
        shared: stillShared.has(providerAccountId),
      };
    }),
    switches,
    reading: readingOf(run, job, connection),
    categories: categoriesOf(counts, own.length),
    reviewAccountIds: ids,
    expiresAt: connection.expiresAt?.toISOString() ?? null,
  };
  return { ok: true, answer };
};

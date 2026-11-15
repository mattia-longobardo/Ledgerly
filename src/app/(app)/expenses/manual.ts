// src/app/(app)/expenses/manual.ts — the manual movement as one use case (rewrite plan, 04-now.md
// §4.5 and 12-account-modes.md). The movement is the transactions module's, the mode of an account
// and its balance are the accounts module's, and what a source can do is the integrations': only
// the application joins them (rule M8), so the order is here and in no module — which account
// takes a manual movement, the write, then the balance after it.
import "server-only";
import { z } from "zod";
import { getAccount, listAccounts, movementBasis } from "@/modules/accounts/queries";
import {
  type AccountMode,
  accountMode,
  MANUAL_MOVEMENT_MODES,
  type MovementEffect,
  movementEffect,
} from "@/modules/accounts/rules";
import { rebuildDerivedBalances } from "@/modules/accounts/service";
import {
  createManualTransaction,
  deleteManualTransaction,
  updateManualTransaction,
} from "@/modules/transactions/manual";
import { type ManualKind, signedAmount } from "@/modules/transactions/manual-rules";
import {
  manualMovementsByAccount,
  type Transaction,
  transactionsByIds,
} from "@/modules/transactions/queries";
import {
  deleteHiddenTransactions,
  hideTransactions,
  restoreTransactions,
  TransactionError,
} from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { type CivilDate, today } from "@/platform/dates";
import { coreCreatesRecords, isPluginProvider, pluginProvider } from "@/platform/integrations/rules";
import type { Cents } from "@/platform/money";
import { hasCapability } from "@/platform/plugins/contract/manifest";
import { listInstancePlugins } from "@/platform/plugins/queries";

type ManualCtx = Pick<Ctx, "userId" | "timeZone">;

interface SourcedAccount {
  type: Parameters<typeof accountMode>[0]["type"];
  origin: Parameters<typeof accountMode>[0]["origin"];
  provider: string | null;
}

/**
 * The mode of each account, from what its source says it can do: a plugin in its manifest, a
 * provider of the core in the integrations' own rules. The manifests are read only when an account
 * comes from a plugin.
 */
async function modesOf<T extends SourcedAccount>(
  accounts: readonly T[],
): Promise<Map<T, AccountMode | null>> {
  const fromPlugin = accounts.some(
    (account) => account.provider !== null && isPluginProvider(account.provider),
  );
  const plugins = fromPlugin ? await listInstancePlugins() : [];
  const creates = (provider: string): boolean => {
    if (!isPluginProvider(provider)) return coreCreatesRecords(provider);
    const plugin = plugins.find((one) => provider === pluginProvider(one.manifest.id));
    return plugin !== undefined && hasCapability(plugin.manifest, "createRecord");
  };
  return new Map(
    accounts.map((account) => [
      account,
      accountMode(account, account.provider === null ? null : { createsRecords: creates(account.provider) }),
    ]),
  );
}

/** An account the dialog offers, with the mode that decides the notes under it. */
export interface ManualAccount {
  id: string;
  name: string;
  currency: string;
  mode: AccountMode;
}

/** The accounts a person may write a movement on by hand, in the order of Accounts. */
export async function manualAccounts(ctx: Pick<Ctx, "userId">): Promise<ManualAccount[]> {
  const accounts = await listAccounts(ctx);
  const modes = await modesOf(accounts);
  return accounts.flatMap((account) => {
    const mode = modes.get(account) ?? null;
    return mode !== null && MANUAL_MOVEMENT_MODES.includes(mode)
      ? [{ id: account.id, name: account.name, currency: account.currency, mode }]
      : [];
  });
}

const accountIdOf = z.object({ accountId: z.uuid() });

/** Refuses an account that is not the person's, is archived, or takes no manual movement. */
async function requireManualAccount(ctx: Pick<Ctx, "userId">, input: unknown): Promise<string> {
  const named = accountIdOf.safeParse(input);
  if (!named.success) throw new TransactionError("invalid");
  const account = await getAccount(ctx, named.data.accountId);
  if (!account || account.state === "archived") throw new TransactionError("account_unavailable");
  const mode = (await modesOf([account])).get(account) ?? null;
  if (mode === null || !MANUAL_MOVEMENT_MODES.includes(mode)) {
    throw new TransactionError("account_unavailable");
  }
  return account.id;
}

/** Writes a manual movement and the balance after it. The same key sent twice writes once. */
export async function createManual(
  ctx: ManualCtx,
  input: unknown,
  idempotencyKey?: string,
): Promise<{ transaction: Transaction; created: boolean }> {
  const accountId = await requireManualAccount(ctx, input);
  const result = await createManualTransaction(ctx, input, idempotencyKey);
  if (result.created) await rebuildDerivedBalances(ctx, [accountId]);
  return result;
}

/** Changes a manual movement and corrects the balance of the account, and of the one it left. */
export async function updateManual(ctx: ManualCtx, id: string, input: unknown): Promise<Transaction> {
  const accountId = await requireManualAccount(ctx, input);
  const { transaction, previousAccountId } = await updateManualTransaction(ctx, id, input);
  await rebuildDerivedBalances(ctx, [...new Set([accountId, previousAccountId])]);
  return transaction;
}

/** Deletes a manual movement and takes it out of the balance. */
export async function deleteManual(ctx: ManualCtx, id: string): Promise<void> {
  const { accountId } = await deleteManualTransaction(ctx, id);
  await rebuildDerivedBalances(ctx, [accountId]);
}

/**
 * Hide, restore and delete over a selection, with the balances kept right: a hidden manual
 * movement is out of the balance as it is out of the totals. The provider's rows change no balance.
 */
export async function changeVisibility(
  ctx: ManualCtx,
  ids: readonly string[],
  change: "hide" | "restore" | "delete",
): Promise<number> {
  const rows = await transactionsByIds(ctx, [...ids]);
  const accounts = [
    ...new Set([...rows.values()].filter((row) => row.origin === "manual").map((row) => row.accountId)),
  ];
  const count =
    change === "hide"
      ? await hideTransactions(ctx, ids)
      : change === "restore"
        ? await restoreTransactions(ctx, ids)
        : await deleteHiddenTransactions(ctx, ids);
  if (count > 0 && accounts.length > 0) await rebuildDerivedBalances(ctx, accounts);
  return count;
}

/** What the dialog asks about before it saves. */
export interface ManualPreviewInput {
  accountId: string;
  kind: ManualKind;
  amountCents: Cents;
  on: CivilDate;
  /** The movement being changed, left out of the balance it is compared with. */
  editingId?: string;
}

/**
 * Today's balance of the account before and after the movement, from the rule that writes the
 * balance (`movementEffect`). `null` for an account that is not the person's.
 */
export async function previewManual(
  ctx: ManualCtx,
  input: ManualPreviewInput,
): Promise<{ account: string; effect: MovementEffect } | null> {
  const account = await getAccount(ctx, input.accountId);
  if (!account) return null;
  const [basis, manual] = await Promise.all([
    movementBasis(ctx, [account.id]),
    manualMovementsByAccount(ctx, [account.id]),
  ]);
  const all = manual.get(account.id) ?? [];
  const editing = all.find((movement) => movement.id === input.editingId);
  const effect = movementEffect(
    basis.get(account.id)?.readings ?? [],
    all,
    {
      on: input.on,
      cents: signedAmount(input.kind, input.amountCents),
      // A movement being changed keeps the moment it was written; a new one is written now.
      writtenAt: editing?.writtenAt ?? new Date(),
    },
    today(ctx.timeZone),
    editing,
  );
  return { account: account.name, effect };
}

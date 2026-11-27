// src/app/(app)/expenses/manual.ts — the manual movement as one use case (rewrite plan, 04-now.md
// §4.5 and 12-account-modes.md). The movement is the transactions module's, the mode of an account
// and its balance are the accounts module's, and what a source can do is the integrations': only
// the application joins them (rule M8), so the order is here and in no module — which account
// takes a manual movement, the write, then the balance after it.
import "server-only";
import { z } from "zod";
import { getAccount, listAccounts, movementBasis } from "@ledgerly/domain/accounts";
import {
  type AccountMode,
  accountMode,
  type BeforeOpening,
  joinedBeforeOpening,
  MANUAL_MOVEMENT_MODES,
  type MovementEffect,
  movementEffect,
  movementsBeforeOpening,
} from "@ledgerly/domain/accounts";
import { rebuildDerivedBalances } from "@ledgerly/domain/accounts";
import {
  createManualTransaction,
  deleteManualTransaction,
  updateManualTransaction,
} from "@ledgerly/domain/transactions";
import { type ManualKind, signedAmount } from "@ledgerly/domain/transactions";
import { manualMovementsByAccount, type Transaction, transactionsByIds } from "@ledgerly/domain/transactions";
import {
  deleteHiddenTransactions,
  hideTransactions,
  restoreTransactions,
  TransactionError,
} from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import type { UiLocale } from "@ledgerly/format/format";
import { labelOf } from "@/platform/integrations/registry";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import type { Cents } from "@ledgerly/domain/shared/money";
import { capabilitiesOf } from "@ledgerly/domain/platform/plugins";

type ManualCtx = Pick<Ctx, "userId" | "timeZone">;

interface SourcedAccount {
  type: Parameters<typeof accountMode>[0]["type"];
  origin: Parameters<typeof accountMode>[0]["origin"];
  provider: string | null;
}

/**
 * The mode of each account, from what its source says it can do: a plugin in its manifest (rewrite
 * plan R5c, P3b). The manifests are read only when an account comes from a plugin.
 */
async function modesOf<T extends SourcedAccount>(
  accounts: readonly T[],
): Promise<Map<T, AccountMode | null>> {
  const creates = new Map<string, boolean>();
  for (const account of accounts) {
    if (account.provider === null || creates.has(account.provider)) continue;
    // A provider of the core has no manifest, and none takes the movements written here.
    const capabilities = await capabilitiesOf(account.provider);
    creates.set(account.provider, capabilities?.includes("createRecord") ?? false);
  }
  return new Map(
    accounts.map((account) => [
      account,
      accountMode(
        account,
        account.provider === null ? null : { createsRecords: creates.get(account.provider) === true },
      ),
    ]),
  );
}

/** An account the dialog offers, with the mode that decides the notes under it. */
export interface ManualAccount {
  id: string;
  name: string;
  currency: string;
  mode: AccountMode;
  /**
   * For a "read and write" account: the name of the source the movement is sent to, and whether
   * its connection is not updated now (paused, or waiting for the person): the movement then goes
   * when the connection resumes.
   */
  source?: { name: string; waiting: boolean };
}

/**
 * The sources that take the movements written here, by provider: the name a person reads, and
 * whether the connection is not updated now. Read only for the providers named.
 */
async function sourcesOf(
  ctx: Pick<Ctx, "userId">,
  locale: UiLocale,
  providers: readonly string[],
): Promise<Map<string, { name: string; waiting: boolean }>> {
  const wanted = [...new Set(providers)];
  if (wanted.length === 0) return new Map();
  const connections = await listConnections(ctx);
  const sources = new Map<string, { name: string; waiting: boolean }>();
  for (const provider of wanted) {
    const connection = connections.find((one) => one.provider === provider);
    const label = await labelOf({ provider, instanceKey: connection?.instanceKey ?? "" }, locale);
    sources.set(provider, {
      name: label.provider,
      waiting:
        connection === undefined || connection.state === "revoked" || connection.schedule.rules.length === 0,
    });
  }
  return sources;
}

/** The accounts a person may write a movement on by hand, in the order of Accounts. */
export async function manualAccounts(ctx: Pick<Ctx, "userId" | "locale">): Promise<ManualAccount[]> {
  const accounts = await listAccounts(ctx);
  const modes = await modesOf(accounts);
  const sources = await sourcesOf(
    ctx,
    ctx.locale,
    accounts.flatMap((account) =>
      modes.get(account) === "two_way" && account.provider !== null ? [account.provider] : [],
    ),
  );
  return accounts.flatMap((account) => {
    const mode = modes.get(account) ?? null;
    return mode !== null && MANUAL_MOVEMENT_MODES.includes(mode)
      ? [
          {
            id: account.id,
            name: account.name,
            currency: account.currency,
            mode,
            ...(mode === "two_way" && sources.has(account.provider ?? "")
              ? { source: sources.get(account.provider ?? "") }
              : {}),
          },
        ]
      : [];
  });
}

/**
 * The name of the source each of these accounts sends its manual movements to, for the rows that
 * wait: "Not sent to {source}". Asked only when a row on the screen waits.
 */
export async function sendSourceNames(
  ctx: Pick<Ctx, "userId" | "locale">,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Set(accountIds);
  if (wanted.size === 0) return new Map();
  const accounts = (await listAccounts(ctx, { includeArchived: true })).filter(
    (account) => wanted.has(account.id) && account.provider !== null,
  );
  const sources = await sourcesOf(
    ctx,
    ctx.locale,
    accounts.map((account) => account.provider as string),
  );
  return new Map(
    accounts.flatMap((account) => {
      const source = sources.get(account.provider as string);
      return source ? [[account.id, source.name] as const] : [];
    }),
  );
}

/**
 * "Retry sending": an update of the source of the movement's account, now — the same pass a
 * scheduled update makes, so the movement is sent and the balance read after it. `start` is how
 * the application starts a pass of a provider. Says whether the movement went.
 */
export async function retrySend(
  ctx: ManualCtx,
  id: string,
  start: (provider: string) => Promise<unknown>,
): Promise<{ sent: boolean }> {
  if (!z.uuid().safeParse(id).success) throw new TransactionError("invalid");
  const waiting = (await transactionsByIds(ctx, [id])).get(id);
  if (!waiting) throw new TransactionError("not_found");
  if (waiting.origin !== "manual" || waiting.sendState === null) return { sent: waiting.origin !== "manual" };
  const account = await getAccount(ctx, waiting.accountId);
  if (!account || account.provider === null) throw new TransactionError("account_unavailable");
  await start(account.provider);
  const after = (await transactionsByIds(ctx, [id])).get(id);
  return { sent: after !== undefined && after.origin !== "manual" };
}

const accountIdOf = z.object({ accountId: z.uuid() });

/**
 * Refuses an account that is not the person's, is archived, or takes no manual movement. Says
 * whether the account's source takes the movement: then it waits for the next update.
 */
async function requireManualAccount(
  ctx: Pick<Ctx, "userId">,
  input: unknown,
): Promise<{ id: string; toSend: boolean }> {
  const named = accountIdOf.safeParse(input);
  if (!named.success) throw new TransactionError("invalid");
  const account = await getAccount(ctx, named.data.accountId);
  if (!account || account.state === "archived") throw new TransactionError("account_unavailable");
  const mode = (await modesOf([account])).get(account) ?? null;
  if (mode === null || !MANUAL_MOVEMENT_MODES.includes(mode)) {
    throw new TransactionError("account_unavailable");
  }
  return { id: account.id, toSend: mode === "two_way" };
}

/** The manual movements left before the opening of the accounts a write rebuilt (PERS-678). */
type LeftBefore = Pick<BeforeOpening, "count" | "first"> | null;

/** Rebuilds the balance after a change of manual movements, and says what it left before the opening. */
async function rebuildAfterManual(ctx: ManualCtx, accountIds: readonly string[]): Promise<LeftBefore> {
  const { beforeOpening } = await rebuildDerivedBalances(ctx, accountIds, { manualChanged: true });
  return joinedBeforeOpening(beforeOpening.values());
}

/**
 * Writes a manual movement and the balance after it. The same key sent twice writes once. On a
 * "read and write" account the movement waits for the next update of its source (N3.1).
 */
export async function createManual(
  ctx: ManualCtx,
  input: unknown,
  idempotencyKey?: string,
): Promise<{ transaction: Transaction; created: boolean; beforeOpening: LeftBefore }> {
  const account = await requireManualAccount(ctx, input);
  const result = await createManualTransaction(ctx, input, idempotencyKey, { toSend: account.toSend });
  const beforeOpening = result.created ? await rebuildAfterManual(ctx, [account.id]) : null;
  return { ...result, beforeOpening };
}

/** Changes a manual movement and corrects the balance of the account, and of the one it left. */
export async function updateManual(
  ctx: ManualCtx,
  id: string,
  input: unknown,
): Promise<{ transaction: Transaction; beforeOpening: LeftBefore }> {
  const account = await requireManualAccount(ctx, input);
  const { transaction, previousAccountId } = await updateManualTransaction(ctx, id, input, {
    toSend: account.toSend,
  });
  const beforeOpening = await rebuildAfterManual(ctx, [...new Set([account.id, previousAccountId])]);
  return { transaction, beforeOpening };
}

/** Deletes a manual movement and takes it out of the balance. */
export async function deleteManual(ctx: ManualCtx, id: string): Promise<void> {
  const { accountId } = await deleteManualTransaction(ctx, id);
  await rebuildAfterManual(ctx, [accountId]);
}

/**
 * Hide, restore and delete over a selection, with the balances kept right: a hidden manual
 * movement is out of the balance as it is out of the totals. The provider's rows change no balance.
 */
export async function changeVisibility(
  ctx: ManualCtx,
  ids: readonly string[],
  change: "hide" | "restore" | "delete",
): Promise<{ count: number; beforeOpening: LeftBefore }> {
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
  const beforeOpening = count > 0 && accounts.length > 0 ? await rebuildAfterManual(ctx, accounts) : null;
  return { count, beforeOpening };
}

/** What the dialog asks about before it saves. */
interface ManualPreviewInput {
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
): Promise<{ account: string; effect: MovementEffect; opening: boolean } | null> {
  const account = await getAccount(ctx, input.accountId);
  if (!account) return null;
  const [basis, manual, modes] = await Promise.all([
    movementBasis(ctx, [account.id]),
    manualMovementsByAccount(ctx, [account.id]),
    modesOf([account]),
  ]);
  const all = manual.get(account.id) ?? [];
  const editing = all.find((movement) => movement.id === input.editingId);
  const readings = basis.get(account.id)?.readings ?? [];
  const candidate = {
    on: input.on,
    cents: signedAmount(input.kind, input.amountCents),
    // A movement being changed keeps the moment it was written; a new one is written now.
    writtenAt: editing?.writtenAt ?? new Date(),
  };
  const effect = movementEffect(readings, all, candidate, today(ctx.timeZone), editing);
  // PERS-678: the reading that «holds» the movement is the opening of an account «a mano», which
  // may mean «the account starts here». A source's first reading does hold what came before it.
  const opening =
    effect.kind === "unchanged" &&
    modes.get(account) === "manual" &&
    movementsBeforeOpening(readings, [candidate]) !== null;
  return { account: account.name, effect, opening };
}

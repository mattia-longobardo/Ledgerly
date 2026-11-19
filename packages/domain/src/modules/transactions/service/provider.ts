import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getAccount, listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { WALLET_PROVIDER } from "../../../platform/integrations/rules";
import { linkExternal, resolveExternal } from "../../../platform/integrations/service";
import {
  type IncomingTransaction,
  type ProviderResolution,
  type TransactionPatch,
  type TransferLeg,
  type WindowRow,
  normalizeIban,
  type OwnIban,
  pairTransfers,
  planIbanTransfers,
  planProviderMerge,
  planUpstreamRemovals,
  toNewTransaction,
} from "../rules";
import { retypeMovements } from "../macro";
import { transactionsByIds, transactionsInWindow } from "../queries";
import { transactions } from "../schema";
import { pendingSendByKey, settleSent } from "../sending";
import {
  TRANSACTION_ENTITY,
  TransactionError,
  applyPatch,
  parseId,
  requireTransaction,
  type UpsertOptions,
  type UpsertOutcome,
  writeLabels,
} from "./guards";
import { ProviderIds, deduped } from "./provider-ids";

/**
 * Applies a provider's movements to one account (spec §7.2, §9.1). Idempotent by construction:
 *
 * - a movement is recognised by its `provider_links` row, the only place its external id lives
 *   (§4.3), so the same answer read twice updates the same rows instead of duplicating them;
 * - `planProviderMerge` returns only the fields that really differ and never one named in
 *   `locally_edited`, so a second pass produces an empty patch and no write at all;
 * - `pairTransfers` returns only the legs whose group id changes, and the group id is the smallest
 *   local id of the pair, so pairing is stable across passes;
 * - `planUpstreamRemovals` writes `removed_upstream_at` only where it is still null.
 *
 * The movements arrive already fetched and nothing here reaches the network. The work is split in
 * three: resolve (reads only), create, then one short transaction for the changes. A creation is
 * atomic on its own — the row, its labels and its `provider_links` entry share one transaction —
 * so a pass that fails halfway leaves whole movements behind, never half of one.
 */
export async function upsertFromProvider(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  incoming: IncomingTransaction[],
  options: UpsertOptions = {},
): Promise<UpsertOutcome> {
  const provider = options.provider ?? WALLET_PROVIDER;
  const now = options.now ?? new Date();
  const outcome: UpsertOutcome = { created: 0, updated: 0, skipped: 0, removed: 0, restored: 0 };

  const account = await getAccount(ctx, parseId(accountId));
  if (!account) throw new TransactionError("not_found");

  const movements = deduped(incoming);
  if (movements.length === 0 && !options.window) return outcome;

  // Resolution: every read the rules need, none of the writes.
  const linked = await resolveExternal(
    ctx,
    provider,
    TRANSACTION_ENTITY,
    movements.map((movement) => movement.externalId),
  );
  const stored = await transactionsByIds(ctx, [...linked.values()]);
  const window = options.window ? await transactionsInWindow(ctx, account.id, options.window) : undefined;

  const ids = new ProviderIds(ctx, provider);
  const resolutions = new Map<string, ProviderResolution>();
  for (const movement of movements) {
    resolutions.set(movement.externalId, {
      accountId: account.id,
      ...(await ids.category(movement)),
      labelIds: await ids.labels(movement.labels),
    });
  }

  // A movement written here and sent to the source comes back carrying its key (N3.1): the row
  // that waits takes the source's id, so what follows changes that row and writes no second one.
  for (const movement of movements) {
    if (!movement.sentKey || linked.has(movement.externalId)) continue;
    const waiting = await pendingSendByKey(ctx, account.id, movement.sentKey);
    if (!waiting) continue;
    const taken = await settleSent(
      ctx,
      waiting.id,
      {
        provider,
        externalId: movement.externalId,
        sourceCategoryId: resolutions.get(movement.externalId)?.sourceCategoryId ?? null,
        payeeSent: movement.payee !== null,
      },
      now,
    );
    if (!taken) continue;
    linked.set(movement.externalId, waiting.id);
    stored.set(waiting.id, await requireTransaction(ctx, waiting.id));
  }

  // The merge itself: new movements are written as they are met, changes are collected and
  // applied together below.
  const legs: TransferLeg[] = [];
  const seenIds: string[] = [];
  const patches: { id: string; patch: TransactionPatch }[] = [];
  // The source's own category of a row, kept beside the merge: it follows the source whoever chose
  // the category the movement counts under.
  const sourceCategories: { id: string; sourceCategoryId: string | null }[] = [];

  for (const movement of movements) {
    const resolution = resolutions.get(movement.externalId) as ProviderResolution;
    const current = stored.get(linked.get(movement.externalId) ?? "");

    if (!current) {
      // Linked, but its row is gone: a person deleted it (`deleteHiddenTransactions`). The link
      // stays as the memory of that decision, so the movement is not imported again.
      if (linked.has(movement.externalId)) {
        outcome.skipped += 1;
        continue;
      }
      const created = await createFromProvider(ctx, movement, resolution, provider, now);
      outcome.created += 1;
      seenIds.push(created.id);
      legs.push({
        id: created.id,
        externalId: movement.externalId,
        counterpartExternalId: movement.counterpartExternalId,
        transferGroupId: created.transferGroupId,
      });
      continue;
    }

    seenIds.push(current.id);
    legs.push({
      id: current.id,
      externalId: movement.externalId,
      counterpartExternalId: movement.counterpartExternalId,
      transferGroupId: current.transferGroupId,
    });

    const sourceCategoryId = resolution.sourceCategoryId ?? null;
    if (current.sourceCategoryId !== sourceCategoryId) {
      sourceCategories.push({ id: current.id, sourceCategoryId });
    }
    const plan = planProviderMerge(current, movement, resolution);
    // A movement the provider is sending again is not gone, whatever a window said before.
    const back = current.removedUpstreamAt !== null;
    if (!plan.changed && !back) {
      outcome.skipped += 1;
      continue;
    }
    patches.push({ id: current.id, patch: plan.patch });
    if (back) outcome.restored += 1;
    outcome.updated += 1;
  }

  const restore = seenIds.filter((id) => stored.get(id)?.removedUpstreamAt);

  // The transfer legs of previous passes: their local id comes from `provider_links`, and the
  // reference one leg carries is enough for `pairTransfers` to build the pair key, which is how
  // two legs that arrived in different syncs still find each other (spec §7.2).
  const arrived = new Set(movements.map((movement) => movement.externalId));
  const outside = [
    ...new Set(
      movements
        .map((movement) => movement.counterpartExternalId)
        .filter((externalId): externalId is string => externalId !== null)
        .filter((externalId) => !arrived.has(externalId)),
    ),
  ];
  const linkedOutside = await resolveExternal(ctx, provider, TRANSACTION_ENTITY, outside);
  const outsideRows = await transactionsByIds(ctx, [...linkedOutside.values()]);
  for (const [externalId, id] of linkedOutside) {
    const row = outsideRows.get(id);
    if (!row || legs.some((leg) => leg.id === id)) continue;
    legs.push({
      id: row.id,
      externalId,
      counterpartExternalId: null,
      transferGroupId: row.transferGroupId,
    });
  }
  const assignments = pairTransfers(legs);

  // The window's verdict, decided on the snapshot taken before anything was written. The identity
  // handed to the rule is the local id on both sides: `transactions` holds no external id (§4.3),
  // and the rule only ever uses it to tell "the provider sent this one" from "it did not".
  const removals =
    options.window === undefined || window === undefined
      ? { removed: [] as string[], restored: [] as string[] }
      : planUpstreamRemovals(
          window.map((row): WindowRow => ({ ...row, key: row.id })),
          seenIds,
          options.window,
          ctx.timeZone,
        );

  if (
    patches.length === 0 &&
    sourceCategories.length === 0 &&
    assignments.length === 0 &&
    removals.removed.length === 0 &&
    removals.restored.length === 0 &&
    restore.length === 0 &&
    outcome.created === 0
  ) {
    return outcome;
  }

  await getDb().transaction(async (tx) => {
    for (const { id, patch } of patches) await applyPatch(tx, ctx, id, patch);
    for (const { id, sourceCategoryId } of sourceCategories) {
      await tx
        .update(transactions)
        .set({ sourceCategoryId })
        .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
    }
    if (restore.length > 0) {
      await tx
        .update(transactions)
        .set({ removedUpstreamAt: null })
        .where(
          and(
            inArray(transactions.id, restore),
            isNotNull(transactions.removedUpstreamAt),
            userScoped(ctx).owns(transactions),
          ),
        );
    }
    for (const assignment of assignments) {
      await tx
        .update(transactions)
        .set({ transferGroupId: assignment.transferGroupId })
        .where(and(eq(transactions.id, assignment.id), userScoped(ctx).owns(transactions)));
    }
    if (removals.removed.length > 0) {
      const marked = await tx
        .update(transactions)
        .set({ removedUpstreamAt: now })
        .where(
          and(
            inArray(transactions.id, removals.removed),
            isNull(transactions.removedUpstreamAt),
            userScoped(ctx).owns(transactions),
          ),
        )
        .returning({ id: transactions.id });
      outcome.removed = marked.length;
    }
    if (removals.restored.length > 0) {
      await tx
        .update(transactions)
        .set({ removedUpstreamAt: null })
        .where(
          and(
            inArray(transactions.id, removals.restored),
            isNotNull(transactions.removedUpstreamAt),
            userScoped(ctx).owns(transactions),
          ),
        );
    }
    // A category of the source that counts under Transfers makes the movement a transfer (CR3).
    await retypeMovements(tx, ctx);
  });

  return outcome;
}

/**
 * Links the two legs of the giroconti the provider left unpaired, by the IBAN in their details
 * (`planIbanTransfers`), and undoes a pairing whose row is no longer a transfer. Reads first, then
 * one short transaction for the changes; returns how many rows changed. Run after every sync pass
 * and whenever an account's IBAN is saved.
 */
export async function linkOwnTransfers(ctx: Pick<Ctx, "userId">): Promise<number> {
  const own: OwnIban[] = [];
  for (const account of await listAccounts(ctx, { includeArchived: true })) {
    // The IBAN field of the account (rewrite plan N4, H46): no longer "IBAN or reference".
    const iban = normalizeIban(account.iban);
    if (iban !== null) own.push({ accountId: account.id, iban });
  }
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      type: transactions.type,
      transferGroupId: transactions.transferGroupId,
      payee: transactions.payee,
      note: transactions.note,
    })
    .from(transactions)
    .where(userScoped(ctx).owns(transactions))
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  const assignments = planIbanTransfers(own, rows);
  if (assignments.length === 0) return 0;

  await getDb().transaction(async (tx) => {
    for (const assignment of assignments) {
      await tx
        .update(transactions)
        .set({ transferGroupId: assignment.transferGroupId })
        .where(and(eq(transactions.id, assignment.id), userScoped(ctx).owns(transactions)));
    }
    // A leg that left its pair counts by its category again (CR3).
    await retypeMovements(tx, ctx);
  });
  return assignments.length;
}

/**
 * One new movement, created atomically: the row, its labels and the `provider_links` entry that
 * makes it recognisable next time all commit together, because `linkExternal` takes this
 * transaction and writes inside it — the cross-module sink of §4.2.
 *
 * So a link that cannot be filed leaves nothing behind: the row never existed. That matters more
 * than it looks, because a movement with no link is a movement the next pass cannot recognise and
 * would create a second time. The failure is raised, not swallowed: nothing is written after it,
 * and by then this transaction is already lost anyway.
 */
async function createFromProvider(
  ctx: Pick<Ctx, "userId">,
  movement: IncomingTransaction,
  resolution: ProviderResolution,
  provider: string,
  now: Date,
): Promise<{ id: string; transferGroupId: string | null }> {
  const values = toNewTransaction(movement, resolution);
  const { labelIds, ...columns } = values;
  const raw = movement.raw
    ? {
        rawText: movement.raw.text,
        counterpartyName: movement.raw.counterparty,
        merchantCategoryCode: movement.raw.merchantCategoryCode,
        bankTransactionCode: movement.raw.bankTransactionCode,
      }
    : {};
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values(
        userScoped(ctx).stamp({
          ...columns,
          ...raw,
          categoryOrigin: columns.categoryId === null ? null : ("provider" as const),
          sourceCategoryId: resolution.sourceCategoryId ?? null,
        }),
      )
      .returning({ id: transactions.id, transferGroupId: transactions.transferGroupId });
    await writeLabels(tx, ctx, row.id, labelIds);
    await linkExternal(
      ctx,
      {
        provider,
        entityType: TRANSACTION_ENTITY,
        entityId: row.id,
        externalId: movement.externalId,
      },
      now,
      tx,
    );
    return row;
  });
}

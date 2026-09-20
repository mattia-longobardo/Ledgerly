// modules/transactions/service.ts — the use cases of spec §7.2: the provider upsert, the local
// edits that outrank it, and visibility.
//
// Every decision belongs to `rules.ts`; this file only resolves the ids those rules need — the
// account, the category, the labels — and writes what they hand back. There is no network call
// anywhere here (spec §4.3): the movements arrive already fetched, and the sync engine that
// fetched them is outside.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAccount, listAccounts } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { type EntityType, WALLET_PROVIDER } from "@/platform/integrations/rules";
import {
  externalIdsOf,
  IntegrationError,
  isUniqueViolation,
  linkExternal,
  resolveExternal,
  unlinkEntities,
} from "@/platform/integrations/service";
import {
  type CategoryType,
  NAME_MAX,
  type IncomingTransaction,
  PROVIDER_OWNED_FIELDS,
  type ProviderResolution,
  type TransactionPatch,
  type TransferLeg,
  type UserEdit,
  type WindowRow,
  normalizeIban,
  type OwnIban,
  pairTransfers,
  planIbanTransfers,
  planProviderMerge,
  planUpstreamRemovals,
  planUserEdit,
  toNewTransaction,
} from "./rules";
import { type Transaction, getTransaction, transactionsByIds, transactionsInWindow } from "./queries";
import { categories, labels, transactionLabels, transactions } from "./schema";
import { type ProviderGroupRef, TaxonomyError, adoptOrCreateCategory, adoptOrCreateLabel } from "./taxonomy";

/**
 * Every failure a caller is expected to handle. `provider_owned` is the refusal of §7.2: payee,
 * amount and date belong to Wallet and no local edit may claim them. `invalid_reference` is a
 * category or label that is not this user's — the isolation of §4.4 seen from the write side.
 */
export type TransactionErrorCode = "not_found" | "provider_owned" | "invalid_reference" | "invalid";

export class TransactionError extends Error {
  constructor(readonly code: TransactionErrorCode) {
    super(code);
    this.name = "TransactionError";
  }
}

/** The entity type `provider_links` files a movement under (`platform/integrations/rules.ts`). */
const TRANSACTION_ENTITY: EntityType = "transaction";

const idSchema = z.uuid();

function parseId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new TransactionError("invalid");
  return parsed.data;
}

function parseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(parseId))];
}

/**
 * What one pass of the upsert did. The three counts of §3.3 are one per incoming movement —
 * created, changed, or already right — and `removed`/`restored` report what the re-read window
 * said about the rows the provider did not send back.
 */
export interface UpsertOutcome {
  created: number;
  updated: number;
  skipped: number;
  removed: number;
  restored: number;
}

export interface UpsertOptions {
  /** Which provider these movements came from; Wallet is the only one F2 speaks to (§9.1). */
  provider?: string;
  now?: Date;
  /**
   * The re-read window the provider was asked about, if it was asked about one. Without it no row
   * is ever declared gone: only an answer that covered a date can say something is missing from
   * it (spec §7.2).
   */
  window?: { from: CivilDate; to: CivilDate };
}

/* Reads the writes need */

async function requireTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<Transaction> {
  const row = await getTransaction(ctx, id);
  if (!row) throw new TransactionError("not_found");
  return row;
}

/** A category is only ever the acting user's own: a forged id from another user is a refusal. */
async function requireOwnCategory(ctx: Pick<Ctx, "userId">, categoryId: string | null): Promise<void> {
  if (categoryId === null) return;
  const [row] = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
  if (!row) throw new TransactionError("invalid_reference");
}

async function requireOwnLabels(ctx: Pick<Ctx, "userId">, labelIds: readonly string[]): Promise<void> {
  const wanted = [...new Set(labelIds)];
  if (wanted.length === 0) return;
  const rows = await getDb()
    .select({ id: labels.id })
    .from(labels)
    .where(and(inArray(labels.id, wanted), userScoped(ctx).owns(labels)));
  if (rows.length !== wanted.length) throw new TransactionError("invalid_reference");
}

/* Writes */

/**
 * The labels of a movement, set to exactly `labelIds`. The delete leaves the labels that stay, so
 * re-applying the same set writes nothing and the join rows keep their `created_at`.
 */
async function writeLabels(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  transactionId: string,
  labelIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(labelIds)];
  await tx
    .delete(transactionLabels)
    .where(
      and(
        eq(transactionLabels.transactionId, transactionId),
        userScoped(ctx).owns(transactionLabels),
        wanted.length > 0 ? notInArray(transactionLabels.labelId, wanted) : undefined,
      ),
    );
  if (wanted.length === 0) return;
  await tx
    .insert(transactionLabels)
    .values(wanted.map((labelId) => userScoped(ctx).stamp({ transactionId, labelId })))
    .onConflictDoNothing();
}

/**
 * One row's patch. `labelIds` is the join table's business and every other key is a column, so the
 * two are split here and nowhere else; `locallyEdited` is passed separately because only a local
 * edit ever writes it.
 */
async function applyPatch(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  id: string,
  patch: TransactionPatch,
  locallyEdited?: readonly string[],
): Promise<void> {
  const { labelIds, ...columns } = patch;
  const values = {
    ...columns,
    ...(locallyEdited === undefined ? {} : { locallyEdited: [...locallyEdited] }),
  };
  if (Object.keys(values).length > 0) {
    await tx
      .update(transactions)
      .set(values)
      .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
  }
  if (labelIds !== undefined) await writeLabels(tx, ctx, id, labelIds);
}

/* Provider upsert */

/**
 * Resolves the local ids of the categories and labels a batch of movements names, once per
 * distinct name, before any rule is asked anything: `rules.ts` never resolves a name (T3), and
 * `taxonomy.ts` writes through `getDb()`, so all of this has to happen before the writes begin.
 */
class ProviderIds {
  private readonly categoryCache = new Map<string, string | null>();
  private readonly labelCache = new Map<string, string | null>();

  constructor(
    private readonly ctx: Pick<Ctx, "userId">,
    private readonly provider: string,
  ) {}

  /**
   * Spec §9.1's order, through `taxonomy.ts`: the provider's own link, then the exact local name,
   * then a new category. With an id but no name there is nothing to adopt or create, so the link
   * is the only answer and an unlinked id leaves the movement uncategorised.
   */
  async category(incoming: IncomingTransaction): Promise<string | null> {
    const externalId = incoming.categoryExternalId;
    const name = incoming.categoryName?.trim() ?? "";
    const groupName = incoming.categoryGroupName?.trim() ?? "";
    // The provider's group becomes the parent (F2.5), so it is part of what makes a category.
    const group =
      groupName === "" ? undefined : { name: groupName, externalId: incoming.categoryGroupExternalId };
    const key = JSON.stringify([externalId, name, group?.externalId ?? null, groupName]);
    const known = this.categoryCache.get(key);
    if (known !== undefined) return known;

    const resolved = await this.resolveCategory(externalId, name, group);
    this.categoryCache.set(key, resolved);
    return resolved;
  }

  private async resolveCategory(
    externalId: string | null,
    name: string,
    group: ProviderGroupRef | undefined,
  ): Promise<string | null> {
    if (name !== "") {
      try {
        const category = await adoptOrCreateCategory(
          this.ctx,
          name,
          externalId === null ? undefined : { provider: this.provider, externalId },
          group,
        );
        return category.id;
      } catch (error) {
        // A name the column cannot hold (over `NAME_MAX`) leaves the movement uncategorised
        // rather than failing the whole sync: the amount and the date are worth more than the
        // label, and the person can file it by hand.
        if (error instanceof TaxonomyError && error.code === "invalid") return null;
        throw error;
      }
    }
    if (externalId === null) return null;
    const linked = await resolveExternal(this.ctx, this.provider, "category", [externalId]);
    const entityId = linked.get(externalId);
    if (entityId === undefined) return null;
    const [row] = await getDb()
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, entityId), userScoped(this.ctx).owns(categories)));
    return row?.id ?? null;
  }

  /** Labels are matched by name alone (§9.1). Sorted, so an unchanged set compares equal. */
  async labels(names: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (name === "") continue;
      let id = this.labelCache.get(name);
      if (id === undefined) {
        id = await this.adoptLabel(name);
        this.labelCache.set(name, id);
      }
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    return ids.sort();
  }

  private async adoptLabel(name: string): Promise<string | null> {
    try {
      const label = await adoptOrCreateLabel(this.ctx, name);
      return label.id;
    } catch (error) {
      // Same reasoning as a category name the column cannot hold: drop the label, keep the row.
      if (error instanceof TaxonomyError && error.code === "invalid") return null;
      throw error;
    }
  }
}

/** The last movement wins when a provider's pages repeat an external id inside one answer. */
function deduped(incoming: readonly IncomingTransaction[]): IncomingTransaction[] {
  const byExternalId = new Map<string, IncomingTransaction>();
  for (const movement of incoming) {
    if (movement.externalId.trim() === "") continue;
    byExternalId.set(movement.externalId, movement);
  }
  return [...byExternalId.values()];
}

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
      categoryId: await ids.category(movement),
      labelIds: await ids.labels(movement.labels),
    });
  }

  // The merge itself: new movements are written as they are met, changes are collected and
  // applied together below.
  const legs: TransferLeg[] = [];
  const seenIds: string[] = [];
  const patches: { id: string; patch: TransactionPatch }[] = [];

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
    assignments.length === 0 &&
    removals.removed.length === 0 &&
    removals.restored.length === 0 &&
    restore.length === 0
  ) {
    return outcome;
  }

  await getDb().transaction(async (tx) => {
    for (const { id, patch } of patches) await applyPatch(tx, ctx, id, patch);
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
    const iban = normalizeIban(account.reference);
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
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values(userScoped(ctx).stamp(columns))
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

/* Local edits */

/**
 * A local edit (spec §7.2). Only category, labels and note may be written: payee, amount and date
 * belong to the provider, and a patch that claims one of them is refused rather than quietly
 * dropped. `planUserEdit` decides what really changed and appends those fields to
 * `locally_edited`, which is what stops the next sync writing them again.
 */
export async function updateTransaction(
  ctx: Pick<Ctx, "userId">,
  id: string,
  patch: TransactionPatch,
): Promise<Transaction> {
  const transactionId = parseId(id);
  if (PROVIDER_OWNED_FIELDS.some((field) => patch[field] !== undefined)) {
    throw new TransactionError("provider_owned");
  }
  const current = await requireTransaction(ctx, transactionId);

  const edit: UserEdit = {};
  if (patch.categoryId !== undefined) edit.categoryId = patch.categoryId;
  if (patch.note !== undefined) edit.note = patch.note;
  if (patch.labelIds !== undefined) edit.labelIds = patch.labelIds.map(parseId);

  if (edit.categoryId !== undefined) await requireOwnCategory(ctx, edit.categoryId);
  if (edit.labelIds !== undefined) await requireOwnLabels(ctx, edit.labelIds);

  const plan = planUserEdit(current, edit);
  if (!plan.changed) return current;

  await getDb().transaction(async (tx) => {
    await applyPatch(tx, ctx, transactionId, plan.patch, plan.locallyEdited);
  });
  return requireTransaction(ctx, transactionId);
}

/**
 * The multiple action of §7.2, "set category", on as many rows as are selected. Each row keeps its
 * own `locally_edited`, so the category is claimed only on the rows it actually changes; the
 * answer is how many of them that was.
 */
export async function setCategory(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  categoryId: string | null,
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const chosen = categoryId === null ? null : parseId(categoryId);
  await requireOwnCategory(ctx, chosen);

  const rows = await transactionsByIds(ctx, wanted);
  const plans = [...rows.values()]
    .map((row) => ({ id: row.id, plan: planUserEdit(row, { categoryId: chosen }) }))
    .filter((one) => one.plan.changed);
  if (plans.length === 0) return 0;

  await getDb().transaction(async (tx) => {
    for (const { id, plan } of plans) await applyPatch(tx, ctx, id, plan.patch, plan.locallyEdited);
  });
  return plans.length;
}

/* Visibility */

/** Hides one movement (spec §7.2, D10). Never a deletion: the row stays and can be restored. */
export async function hideTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const transactionId = parseId(id);
  await requireTransaction(ctx, transactionId);
  await hideTransactions(ctx, [transactionId]);
}

export async function restoreTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const transactionId = parseId(id);
  await requireTransaction(ctx, transactionId);
  await restoreTransactions(ctx, [transactionId]);
}

/** "Hide" over a selection; already hidden rows keep the moment they were hidden. */
export async function hideTransactions(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ hiddenAt: now })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNull(transactions.hiddenAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/**
 * "Restore" from the "Show hidden" filter. Only `hidden_at` is cleared: a movement Wallet has
 * stopped returning is not something a person can un-disappear, and the next sync that sees it
 * again is what clears `removed_upstream_at`.
 */
export async function restoreTransactions(ctx: Pick<Ctx, "userId">, ids: readonly string[]): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ hiddenAt: null })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNotNull(transactions.hiddenAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/**
 * Deletes rows for good, and unpairs the other leg of any transfer they were half of. The rows'
 * labels go with them; a subscription charge or a fund deposit that pointed at one keeps its data
 * and loses the link (`on delete set null`).
 */
async function deleteRows(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  condition: ReturnType<typeof isNotNull>,
) {
  if (ids.length === 0) return [];
  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(transactions)
      .where(and(inArray(transactions.id, [...ids]), condition, userScoped(ctx).owns(transactions)))
      .returning({ id: transactions.id, transferGroupId: transactions.transferGroupId });
    const groups = [...new Set(deleted.flatMap((row) => (row.transferGroupId ? [row.transferGroupId] : [])))];
    if (groups.length > 0) {
      await tx
        .update(transactions)
        .set({ transferGroupId: null })
        .where(and(inArray(transactions.transferGroupId, groups), userScoped(ctx).owns(transactions)));
    }
    return deleted.map((row) => row.id);
  });
}

/**
 * "Delete" on a hidden movement: it is removed for good. A provider's movement keeps its link,
 * which tells the next sync not to bring it back (`upsertFromProvider`); only hidden rows can be
 * deleted, so nothing leaves the totals without having been hidden first.
 */
export async function deleteHiddenTransactions(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<number> {
  const wanted = parseIds(ids);
  return (await deleteRows(ctx, wanted, isNotNull(transactions.hiddenAt))).length;
}

/**
 * The movements the provider no longer returns are deleted, with their links: if the provider
 * ever sends one again it comes back as new, since it exists again. The rows go first, so a
 * failure in between leaves a link with no row — a movement skipped — rather than a row the next
 * sync would import a second time.
 */
export async function purgeRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  provider = WALLET_PROVIDER,
): Promise<number> {
  const gone = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(isNotNull(transactions.removedUpstreamAt), userScoped(ctx).owns(transactions)))
    .orderBy(asc(transactions.id));
  const deleted = await deleteRows(
    ctx,
    gone.map((row) => row.id),
    isNotNull(transactions.removedUpstreamAt),
  );
  if (deleted.length > 0) await unlinkEntities(ctx, provider, TRANSACTION_ENTITY, deleted);
  return deleted.length;
}

/**
 * Stamps the movements the provider stopped returning (spec §7.2): what `planUpstreamRemovals`
 * names on the pass that noticed. A row already stamped keeps its original moment, so calling this again
 * with the same ids writes nothing.
 */
export async function markRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  ids: string[],
  now: Date = new Date(),
): Promise<void> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return;
  await getDb()
    .update(transactions)
    .set({ removedUpstreamAt: now })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNull(transactions.removedUpstreamAt),
        userScoped(ctx).owns(transactions),
      ),
    );
}

/** The other half: the provider is sending these again, so they count once more. */
export async function clearRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ removedUpstreamAt: null })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNotNull(transactions.removedUpstreamAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/* Categories, seen from the provider sync (spec §9.1, §7.2) */

/**
 * One local category as the two-way category sync needs it: what it is called here, what Wallet
 * called it when the two last agreed, whether the person has touched it, and the provider's own
 * ids — its own, and its group's, which is what a category created in Wallet has to hang from.
 *
 * `externalId` is `null` for a category Wallet has never seen: those are the ones the pass offers
 * to create there. `groupExternalId` is this row's link as one of the provider's **groups** (F2.5
 * files a Wallet category's group as a parent category here), which is a different link from
 * `externalId` and may sit beside it on the same row.
 */
export interface ProviderCategory {
  id: string;
  name: string;
  type: CategoryType;
  parentId: string | null;
  archived: boolean;
  locallyEdited: readonly string[];
  providerName: string | null;
  externalId: string | null;
  groupExternalId: string | null;
}

/** What `categories.name` holds here: Wallet allows eighty characters, this app sixty (spec §6). */
export const CATEGORY_NAME_MAX = NAME_MAX;

/**
 * Every category of this user, with the provider's ids attached — archived ones included, because
 * an archived category still holds its name and still answers for its link. Ordered by id so two
 * passes see the same rows in the same sequence, which is what makes a capped pass resume where
 * the last one stopped instead of re-doing its beginning.
 */
export async function listProviderCategories(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<ProviderCategory[]> {
  const rows = await getDb()
    .select()
    .from(categories)
    .where(userScoped(ctx).owns(categories))
    .orderBy(asc(categories.id));
  const ids = rows.map((row) => row.id);
  const own = await externalIdsOf(ctx, provider, "category", ids);
  // A group is linked under its own entity type (F2.5), so the two maps are read separately.
  const groups = await externalIdsOf(ctx, provider, "category_group", ids);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    archived: row.archivedAt !== null,
    locallyEdited: row.locallyEdited,
    providerName: row.providerName,
    externalId: own.get(row.id) ?? null,
    groupExternalId: groups.get(row.id) ?? null,
  }));
}

/**
 * Wallet renamed a category and nothing here disagreed, so the local row follows it (spec §9.1)
 * and the baseline moves with it — the next pass sees the two agreeing rather than a name that
 * changed on its own.
 *
 * A name already taken by a sibling answers `"duplicate"` instead of throwing: the provider is
 * allowed to have two categories our unique key cannot hold apart, and that is a case to report,
 * never a reason to fail a whole pass. The `locally_edited` marker is deliberately untouched: the
 * caller only asks for this when there is none.
 */
/**
 * A category the provider publishes that nothing here mirrors yet (spec §9.1): it is taken on as
 * soon as the list is read, rather than waiting for a movement to be filed under it. Wallet's
 * `GET /categories` publishes the whole list, so a category added there appears here at the next
 * sync even if nobody has spent anything in it — which is what makes the two lists match and what
 * lets a budget or a filter name it straight away (owner, 2026-09-20).
 *
 * The same `adoptOrCreateCategory` the movements go through, so a name that already exists here is
 * adopted and linked rather than duplicated, and the provider's group becomes the parent. Wallet
 * publishes no type on a category, so a new one starts as its group's and can be corrected here;
 * a name this app's column cannot hold is refused rather than failing the pass.
 */
export async function adoptProviderCategory(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  remote: {
    externalId: string;
    name: string;
    groupExternalId: string | null;
    groupName: string | null;
  },
): Promise<"linked" | "refused"> {
  const groupName = remote.groupName?.trim() ?? "";
  try {
    await adoptOrCreateCategory(
      ctx,
      remote.name,
      { provider, externalId: remote.externalId },
      groupName === "" ? undefined : { name: groupName, externalId: remote.groupExternalId },
    );
    return "linked";
  } catch (error) {
    if (error instanceof TaxonomyError && (error.code === "invalid" || error.code === "duplicate")) {
      return "refused";
    }
    throw error;
  }
}

export async function followProviderCategoryName(
  ctx: Pick<Ctx, "userId">,
  id: string,
  name: string,
): Promise<"renamed" | "duplicate" | "not_found"> {
  const categoryId = parseId(id);
  try {
    const rows = await getDb()
      .update(categories)
      .set({ name, providerName: name })
      .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
      .returning({ id: categories.id });
    return rows.length === 0 ? "not_found" : "renamed";
  } catch (error) {
    if (isUniqueViolation(error, "categories_user_parent_name_uq")) return "duplicate";
    throw error;
  }
}

/**
 * The provider now holds `providerName` for this category — either because it was just written
 * there, or because the two turned out to agree already. Recording it is what closes the loop:
 * the baseline stops the next pass seeing a change that has already been settled, and dropping the
 * `name` marker lets a later rename *in Wallet* come back here (spec §9.1, two-way since F6).
 */
export async function settleProviderCategoryName(
  ctx: Pick<Ctx, "userId">,
  id: string,
  providerName: string,
): Promise<void> {
  const categoryId = parseId(id);
  await getDb()
    .update(categories)
    // One statement rather than a read and a write: the marker is dropped from whatever the column
    // holds at that moment, so a rename saved in Settings › Data between the two cannot be lost.
    // Only `name` goes; `type` is not the provider's to settle.
    .set({ providerName, locallyEdited: sql`array_remove(${categories.locallyEdited}, 'name')` })
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
}

/**
 * Files the link of a category this app has just created at the provider, and records the name it
 * was created under as the baseline. `"conflict"` when that external id is already spoken for —
 * the answer arrived twice, or another category got there first — which leaves this category
 * unlinked and reported rather than stealing a link that belongs elsewhere.
 */
export async function linkProviderCategory(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  id: string,
  externalId: string,
  providerName: string,
): Promise<"linked" | "conflict"> {
  const categoryId = parseId(id);
  try {
    await linkExternal(ctx, { provider, entityType: "category", entityId: categoryId, externalId });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "link_conflict") return "conflict";
    throw error;
  }
  await getDb()
    .update(categories)
    .set({ providerName })
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
  return "linked";
}

// modules/transactions/service.ts — the use cases of spec §7.2: the provider upsert, the local
// edits that outrank it, and visibility.
//
// Every decision belongs to `rules.ts`; this file only resolves the ids those rules need — the
// account, the category, the labels — and writes what they hand back. There is no network call
// anywhere here (spec §4.3): the movements arrive already fetched, and the sync engine that
// fetched them is outside.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount, listAccounts } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { type EntityType, WALLET_PROVIDER } from "@/platform/integrations/rules";
import { linkExternal, resolveExternal } from "@/platform/integrations/service";
import {
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
 * Finds the giroconti between the user's own accounts that the provider sent as a plain expense
 * and income, by the IBAN in their details (`planIbanTransfers`), and files them as transfers.
 * Reads first, then one short transaction for the changes; returns how many rows changed. Run
 * after every sync pass and whenever an account's IBAN is saved; with no IBAN on any account it
 * reads nothing more.
 */
export async function linkOwnTransfers(ctx: Pick<Ctx, "userId">): Promise<number> {
  const own: OwnIban[] = [];
  for (const account of await listAccounts(ctx, { includeArchived: true })) {
    const iban = normalizeIban(account.reference);
    if (iban !== null) own.push({ accountId: account.id, iban });
  }
  if (own.length === 0) return 0;

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
        .set({ type: "transfer", transferGroupId: assignment.transferGroupId })
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

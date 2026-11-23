import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listAccounts, requireOpenAccount } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  coreProvidesCategories,
  type EntityType,
  isBankPluginProvider,
  pluginProvider,
} from "../../../platform/integrations/rules";
import { listInstancePlugins } from "../../../platform/plugins/queries";
import { type TransactionPatch, normalizeIban, type OwnIban } from "../rules";
import { type Transaction, getTransaction } from "../queries";
import { labels, transactionLabels, transactions } from "../schema";
import { requireCategory } from "../taxonomy";

/**
 * Every failure a caller is expected to handle. `provider_owned` is the refusal of §7.2: payee,
 * amount and date belong to the provider and no local edit may claim them. `invalid_reference` is a
 * category or label that is not this user's — the isolation of §4.4 seen from the write side.
 */
type TransactionErrorCode =
  | "not_found"
  | "provider_owned"
  | "invalid_reference"
  | "invalid"
  /** A person has as many rules as allowed (categories-and-rules.md §4.8). */
  | "limit"
  /** A manual movement dated after today, or one of the manual writes asked of a provider's row. */
  | "future_date"
  | "not_manual"
  /** The account a manual movement names is not there, or takes no manual movement. */
  | "account_unavailable";

export class TransactionError extends Error {
  constructor(readonly code: TransactionErrorCode) {
    super(code);
    this.name = "TransactionError";
  }
}

/** The entity type `provider_links` files a movement under (`platform/integrations/rules.ts`). */
export const TRANSACTION_ENTITY: EntityType = "transaction";

const idSchema = z.uuid();

export function parseId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new TransactionError("invalid");
  return parsed.data;
}

export function parseIds(ids: readonly string[]): string[] {
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
  /** Which provider these movements came from: always the caller's to say (audit TRX-6). */
  provider: string;
  now?: Date;
  /**
   * The re-read window the provider was asked about, if it was asked about one. Without it no row
   * is ever declared gone: only an answer that covered a date can say something is missing from
   * it (spec §7.2).
   */
  window?: { from: CivilDate; to: CivilDate };
}

/* Reads the writes need */

export async function requireTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<Transaction> {
  const row = await getTransaction(ctx, id);
  if (!row) throw new TransactionError("not_found");
  return row;
}

/** A category is only ever the acting user's own: a forged id from another user is a refusal. */
export async function requireOwnCategory(ctx: Pick<Ctx, "userId">, categoryId: string | null): Promise<void> {
  if (categoryId === null) return;
  await requireCategory(ctx, categoryId, () => new TransactionError("invalid_reference"));
}

/**
 * The account a movement is written on: the acting user's own, and one that still takes movements.
 * The module's one way to the accounts, with `upsertFromProvider`.
 */
export async function requireMovementAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; currency: string }> {
  const account = await requireOpenAccount(ctx, accountId, () => new TransactionError("account_unavailable"));
  return { id: account.id, currency: account.currency };
}

export async function requireOwnLabels(ctx: Pick<Ctx, "userId">, labelIds: readonly string[]): Promise<void> {
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
export async function writeLabels(
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
export async function applyPatch(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  id: string,
  patch: TransactionPatch,
  locallyEdited?: readonly string[],
): Promise<void> {
  const { labelIds, ...columns } = patch;
  const values = {
    ...columns,
    // Whoever writes the category is who chose it: the person (a local edit) or the source. An
    // automatic category and a suggestion end there, with what explained them.
    ...(columns.categoryId === undefined
      ? {}
      : locallyEdited === undefined
        ? chosenBy(columns.categoryId === null ? null : "provider")
        : {
            ...chosenBy("user"),
            // What is left of an automatic category a person replaced: the threshold of the
            // classifier counts how often that happens (`categorize/service.ts`).
            categoryReason: sql<
              string | null
            >`case when ${transactions.categoryOrigin} in ('memory', 'model', 'table') then 'corrected' else null end`,
          }),
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

/**
 * The columns that say who chose a movement's category, for a category written by a person or by
 * a source: nothing automatic and nothing suggested is left on the row.
 */
export function chosenBy(origin: "user" | "provider" | null) {
  return {
    categoryOrigin: origin,
    categoryConfidence: null,
    categoryModelVersion: null,
    suggestedCategoryId: null,
    categoryReason: null,
    categoryReasonParams: null,
    categoryRuleId: null,
  };
}

/**
 * The accounts whose movements the automatic categories read (rewrite plan, 04-now.md §4.4, "Dove
 * gira"): the ones kept by hand, and the ones of a source that gives no category. A source says
 * whether it does — a plugin in its manifest, a provider of the core in the integrations' own
 * rules — so the movements of one that does are never read, and never recategorised.
 */
export async function categorisableAccountIds(ctx: Pick<Ctx, "userId">): Promise<string[]> {
  return categorisableOf(await listAccounts(ctx, { includeArchived: true }));
}

/**
 * What the rules of a person read beyond a movement (categories-and-rules.md §4.3): the accounts
 * the rules may write on, the accounts no source reads (kept by hand), and the person's IBANs.
 */
export async function ruleAccountFacts(ctx: Pick<Ctx, "userId">): Promise<{
  categorisable: string[];
  manualAccountIds: string[];
  ownIbans: OwnIban[];
}> {
  const accounts = await listAccounts(ctx, { includeArchived: true });
  return {
    categorisable: await categorisableOf(accounts),
    manualAccountIds: accounts.filter((account) => account.provider === null).map((account) => account.id),
    ownIbans: accounts.flatMap((account) => {
      const iban = normalizeIban(account.iban);
      return iban === null ? [] : [{ accountId: account.id, iban }];
    }),
  };
}

async function categorisableOf(accounts: Awaited<ReturnType<typeof listAccounts>>): Promise<string[]> {
  const fromPlugin = accounts.some(
    (account) => account.provider !== null && isBankPluginProvider(account.provider),
  );
  const plugins = fromPlugin ? await listInstancePlugins() : [];
  const gives = (provider: string): boolean => {
    if (!isBankPluginProvider(provider)) return coreProvidesCategories(provider);
    const plugin = plugins.find((one) => provider === pluginProvider(one.manifest.id));
    // A plugin whose manifest was never read says nothing: its movements are left alone.
    return plugin === undefined || plugin.manifest.providesCategories;
  };
  return accounts
    .filter((account) => account.provider === null || !gives(account.provider))
    .map((account) => account.id);
}

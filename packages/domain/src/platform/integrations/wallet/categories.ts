/**
 * The category sync of spec §9.1, both ways (F6).
 *
 * Until now categories only ever travelled Wallet → here: a movement's category was linked,
 * adopted by its exact name or created, and a rename on either side went nowhere. Wallet's own
 * OpenAPI (`https://rest.budgetbakers.com/wallet/openapi`, Wallet API 2.0.0) publishes two writes
 * that make the other direction possible, and exactly two:
 *
 * - `PATCH /v1/api/categories` — a batch of at most ten `{ id, name }`, which renames a category
 *   (system or custom) for this user and answers `200` (all fine) or `207` (mixed) with one result
 *   per input. Sending the name it already holds is a documented no-op, which is what lets a pass
 *   repeat without swinging between two names.
 * - `POST /v1/api/categories/custom` — `{ name, parentId }`, where `parentId` is a **base** (system)
 *   category. A custom subcategory is the only kind of category that can be created: Wallet's
 *   envelope groups and its base categories are fixed, so a group made here has no counterpart to
 *   create there.
 *
 * What Wallet has no way to accept is written down once, here, so nobody looks for it again: there
 * is no income/expense/transfer on a category at all (the type stays this app's own, spec §7.2),
 * colour is an enum of sixteen names rather than the hex this app stores, and a group cannot be
 * created or renamed.
 *
 * A third write joined them on 2026-09-21, at the owner's explicit request:
 *
 * - `DELETE /v1/api/categories` — `{ ids }`, at most ten, answering `200`/`207`/`400` with one
 *   result per id. **The hourly pass never calls it.** A category that has merely disappeared from
 *   one side is still only reported, exactly as before, because a sync deciding on its own to
 *   destroy data on the other side is how people lose years of history. It is called from one
 *   place only: a person pressing "delete" in Settings › Categories, having been told in the
 *   dialog that Wallet is included. Wallet refuses an id its own records still reference, and that
 *   refusal comes back verbatim rather than being retried around.
 *
 * The writes go through the plugin (`POST /categories/write` of contract 2, rewrite plan R5c), which
 * speaks to Wallet: one attempt for a write, the token never in a message, batches of ten. What
 * stays here is the plan, and a ceiling on how much one pass may write (Wallet allows 300 requests
 * an hour, and the movements pass is spending from the same budget).
 */
import {
  CATEGORY_NAME_MAX,
  adoptProviderCategory,
  followProviderCategoryName,
  linkProviderCategory,
  listProviderCategories,
  type ProviderCategory,
  settleProviderCategoryName,
  type TransactionsProvider,
} from "../../../modules/transactions";
import type { Ctx } from "../../context";
import { WALLET_PROVIDER } from "../rules";
import { IntegrationError, listConnections } from "../service";
import { callCode, type SourceCalls, type SourceCategory, walletCalls } from "./calls";

/** `PatchCategoryRequest.name` and `CreateSubcategoryRequest.name` both stop at 80 characters. */
const WALLET_CATEGORY_NAME_MAX = 80;
/** `PATCH /categories` takes at most ten items per request. */
export const RENAME_BATCH = 10;
/** `DELETE /{type}` takes at most ten ids per request (`DeleteRequest.ids`, maxItems 10). */
export const DELETE_BATCH = 10;
/**
 * What one pass may write, so an hourly sync cannot eat the 300-requests-an-hour budget the
 * movements pass also draws on. What is left over is reported as `deferred` and taken by the next
 * pass: the plan is built in a fixed order (by local id), so a capped pass resumes rather than
 * repeating its own beginning.
 */
export const MAX_RENAMES_PER_PASS = 30;
const MAX_CREATES_PER_PASS = 10;

/* The writer */

/** One item of a `PATCH /categories` answer, per category. */
export interface CategoryWriteResult {
  externalId: string;
  ok: boolean;
}

export interface WalletCategoryWriter {
  /**
   * Renames categories in Wallet, at most {@link RENAME_BATCH} per call. A refusal of a single
   * item comes back in its result rather than as a throw: the other nine landed, and a name Wallet
   * will not take is a case to report, not a pass to fail.
   */
  rename(items: readonly { externalId: string; name: string }[]): Promise<CategoryWriteResult[]>;
  /**
   * Creates a custom subcategory under a **base** category. `externalId` is `null` when the answer
   * carried no id that could be read — the category may well exist, and the caller treats that as
   * unsure rather than as done, exactly as the record writer does (spec §9.1).
   */
  create(input: { name: string; parentExternalId: string }): Promise<{ externalId: string | null }>;
  /**
   * Deletes categories in Wallet, at most {@link DELETE_BATCH} per call. Never called by a pass:
   * see this file's own note. A refusal of a single item comes back in its result, because Wallet
   * answers `207` for a batch where some ids went and others did not.
   */
  remove(externalIds: readonly string[]): Promise<CategoryWriteResult[]>;
}

/** The writer of a source's calls: each batch is one call, so a pass writes what it wrote before. */
export function categoryWriterOf(source: Pick<SourceCalls, "writeCategories">): WalletCategoryWriter {
  const write = (request: Partial<Parameters<SourceCalls["writeCategories"]>[0]>) =>
    source.writeCategories({ rename: [], create: [], remove: [], ...request });
  return {
    rename: async (items) => (await write({ rename: [...items] })).renamed,
    // In the order asked: an answer with no id leaves the category possibly there, never retried.
    create: async (input) => (await write({ create: [input] })).created[0] ?? { externalId: null },
    remove: async (externalIds) => (await write({ remove: [...externalIds] })).removed,
  };
}

/* The plan */

/**
 * Everything one pass has to say that is not a write. None of these ever deletes anything: a
 * category can carry movements, so a disappearance on either side is reported and left alone
 * (spec §7.2).
 */
type CategoryCaseKind =
  /** Renamed on both sides since they last agreed: the local name won and went to Wallet. */
  | "conflict"
  /** Linked here, no longer in Wallet's list. Never deleted here. */
  | "gone_from_wallet"
  /** Wallet files it under its built-in Transfer category and this app does not, or the reverse. */
  | "type_mismatch"
  /** Wallet's name does not fit this app's column, so the local name stays (as it did in F2.5). */
  | "name_too_long"
  /** Wallet's name is already taken by a sibling here: the unique key of §6 wins. */
  | "duplicate_name"
  /** A group renamed here. Wallet's envelope groups are fixed — no endpoint can carry this. */
  | "group_not_writable"
  /** Made here, with nothing in Wallet that could be its parent. */
  | "not_creatable"
  /** Over this pass's write budget; the next pass takes it. */
  | "deferred"
  /** Wallet refused the write, or answered something nobody could read. */
  | "write_failed";

export interface CategoryCase {
  kind: CategoryCaseKind;
  categoryId: string | null;
  externalId: string | null;
  /** What this app calls it, and what Wallet calls it — whichever of the two is known. */
  local: string | null;
  remote: string | null;
  detail?: string;
}

interface CategoryPlan {
  /** Wallet renamed it and nothing here disagreed: the local row follows. */
  adopt: { categoryId: string; name: string }[];
  /** Renamed here: Wallet is told, in batches. */
  push: { categoryId: string; externalId: string; name: string }[];
  /** Already agreeing, with a baseline that has drifted: recorded, nothing written anywhere. */
  settle: { categoryId: string; providerName: string }[];
  /** Made here, under a group Wallet knows: created there as a custom subcategory. */
  create: { categoryId: string; name: string; parentExternalId: string }[];
  /** In Wallet and nowhere here: taken on, with its group as parent. */
  add: { externalId: string; name: string; groupExternalId: string | null; groupName: string | null }[];
  cases: CategoryCase[];
}

/** A fresh plan every time: the arrays are filled in place, so no two callers may share them. */
function emptyPlan(): CategoryPlan {
  return { adopt: [], push: [], settle: [], create: [], add: [], cases: [] };
}

/** A local name Wallet can hold, and a Wallet name this app's column can hold. */
function fitsHere(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed.length <= CATEGORY_NAME_MAX;
}

/**
 * The base category a new custom subcategory can hang from: one of Wallet's own (not custom, not
 * archived) inside the envelope group the local parent is mirrored from. Deterministic, so two
 * passes over the same list pick the same parent.
 */
function baseCategoryIn(remote: readonly SourceCategory[], groupExternalId: string): SourceCategory | null {
  const candidates = remote
    .filter((row) => !row.custom && !row.archived && row.groupExternalId === groupExternalId)
    .sort((left, right) => (left.externalId < right.externalId ? -1 : 1));
  return candidates[0] ?? null;
}

/**
 * The three-way merge of §7.2, applied to a category's name.
 *
 * The baseline is `providerName`: the name Wallet published when the two sides last agreed. With
 * it, "only here changed", "only there changed" and "both changed" are three different facts
 * rather than one guess — which is the whole reason the column exists. Without it (a row from
 * before this pass existed) the older rule still holds: a local edit wins, otherwise Wallet's name
 * is adopted, and nothing is called a conflict that cannot be shown to be one.
 *
 * A local edit wins in every case, and is written to Wallet. That is not a contradiction of "local
 * edits are never overwritten": it is the same sentence read from the other end — the local value
 * is the one that survives, and the provider is brought to it.
 */
function mergeName(
  local: ProviderCategory,
  remote: SourceCategory,
): "agreed" | "adopt" | "push" | "conflict" {
  if (local.name === remote.name) return "agreed";
  // `locally_edited` is the person's own mark (spec §7.2); a name that has walked away from the
  // baseline says the same thing about a row whose marker was cleared by an earlier settled push.
  const changedHere =
    local.locallyEdited.includes("name") ||
    (local.providerName !== null && local.name !== local.providerName);
  if (!changedHere) return "adopt";
  const changedThere = local.providerName === null || remote.name !== local.providerName;
  return changedThere ? "conflict" : "push";
}

/**
 * What one pass should do, decided without touching the database or the network so that every rule
 * above can be read off a test.
 *
 * An empty `remote` list returns an empty plan: Wallet answering with no categories at all is not
 * a user who deleted ninety-one of them, and reading it that way would report every category here
 * as gone. The client already refuses a page that may be truncated, so this is the last guard
 * rather than the only one.
 */
export function planCategorySync(
  local: readonly ProviderCategory[],
  remote: readonly SourceCategory[],
): CategoryPlan {
  if (remote.length === 0) return emptyPlan();
  const plan = emptyPlan();
  const byExternalId = new Map(remote.map((row) => [row.externalId, row]));
  const byId = new Map(local.map((row) => [row.id, row]));
  const takenNames = new Set(local.map((row) => `${row.parentId ?? ""}\u0000${row.name}`));

  for (const category of local) {
    if (category.externalId === null) {
      const creation = planCreation(category, byId, remote);
      if (creation === null) continue;
      if ("kind" in creation) plan.cases.push(creation);
      else plan.create.push(creation);
      continue;
    }
    const mirror = byExternalId.get(category.externalId);
    if (mirror === undefined) {
      plan.cases.push({
        kind: "gone_from_wallet",
        categoryId: category.id,
        externalId: category.externalId,
        local: category.name,
        remote: null,
      });
      continue;
    }

    // The type is never moved by a sync, in either direction: Wallet publishes none on a category,
    // and the one thing it does say — that this is its built-in Transfer category — is a fact this
    // app reads off the movements (spec §7.2). A disagreement is reported and the local type kept.
    const walletSaysTransfer = mirror.transfer;
    if (walletSaysTransfer !== (category.type === "transfer")) {
      plan.cases.push({
        kind: "type_mismatch",
        categoryId: category.id,
        externalId: mirror.externalId,
        local: category.type,
        remote: walletSaysTransfer ? "transfer" : "not transfer",
      });
    }

    const verdict = mergeName(category, mirror);
    if (verdict === "conflict") {
      plan.cases.push({
        kind: "conflict",
        categoryId: category.id,
        externalId: mirror.externalId,
        local: category.name,
        remote: mirror.name,
      });
    }

    switch (verdict) {
      case "agreed":
        if (category.providerName !== mirror.name) {
          plan.settle.push({ categoryId: category.id, providerName: mirror.name });
        }
        break;
      case "adopt":
        if (!fitsHere(mirror.name)) {
          plan.cases.push({
            kind: "name_too_long",
            categoryId: category.id,
            externalId: mirror.externalId,
            local: category.name,
            remote: mirror.name,
          });
        } else if (takenNames.has(`${category.parentId ?? ""}\u0000${mirror.name.trim()}`)) {
          plan.cases.push({
            kind: "duplicate_name",
            categoryId: category.id,
            externalId: mirror.externalId,
            local: category.name,
            remote: mirror.name,
          });
        } else {
          plan.adopt.push({ categoryId: category.id, name: mirror.name.trim() });
        }
        break;
      // A conflict is a push that was worth saying out loud: the local name won either way.
      case "conflict":
      case "push":
        if (category.parentId === null) {
          // A group here is one of Wallet's envelope groups, and no endpoint renames one.
          plan.cases.push({
            kind: "group_not_writable",
            categoryId: category.id,
            externalId: mirror.externalId,
            local: category.name,
            remote: mirror.name,
          });
        } else if (category.name.length > WALLET_CATEGORY_NAME_MAX) {
          plan.cases.push({
            kind: "write_failed",
            categoryId: category.id,
            externalId: mirror.externalId,
            local: category.name,
            remote: mirror.name,
            detail: `longer than the ${WALLET_CATEGORY_NAME_MAX} characters Wallet accepts`,
          });
        } else {
          plan.push.push({
            categoryId: category.id,
            externalId: mirror.externalId,
            name: category.name,
          });
        }
        break;
    }
  }

  /*
    The other direction of the same list: a category Wallet publishes that nothing here mirrors.
    Until now one reached this app only when a movement was filed under it, so a category added in
    Wallet and not yet spent in was invisible here (owner, 2026-09-20).

    "Mirrored" covers both links: a category of Wallet's carries `externalId` here, and one that
    became a *group* here — the provider's group is the local parent (F2.5) — carries
    `groupExternalId`. Missing either would add a second copy of it every hour.

    An archived category is left alone: Wallet keeps it for its old records, and taking it on would
    fill this list with names nobody files anything under any more.
  */
  const mirrored = new Set(
    local.flatMap((category) => [category.externalId, category.groupExternalId].filter((id) => id !== null)),
  );
  for (const category of remote) {
    if (category.archived || mirrored.has(category.externalId)) continue;
    if (!fitsHere(category.name)) {
      plan.cases.push({
        kind: "name_too_long",
        categoryId: null,
        externalId: category.externalId,
        local: null,
        remote: category.name,
      });
      continue;
    }
    plan.add.push({
      externalId: category.externalId,
      name: category.name.trim(),
      groupExternalId: category.groupExternalId,
      groupName: category.groupName,
    });
  }

  return plan;
}

/**
 * A category this app has and Wallet has never seen. Only a **sub**-category can be created there,
 * under a base category of the envelope group its parent is mirrored from; everything else is
 * reported once and left alone. A group of this app's own is not reported at all: there is nothing
 * to decide about it every hour, for ever, and no endpoint that could ever take it.
 */
function planCreation(
  category: ProviderCategory,
  byId: ReadonlyMap<string, ProviderCategory>,
  remote: readonly SourceCategory[],
): CategoryCase | { categoryId: string; name: string; parentExternalId: string } | null {
  if (category.archived) return null;
  if (category.parentId === null) return null;
  const refuse = (detail: string): CategoryCase => ({
    kind: "not_creatable",
    categoryId: category.id,
    externalId: null,
    local: category.name,
    remote: null,
    detail,
  });
  // Only the parent's `category_group` link names an envelope group. A parent's own *category*
  // link is a category id, which `POST /categories/custom` would refuse — or, worse, accept as
  // some other category's parent.
  const parent = byId.get(category.parentId);
  if (parent === undefined) return refuse("its group is not one this user holds");
  if (parent.groupExternalId === null) return refuse("its group is not one of Wallet's");
  const base = baseCategoryIn(remote, parent.groupExternalId);
  if (base === null) return refuse("Wallet's group holds no base category to create it under");
  if (category.name.length > WALLET_CATEGORY_NAME_MAX) {
    return refuse(`longer than the ${WALLET_CATEGORY_NAME_MAX} characters Wallet accepts`);
  }
  return { categoryId: category.id, name: category.name, parentExternalId: base.externalId };
}

/* The pass */

/**
 * The database half, behind an interface so the whole pass can be driven by a fake in a unit test
 * (spec §11 forbids an in-memory fake *of the database*; this is the module's own service surface,
 * which the integration tests cover for real).
 */
export interface CategoryStore {
  list(ctx: Pick<Ctx, "userId">, provider: string): Promise<ProviderCategory[]>;
  follow(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<"renamed" | "duplicate" | "not_found">;
  settle(ctx: Pick<Ctx, "userId">, id: string, providerName: string): Promise<void>;
  link(
    ctx: Pick<Ctx, "userId">,
    provider: string,
    id: string,
    externalId: string,
    providerName: string,
  ): Promise<"linked" | "conflict">;
  adopt(
    ctx: Pick<Ctx, "userId">,
    provider: string,
    remote: { externalId: string; name: string; groupExternalId: string | null; groupName: string | null },
  ): Promise<"linked" | "refused">;
}

const databaseStore: CategoryStore = {
  list: listProviderCategories,
  follow: followProviderCategoryName,
  settle: settleProviderCategoryName,
  link: linkProviderCategory,
  adopt: adoptProviderCategory,
};

interface CategorySyncOptions {
  /** Wallet's whole category list, as the movements pass has just read it. */
  remote: readonly SourceCategory[];
  /** `null` runs the Wallet → here half only, which is what a read-only pass can still do. */
  writer: WalletCategoryWriter | null;
  provider?: string;
  store?: CategoryStore;
}

export interface CategorySyncOutcome {
  counts: Record<string, number>;
  cases: CategoryCase[];
}

const ADDED = "categoriesAdded";
const ADOPTED = "categoriesAdopted";
const PUSHED = "categoriesPushed";
const CREATED = "categoriesCreated";
const REPORTED = "categoriesReported";

/**
 * One pass over the categories, in the order that keeps it idempotent:
 *
 * 1. what Wallet renamed is adopted here, and a baseline that has only drifted is recorded;
 * 2. what was renamed here is written to Wallet, in batches of ten, and each category that landed
 *    has its baseline moved and its `name` marker cleared — which is what stops the next pass
 *    seeing a local change again and writing the same name for ever;
 * 3. what was made here is created there and linked, once: the link is what makes the second pass
 *    see a mirrored category instead of a new one.
 *
 * Nothing here deletes, on either side, and nothing changes a type.
 */
export async function syncWalletCategories(
  ctx: Pick<Ctx, "userId">,
  options: CategorySyncOptions,
): Promise<CategorySyncOutcome> {
  const provider = options.provider ?? WALLET_PROVIDER;
  const store = options.store ?? databaseStore;
  const local = await store.list(ctx, provider);
  const plan = planCategorySync(local, options.remote);
  const cases = [...plan.cases];
  const counts: Record<string, number> = {
    [ADDED]: 0,
    [ADOPTED]: 0,
    [PUSHED]: 0,
    [CREATED]: 0,
    [REPORTED]: 0,
  };

  // Wallet's own list first: a category taken on here is one the movements of this same pass can
  // then be filed under by its link, instead of being adopted a second time by name.
  for (const incoming of plan.add) {
    const outcome = await store.adopt(ctx, provider, incoming);
    if (outcome === "linked") counts[ADDED] += 1;
    else {
      cases.push({
        kind: "write_failed",
        categoryId: null,
        externalId: incoming.externalId,
        local: null,
        remote: incoming.name,
        detail: "this app could not take the name on",
      });
    }
  }

  for (const adoption of plan.adopt) {
    const outcome = await store.follow(ctx, adoption.categoryId, adoption.name);
    if (outcome === "renamed") counts[ADOPTED] += 1;
    else if (outcome === "duplicate") {
      cases.push({
        kind: "duplicate_name",
        categoryId: adoption.categoryId,
        externalId: null,
        local: null,
        remote: adoption.name,
      });
    }
  }

  for (const settled of plan.settle) await store.settle(ctx, settled.categoryId, settled.providerName);

  if (options.writer !== null) {
    const writable = plan.push.slice(0, MAX_RENAMES_PER_PASS);
    for (const deferred of plan.push.slice(MAX_RENAMES_PER_PASS)) {
      cases.push({
        kind: "deferred",
        categoryId: deferred.categoryId,
        externalId: deferred.externalId,
        local: deferred.name,
        remote: null,
      });
    }
    for (let from = 0; from < writable.length; from += RENAME_BATCH) {
      const batch = writable.slice(from, from + RENAME_BATCH);
      const results = await options.writer.rename(batch);
      for (const item of batch) {
        const result = results.find((row) => row.externalId === item.externalId);
        if (result?.ok === true) {
          // Wallet now holds this name, so the two agree: the baseline moves and the marker goes,
          // which leaves a later rename *there* free to come back here.
          await store.settle(ctx, item.categoryId, item.name);
          counts[PUSHED] += 1;
        } else {
          cases.push({
            kind: "write_failed",
            categoryId: item.categoryId,
            externalId: item.externalId,
            local: item.name,
            remote: null,
          });
        }
      }
    }

    const creatable = plan.create.slice(0, MAX_CREATES_PER_PASS);
    for (const deferred of plan.create.slice(MAX_CREATES_PER_PASS)) {
      cases.push({
        kind: "deferred",
        categoryId: deferred.categoryId,
        externalId: null,
        local: deferred.name,
        remote: null,
      });
    }
    for (const creation of creatable) {
      const created = await options.writer.create({
        name: creation.name,
        parentExternalId: creation.parentExternalId,
      });
      if (created.externalId === null) {
        // The category may exist in Wallet with no id this app could read. Reported, and nothing
        // is created again: the next pass adopts it by its exact name (spec §9.1) instead.
        cases.push({
          kind: "write_failed",
          categoryId: creation.categoryId,
          externalId: null,
          local: creation.name,
          remote: null,
          detail: "Wallet answered without an id: the category may exist there",
        });
        continue;
      }
      const linked = await store.link(ctx, provider, creation.categoryId, created.externalId, creation.name);
      if (linked === "linked") counts[CREATED] += 1;
      else {
        cases.push({
          kind: "write_failed",
          categoryId: creation.categoryId,
          externalId: created.externalId,
          local: creation.name,
          remote: null,
          detail: "another category already holds that Wallet id here",
        });
      }
    }
  }

  counts[REPORTED] = cases.length;
  return { counts, cases };
}

/* Deleting on request (owner, 2026-09-21) */

/** The reason of an id Wallet would not delete. */
const REFUSED = "provider_refused";

/** What became of a deletion Wallet was asked to mirror; never thrown, always reported. */
type WalletDeletionOutcome =
  /** No Wallet connection, or none of the categories was ever linked to one: nothing to do. */
  | { state: "not_linked" }
  | { state: "deleted"; count: number }
  /**
   * Wallet refused at least one id — usually because its own records still reference it. A reason
   * is a code (`provider_refused`): the plugin never passes Wallet's own words on.
   */
  | { state: "refused"; reasons: string[] }
  /** The call never landed: network, timeout, or a token Wallet would not take. */
  | { state: "failed"; reason: string };

/**
 * Mirrors a deletion the person asked for onto Wallet.
 *
 * Called from Settings › Categories and from nowhere else — not from a pass, not from a job. It
 * never throws: the categories are already gone here, so a Wallet that refuses or cannot be
 * reached is news to deliver, not a reason to fail an action that has already succeeded.
 *
 * A failure is a code, never Wallet's words (contract 2): `provider_refused` for an id Wallet would
 * not delete, the call's own code when the call itself failed. The token never appears in any of it.
 */
export async function deleteWalletCategories(
  ctx: Pick<Ctx, "userId">,
  externalIds: readonly string[],
  deps: { writer?: WalletCategoryWriter } = {},
): Promise<WalletDeletionOutcome> {
  if (externalIds.length === 0) return { state: "not_linked" };
  let writer = deps.writer;
  if (!writer) {
    const connection = (await listConnections(ctx)).find((one) => one.provider === WALLET_PROVIDER);
    if (!connection) return { state: "not_linked" };
    try {
      writer = categoryWriterOf(await walletCalls(ctx, connection.id));
    } catch (error) {
      if (error instanceof IntegrationError) return { state: "failed", reason: error.code };
      throw error;
    }
  }
  const refused: string[] = [];
  let deleted = 0;
  for (let at = 0; at < externalIds.length; at += DELETE_BATCH) {
    const batch = externalIds.slice(at, at + DELETE_BATCH);
    let results: CategoryWriteResult[];
    try {
      results = await writer.remove(batch);
    } catch (error) {
      return { state: "failed", reason: callCode(error) ?? "failed" };
    }
    for (const result of results) {
      if (result.ok) deleted += 1;
      else refused.push(REFUSED);
    }
  }
  if (refused.length > 0) return { state: "refused", reasons: [...new Set(refused)] };
  return { state: "deleted", count: deleted };
}

/**
 * Wallet as the port `TransactionsProvider` of transactions (audit TRX-6): its provider id and the
 * deletion of its categories. The application passes it where transactions needs a source.
 */
export const walletTransactions: TransactionsProvider<WalletDeletionOutcome> = {
  provider: WALLET_PROVIDER,
  deleteCategories: (ctx, externalIds) => deleteWalletCategories(ctx, externalIds),
};

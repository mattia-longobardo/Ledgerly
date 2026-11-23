/**
 * The category sync of spec §9.1, both ways (F6), for a source with the capability `categories`:
 * the plan is `category-plan.ts`, this file writes it.
 *
 * The writes go through the plugin (`POST /categories/write` of contract 2, rewrite plan R5c), which
 * speaks to the source: one attempt for a write, the token never in a message, batches of ten. What
 * stays here is the plan, and a ceiling on how much one pass may write (a source allows only so many
 * requests an hour, and the movements pass is spending from the same budget).
 *
 * The deletion joined the writes on 2026-09-21, at the owner's explicit request. **The hourly pass
 * never calls it.** A category that has merely disappeared from one side is still only reported,
 * because a sync deciding on its own to destroy data on the other side is how people lose years of
 * history. It is called from one place only: a person pressing "delete" in Settings › Categories,
 * having been told in the dialog that the source is included. The source refuses an id its own
 * records still reference, and that refusal comes back rather than being retried around.
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import { IntegrationError, listConnections, pluginProvider } from "@ledgerly/domain/platform/integrations";
import { listInstancePlugins } from "@ledgerly/domain/platform/plugins";
import { connectionsThatCan } from "../capabilities";
import { callCode, type SourceCalls, type SourceCategory, connectionSource } from "./calls";
import { type CategoryCase, type CategoryPlan, planCategorySync } from "./category-plan";
import { movementsSink, type ProviderCategory } from "./ports";

/** A rename takes at most ten items per request. */
export const RENAME_BATCH = 10;
/** A deletion takes at most ten ids per request. */
export const DELETE_BATCH = 10;
/**
 * What one pass may write, so an hourly sync cannot eat the requests-an-hour budget the movements
 * pass also draws on. What is left over is reported as `deferred` and taken by the next pass: the
 * plan is built in a fixed order (by local id), so a capped pass resumes rather than repeating its
 * own beginning.
 */
export const MAX_RENAMES_PER_PASS = 30;
const MAX_CREATES_PER_PASS = 10;

/* The writer */

/** One item of a write's answer, per category. */
export interface CategoryWriteResult {
  externalId: string;
  ok: boolean;
}

export interface SourceCategoryWriter {
  /**
   * Renames categories at the source, at most {@link RENAME_BATCH} per call. A refusal of a single
   * item comes back in its result rather than as a throw: the other nine landed, and a name the
   * source will not take is a case to report, not a pass to fail.
   */
  rename(items: readonly { externalId: string; name: string }[]): Promise<CategoryWriteResult[]>;
  /**
   * Creates a subcategory under a **base** category. `externalId` is `null` when the answer carried
   * no id that could be read — the category may well exist, and the caller treats that as unsure
   * rather than as done, exactly as the record writer does (spec §9.1).
   */
  create(input: { name: string; parentExternalId: string }): Promise<{ externalId: string | null }>;
  /**
   * Deletes categories at the source, at most {@link DELETE_BATCH} per call. Never called by a
   * pass: see this file's own note. A refusal of a single item comes back in its result, because
   * a batch can be answered with some ids gone and others not.
   */
  remove(externalIds: readonly string[]): Promise<CategoryWriteResult[]>;
}

/** The writer of a source's calls: each batch is one call, so a pass writes what it wrote before. */
export function categoryWriterOf(source: Pick<SourceCalls, "writeCategories">): SourceCategoryWriter {
  const write = (request: Partial<Parameters<SourceCalls["writeCategories"]>[0]>) =>
    source.writeCategories({ rename: [], create: [], remove: [], ...request });
  return {
    rename: async (items) => (await write({ rename: [...items] })).renamed,
    // In the order asked: an answer with no id leaves the category possibly there, never retried.
    create: async (input) => (await write({ create: [input] })).created[0] ?? { externalId: null },
    remove: async (externalIds) => (await write({ remove: [...externalIds] })).removed,
  };
}

/* The pass */

/**
 * The database half, behind an interface so the whole pass can be driven by a fake in a unit test
 * (spec §11 forbids an in-memory fake *of the database*; this is the module's own service surface,
 * which the integration tests cover for real).
 */
export interface CategoryStore {
  /** What `categories.name` holds here. */
  nameMax: number;
  list(ctx: Pick<Ctx, "userId">, provider: string): Promise<ProviderCategory[]>;
  follow(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<"renamed" | "duplicate" | "not_found">;
  settle(ctx: Pick<Ctx, "userId">, id: string, providerName: string): Promise<void>;
  link(
    ctx: Pick<Ctx, "userId">,
    provider: string,
    link: { id: string; externalId: string; providerName: string },
  ): Promise<"linked" | "conflict">;
  adopt(
    ctx: Pick<Ctx, "userId">,
    provider: string,
    remote: { externalId: string; name: string; groupExternalId: string | null; groupName: string | null },
  ): Promise<"linked" | "refused">;
}

/** The store of the wired port: the transactions module's own services. */
function databaseStore(): CategoryStore {
  const sink = movementsSink();
  return {
    nameMax: sink.categoryNameMax,
    list: sink.listProviderCategories,
    follow: sink.followProviderCategoryName,
    settle: sink.settleProviderCategoryName,
    link: sink.linkProviderCategory,
    adopt: sink.adoptProviderCategory,
  };
}

interface CategorySyncOptions {
  /** The source's whole category list, as the movements pass has just read it. */
  remote: readonly SourceCategory[];
  /** `null` runs the source → here half only, which is what a read-only pass can still do. */
  writer: SourceCategoryWriter | null;
  provider: string;
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

/** One pass's writes: who, which provider, and what it counts and reports. */
interface Writing {
  ctx: Pick<Ctx, "userId">;
  provider: string;
  store: CategoryStore;
  counts: Record<string, number>;
  cases: CategoryCase[];
}

/** The source → here half: what the source added or renamed, and the baselines that drifted. */
async function applyFromSource(run: Writing, plan: CategoryPlan): Promise<void> {
  const { ctx, provider, store, counts, cases } = run;
  // The source's own list first: a category taken on here is one the movements of this same pass
  // can then be filed under by its link, instead of being adopted a second time by name.
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
}

/** What was renamed here goes to the source, in batches, within this pass's budget. */
async function pushRenames(run: Writing, plan: CategoryPlan, writer: SourceCategoryWriter): Promise<void> {
  const writable = plan.push.slice(0, MAX_RENAMES_PER_PASS);
  for (const deferred of plan.push.slice(MAX_RENAMES_PER_PASS)) {
    run.cases.push({
      kind: "deferred",
      categoryId: deferred.categoryId,
      externalId: deferred.externalId,
      local: deferred.name,
      remote: null,
    });
  }
  for (let from = 0; from < writable.length; from += RENAME_BATCH) {
    const batch = writable.slice(from, from + RENAME_BATCH);
    const results = await writer.rename(batch);
    for (const item of batch) {
      const result = results.find((row) => row.externalId === item.externalId);
      if (result?.ok === true) {
        // The source now holds this name, so the two agree: the baseline moves and the marker
        // goes, which leaves a later rename *there* free to come back here.
        await run.store.settle(run.ctx, item.categoryId, item.name);
        run.counts[PUSHED] += 1;
      } else {
        run.cases.push({
          kind: "write_failed",
          categoryId: item.categoryId,
          externalId: item.externalId,
          local: item.name,
          remote: null,
        });
      }
    }
  }
}

/** One category made here, created at the source and linked, once. */
async function createOne(
  run: Writing,
  creation: CategoryPlan["create"][number],
  writer: SourceCategoryWriter,
): Promise<void> {
  const created = await writer.create({ name: creation.name, parentExternalId: creation.parentExternalId });
  const failed = (externalId: string | null, detail: string) =>
    run.cases.push({
      kind: "write_failed",
      categoryId: creation.categoryId,
      externalId,
      local: creation.name,
      remote: null,
      detail,
    });
  if (created.externalId === null) {
    // The category may exist at the source with no id this app could read. Reported, and nothing
    // is created again: the next pass adopts it by its exact name (spec §9.1) instead.
    failed(null, "the source answered without an id: the category may exist there");
    return;
  }
  const linked = await run.store.link(run.ctx, run.provider, {
    id: creation.categoryId,
    externalId: created.externalId,
    providerName: creation.name,
  });
  if (linked === "linked") run.counts[CREATED] += 1;
  else failed(created.externalId, "another category already holds that id of the source here");
}

/** What was made here is created there, within this pass's budget. */
async function pushCreations(run: Writing, plan: CategoryPlan, writer: SourceCategoryWriter): Promise<void> {
  for (const deferred of plan.create.slice(MAX_CREATES_PER_PASS)) {
    run.cases.push({
      kind: "deferred",
      categoryId: deferred.categoryId,
      externalId: null,
      local: deferred.name,
      remote: null,
    });
  }
  for (const creation of plan.create.slice(0, MAX_CREATES_PER_PASS)) await createOne(run, creation, writer);
}

/**
 * One pass over the categories, in the order that keeps it idempotent:
 *
 * 1. what the source renamed is adopted here, and a baseline that has only drifted is recorded;
 * 2. what was renamed here is written to the source, in batches of ten, and each category that
 *    landed has its baseline moved and its `name` marker cleared — which is what stops the next
 *    pass seeing a local change again and writing the same name for ever;
 * 3. what was made here is created there and linked, once: the link is what makes the second pass
 *    see a mirrored category instead of a new one.
 *
 * Nothing here deletes, on either side, and nothing changes a type.
 */
export async function syncSourceCategories(
  ctx: Pick<Ctx, "userId">,
  options: CategorySyncOptions,
): Promise<CategorySyncOutcome> {
  const store = options.store ?? databaseStore();
  const local = await store.list(ctx, options.provider);
  const plan = planCategorySync(local, options.remote, store.nameMax);
  const run: Writing = {
    ctx,
    provider: options.provider,
    store,
    counts: { [ADDED]: 0, [ADOPTED]: 0, [PUSHED]: 0, [CREATED]: 0, [REPORTED]: 0 },
    cases: [...plan.cases],
  };
  await applyFromSource(run, plan);
  if (options.writer !== null) {
    await pushRenames(run, plan, options.writer);
    await pushCreations(run, plan, options.writer);
  }
  run.counts[REPORTED] = run.cases.length;
  return { counts: run.counts, cases: run.cases };
}

/* Deleting on request (owner, 2026-09-21) */

/** The reason of an id the source would not delete. */
const REFUSED = "provider_refused";

/** What became of a deletion the source was asked to mirror; never thrown, always reported. */
type SourceDeletionOutcome =
  /** No connection to the source, or none of the categories was ever linked to one: nothing to do. */
  | { state: "not_linked" }
  | { state: "deleted"; count: number }
  /**
   * The source refused at least one id — usually because its own records still reference it. A
   * reason is a code (`provider_refused`): the plugin never passes the source's own words on.
   */
  | { state: "refused"; reasons: string[] }
  /** The call never landed: network, timeout, or a token the source would not take. */
  | { state: "failed"; reason: string };

/** The writer of the person's connection to `provider`, or why there is none. */
async function writerFor(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<SourceCategoryWriter | SourceDeletionOutcome> {
  const connection = (await listConnections(ctx)).find((one) => one.provider === provider);
  if (!connection) return { state: "not_linked" };
  try {
    return categoryWriterOf(await connectionSource(ctx, connection));
  } catch (error) {
    if (error instanceof IntegrationError) return { state: "failed", reason: error.code };
    throw error;
  }
}

/**
 * Mirrors a deletion the person asked for onto the source of `provider`.
 *
 * Called from Settings › Categories and from nowhere else — not from a pass, not from a job. It
 * never throws: the categories are already gone here, so a source that refuses or cannot be
 * reached is news to deliver, not a reason to fail an action that has already succeeded.
 *
 * A failure is a code, never the source's words (contract 2): `provider_refused` for an id the
 * source would not delete, the call's own code when the call itself failed. The token never
 * appears in any of it.
 */
export async function deleteSourceCategories(
  ctx: Pick<Ctx, "userId">,
  target: { provider: string; externalIds: readonly string[] },
  deps: { writer?: SourceCategoryWriter } = {},
): Promise<SourceDeletionOutcome> {
  const externalIds = target.externalIds;
  if (externalIds.length === 0) return { state: "not_linked" };
  const writer = deps.writer ?? (await writerFor(ctx, target.provider));
  if ("state" in writer) return writer;
  const refused: string[] = [];
  let deleted = 0;
  for (let from = 0; from < externalIds.length; from += DELETE_BATCH) {
    let results: CategoryWriteResult[];
    try {
      results = await writer.remove(externalIds.slice(from, from + DELETE_BATCH));
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

/** A source as the port `TransactionsProvider` of transactions (audit TRX-6): its provider id and
 * the deletion of its categories. */
function sourceTransactions(provider: string) {
  return {
    provider,
    deleteCategories: (ctx: Pick<Ctx, "userId">, externalIds: readonly string[]) =>
      deleteSourceCategories(ctx, { provider, externalIds }),
  };
}

/**
 * The source a category deleted here is mirrored to: the person's connection to a source that
 * deletes categories (`deleteCategory`), else such a plugin of the instance — its links are cleared
 * with the category even while it is not connected. The application passes it where transactions
 * needs a source; with none, nothing is linked and nothing is asked.
 */
export async function categorySourceOf(ctx: Pick<Ctx, "userId">) {
  const [connection] = await connectionsThatCan(ctx, "deleteCategory");
  if (connection) return sourceTransactions(connection.provider);
  const plugin = (await listInstancePlugins()).find((one) =>
    one.manifest.capabilities.includes("deleteCategory"),
  );
  return sourceTransactions(plugin ? pluginProvider(plugin.config.id) : "");
}

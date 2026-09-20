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
 * created or renamed. Deletion exists (`DELETE /v1/api/{type}`) and is deliberately never used:
 * a category can carry movements, so a disappearance is reported and nothing else.
 *
 * The HTTP is written here rather than in `client.ts` because that file's own request helper is a
 * closure that only speaks GET and POST. The policy is copied, not invented: one attempt for a
 * write ({@link WRITE_ATTEMPTS}), 401/403 as `token_rejected` at once, the token never in a
 * message, batches of ten, and a ceiling on how much one pass may write (Wallet allows 300
 * requests an hour, and the movements pass is spending from the same budget).
 */
import "server-only";
import { z } from "zod";
import {
  CATEGORY_NAME_MAX,
  adoptProviderCategory,
  followProviderCategoryName,
  linkProviderCategory,
  listProviderCategories,
  type ProviderCategory,
  settleProviderCategoryName,
} from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "../rules";
import {
  backoffDelayMs,
  isUsableToken,
  parseRetryAfterMs,
  WALLET_API_URL,
  WalletError,
  type WalletClientOptions,
  WRITE_ATTEMPTS,
} from "./client";
import { WALLET_TRANSFER_CATEGORY, type WalletCategory } from "./mapping";

/** `PatchCategoryRequest.name` and `CreateSubcategoryRequest.name` both stop at 80 characters. */
export const WALLET_CATEGORY_NAME_MAX = 80;
/** `PATCH /categories` takes at most ten items per request. */
export const RENAME_BATCH = 10;
/**
 * What one pass may write, so an hourly sync cannot eat the 300-requests-an-hour budget the
 * movements pass also draws on. What is left over is reported as `deferred` and taken by the next
 * pass: the plan is built in a fixed order (by local id), so a capped pass resumes rather than
 * repeating its own beginning.
 */
export const MAX_RENAMES_PER_PASS = 30;
export const MAX_CREATES_PER_PASS = 10;

const DEFAULT_TIMEOUT_MS = 20_000;

/* The writer */

/** One item of a `PATCH /categories` answer, per category. */
export interface CategoryWriteResult {
  externalId: string;
  ok: boolean;
  /** Wallet's own words when it refused this one; `null` on success. */
  error: string | null;
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
}

const patchAnswerSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().nullish(),
      inputIndex: z.number().int().nullish(),
      success: z.boolean().nullish(),
      error: z.string().nullish(),
    }),
  ),
});

/** `{ category: { id } }` is what the endpoint documents; a bare `{ id }` is accepted too. */
const createdAnswerSchema = z.union([
  z.object({ category: z.object({ id: z.string().min(1) }) }).transform((body) => body.category.id),
  z.object({ id: z.string().min(1) }).transform((body) => body.id),
]);

const UNUSABLE_TOKEN_MESSAGE =
  "The Wallet token cannot be sent in an HTTP header — a line break or a control character inside it — so no request was made: paste the token again from Wallet";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whatever the body put in `error`, when it put anything there at all. */
function errorFieldOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      const said = (parsed as { error: unknown }).error;
      if (typeof said === "string" && said.trim() !== "") return said.trim();
    }
  } catch {
    // Not JSON: there is nothing to quote, which is an answer in itself.
  }
  return null;
}

export function createWalletCategoryWriter(
  token: string,
  options: WalletClientOptions = {},
): WalletCategoryWriter {
  if (token.trim() === "") throw new Error("createWalletCategoryWriter: the Wallet token is empty");

  const baseUrl = (options.baseUrl ?? WALLET_API_URL).replace(/\/+$/, "");
  const call = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secret = token.trim();
  const secrets = [...new Set([token, secret])];

  function withoutToken(text: string): string {
    return secrets.reduce((clean, value) => clean.split(value).join("[token redacted]"), text);
  }

  /** Built outside every `try`, for the reason `client.ts` spells out: `fetch` quotes the value. */
  function requestHeaders(): Headers {
    if (!isUsableToken(secret)) {
      throw new WalletError("token_rejected", UNUSABLE_TOKEN_MESSAGE, null, null, false);
    }
    try {
      return new Headers({
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      });
    } catch {
      throw new WalletError("token_rejected", UNUSABLE_TOKEN_MESSAGE, null, null, false);
    }
  }

  async function attempt<T>(
    path: string,
    method: "PATCH" | "POST",
    body: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const headers = requestHeaders();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await call(`${baseUrl}${path}`, { method, headers, body, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new WalletError("timeout", `Wallet request timed out after ${timeoutMs} ms`, null, null, true);
      }
      throw new WalletError(
        "network",
        `Wallet request failed: ${withoutToken(errorText(error))}`,
        null,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const answer = await response.text().catch(() => "");
    const reason = errorFieldOf(answer);
    const said = reason === null ? "" : `: ${withoutToken(reason)}`;

    if (response.status === 401 || response.status === 403) {
      throw new WalletError(
        "token_rejected",
        `Wallet rejected the token (HTTP ${response.status})${said}`,
        response.status,
        null,
        false,
      );
    }
    // 207 is a success as far as HTTP goes: the body says which items landed and which did not.
    if (!response.ok && response.status !== 207) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
      const retryable = response.status === 429 || response.status >= 500;
      throw new WalletError(
        "http",
        `Wallet answered HTTP ${response.status}${said}`,
        response.status,
        null,
        retryable,
        retryAfterMs,
      );
    }

    let payload: unknown;
    try {
      // Plain `JSON.parse`, unlike the client's reads: no money crosses these two endpoints — a
      // category is a name, an id and an index — so there is no exact decimal to preserve.
      payload = JSON.parse(answer) as unknown;
    } catch (error) {
      throw new WalletError("payload", `Wallet answered with a body that is not JSON: ${errorText(error)}`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new WalletError("payload", `Wallet answered an unexpected shape: ${issues}`);
    }
    return parsed.data;
  }

  /**
   * The same shape as the client's own retry, held to {@link WRITE_ATTEMPTS}: a 5xx after Wallet
   * has already renamed a category must not send the same batch again. The loop stays because the
   * policy belongs in one visible place, not because a write is expected to repeat.
   */
  async function withRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let count = 1; ; count += 1) {
      try {
        return await run();
      } catch (error) {
        const retryable = error instanceof WalletError && error.retryable;
        if (!retryable || count >= WRITE_ATTEMPTS) throw error;
        const floor = (error as WalletError).minDelayMs ?? 0;
        await sleep(Math.max(backoffDelayMs(count, jitter()), floor));
      }
    }
  }

  return {
    async rename(items) {
      if (items.length === 0) return [];
      if (items.length > RENAME_BATCH) {
        throw new Error(`rename: at most ${RENAME_BATCH} categories per request, got ${items.length}`);
      }
      const body = JSON.stringify(items.map((item) => ({ id: item.externalId, name: item.name })));
      const answer = await withRetry(() => attempt("/categories", "PATCH", body, patchAnswerSchema));
      // `inputIndex` is the documented correlation key; `id` is the fallback, and the position in
      // the array the last resort — one of the three always points back at the item that was sent.
      return items.map((item, index) => {
        const result =
          answer.results.find((row) => row.inputIndex === index) ??
          answer.results.find((row) => row.id === item.externalId) ??
          answer.results[index];
        const ok = result?.success ?? false;
        return {
          externalId: item.externalId,
          ok,
          error: ok ? null : (result?.error ?? "Wallet did not answer for this category"),
        };
      });
    },
    async create({ name, parentExternalId }) {
      const body = JSON.stringify({ name, parentId: parentExternalId });
      try {
        const id = await withRetry(() => attempt("/categories/custom", "POST", body, createdAnswerSchema));
        return { externalId: id };
      } catch (error) {
        // A shape nobody can read is the one case where the category may exist without this app
        // knowing its id: reported as unsure, never as a failure to be retried into a twin.
        if (error instanceof WalletError && error.kind === "payload") return { externalId: null };
        throw error;
      }
    },
  };
}

/* The plan */

/**
 * Everything one pass has to say that is not a write. None of these ever deletes anything: a
 * category can carry movements, so a disappearance on either side is reported and left alone
 * (spec §7.2).
 */
export type CategoryCaseKind =
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

export interface CategoryPlan {
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
function baseCategoryIn(remote: readonly WalletCategory[], groupExternalId: string): WalletCategory | null {
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
  remote: WalletCategory,
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
  remote: readonly WalletCategory[],
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
    const walletSaysTransfer = mirror.systemId === WALLET_TRANSFER_CATEGORY;
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
  remote: readonly WalletCategory[],
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

export interface CategorySyncOptions {
  /** Wallet's whole category list, as the movements pass has just read it. */
  remote: readonly WalletCategory[];
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
            detail: result?.error ?? undefined,
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

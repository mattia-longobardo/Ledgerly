/**
 * Wallet's categories: the list in the contract's words, and the writes the core asks for —
 * renames and deletions in Wallet's batches of ten, and custom subcategories one by one. Which
 * category to write is the core's plan; this file only carries it out and says what landed.
 */
import type { z } from "zod";
import type {
  SourceCategoriesResponse,
  writeCategoriesRequestSchema,
  WriteCategoriesResponse,
} from "@ledgerly/plugin-contract";
import { WalletError } from "./failure";
import { assertWholePage } from "./guards";
import { read, type Wallet, write } from "./http";
import {
  categoryResultsSchema,
  createdCategorySchema,
  optionalText,
  walletCategoriesPayloadSchema,
} from "./payloads";
import { WALLET_TRANSFER_CATEGORY } from "./records";

const CATEGORIES_LIMIT = 200;
/** `PATCH /categories` takes at most ten items per request. */
const RENAME_BATCH = 10;
/** `DELETE /categories` takes at most ten ids per request (`DeleteRequest.ids`, maxItems 10). */
const DELETE_BATCH = 10;

export async function readCategories(wallet: Wallet): Promise<SourceCategoriesResponse["categories"]> {
  const categories = await read(
    wallet,
    `/categories?limit=${CATEGORIES_LIMIT}`,
    walletCategoriesPayloadSchema,
  );
  assertWholePage("categories", categories.length, CATEGORIES_LIMIT);
  return categories.map((raw) => ({
    externalId: raw.id,
    name: raw.name.trim(),
    groupExternalId: optionalText(raw.group?.id),
    groupName: optionalText(raw.group?.name),
    transfer: optionalText(raw.systemId) === WALLET_TRANSFER_CATEGORY,
    custom: raw.customCategory ?? false,
    parentExternalId: optionalText(raw.parentId),
    archived: raw.archived ?? false,
  }));
}

type Outcome = WriteCategoriesResponse["renamed"][number];

/**
 * The outcome of each item sent: `inputIndex` is the documented key, `id` the fallback, the
 * position the last resort. A refusal of one item is its outcome, never a failure of the batch.
 */
async function writeBatch(
  wallet: Wallet,
  externalIds: readonly string[],
  request: { method: "PATCH" | "DELETE"; body: string },
): Promise<Outcome[]> {
  const answer = await write(wallet, { path: "/categories", ...request }, categoryResultsSchema);
  return externalIds.map((externalId, index) => {
    const result =
      answer.results.find((row) => row.inputIndex === index) ??
      answer.results.find((row) => row.id === externalId) ??
      answer.results[index];
    return { externalId, ok: result?.success ?? false };
  });
}

async function inBatches<T>(
  items: readonly T[],
  size: number,
  run: (batch: readonly T[]) => Promise<Outcome[]>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (let from = 0; from < items.length; from += size)
    outcomes.push(...(await run(items.slice(from, from + size))));
  return outcomes;
}

/**
 * A custom subcategory under a base category. An answer nobody can read leaves the category
 * possibly there: `null`, unsure, never a failure the core would retry into a twin.
 */
async function createCategory(wallet: Wallet, item: { name: string; parentExternalId: string }) {
  const body = JSON.stringify({ name: item.name, parentId: item.parentExternalId });
  try {
    return {
      externalId: await write(
        wallet,
        { path: "/categories/custom", method: "POST", body },
        createdCategorySchema,
      ),
    };
  } catch (error) {
    if (error instanceof WalletError && error.kind === "payload") return { externalId: null };
    throw error;
  }
}

export async function writeCategories(
  wallet: Wallet,
  request: z.infer<typeof writeCategoriesRequestSchema>,
): Promise<WriteCategoriesResponse> {
  const renamed = await inBatches(request.rename, RENAME_BATCH, (batch) =>
    writeBatch(
      wallet,
      batch.map((item) => item.externalId),
      {
        method: "PATCH",
        body: JSON.stringify(batch.map((item) => ({ id: item.externalId, name: item.name }))),
      },
    ),
  );
  const created: WriteCategoriesResponse["created"] = [];
  for (const item of request.create) created.push(await createCategory(wallet, item));
  const removed = await inBatches(request.remove, DELETE_BATCH, (batch) =>
    writeBatch(wallet, batch, { method: "DELETE", body: JSON.stringify({ ids: [...batch] }) }),
  );
  return { renamed, created, removed };
}

/**
 * Wallet's wire shapes, measured against the live API (2026-09-16/17) and Wallet API 2.0.0. Field
 * names are Wallet's and live only here. A JSON number reaches these schemas as its source text
 * (`parseJsonPreservingNumbers`), so a money field accepts a string and a numeric index is coerced.
 */
import { z } from "zod";

/** Wallet sends money as a JSON number; the string arm is what matches in practice. */
const wireAmount = z.union([z.string(), z.number()]);
const wireIndex = z.union([z.number(), z.string()]).transform(Number).nullish();

/** A text as the contract carries it: trimmed, and absent rather than blank. */
export function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const walletAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  currencyCode: z.string(),
  archived: z.boolean().default(false),
  accountType: z.string().nullish(),
  /** "Bank account number or IBAN as stored", free text (API 2.1.1). */
  bankAccountNumber: z.string().nullish(),
  isInvestmentAccount: z.boolean().nullish(),
  balance: z.object({ currentBalance: wireAmount }),
});
export type WalletAccountPayload = z.infer<typeof walletAccountSchema>;

/**
 * The category a record embeds, name included. `systemId` is Wallet's identity of a built-in
 * category, the same in every language: `system_categories__transfer` is how Wallet tells a giroconto.
 */
const walletRecordCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  group: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  systemId: z.string().nullish(),
});

/**
 * Wallet's transfer block, `null` for an ordinary movement. `mirrorRecord` is the other record
 * itself and its id is the counterpart; `transferId` is a group id shared by both legs, not a
 * record id, and is deliberately not read.
 */
const walletTransferSchema = z.object({
  type: z.string().nullish(),
  transferId: z.string().nullish(),
  mirrorRecord: z.object({ id: z.string().min(1), accountId: z.string().nullish() }).nullish(),
});

/**
 * A movement as `/records` returns it. `labels` is an array whose element was never seen with a
 * real token (always empty): read as `unknown` and turned into names tolerantly.
 */
const walletRecordSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  /** A record has no currency of its own: the amount's is the movement's. */
  amount: z.object({ value: wireAmount, currencyCode: z.string() }),
  recordDate: z.string(),
  category: walletRecordCategorySchema.nullish(),
  labels: z.array(z.unknown()).default([]),
  recordType: z.string().nullish(),
  recordState: z.string().nullish(),
  note: z.string().nullish(),
  counterParty: z.string().nullish(),
  transfer: walletTransferSchema.nullish(),
});
export type WalletRecordPayload = z.infer<typeof walletRecordSchema>;

/**
 * A category as `/categories` answers: `group` is an object `{ id, name }`. The three levels
 * (`customCategory`, `parentId`, `archived`) are optional: a category that does not say is neither
 * custom nor archived.
 */
const walletCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  group: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  systemId: z.string().nullish(),
  customCategory: z.boolean().nullish(),
  parentId: z.string().nullish(),
  archived: z.boolean().nullish(),
});

/** Wrapped (`{ accounts }`, `{ categories }`) or a bare array, the tolerance the client began with. */
export const walletAccountsPayloadSchema = z.union([
  z.object({ accounts: z.array(walletAccountSchema) }).transform((body) => body.accounts),
  z.array(walletAccountSchema),
]);

export const walletCategoriesPayloadSchema = z.union([
  z.object({ categories: z.array(walletCategorySchema) }).transform((body) => body.categories),
  z.array(walletCategorySchema),
]);

/**
 * A page of `/records`, envelope and all. No bare-array arm and `appliedRecordDateFilters`
 * required: an answer that cannot declare the window it covers is not believed.
 */
export const walletRecordsPayloadSchema = z.object({
  records: z.array(walletRecordSchema),
  appliedRecordDateFilters: z.array(z.string()),
});

/** A lookup by id or by marker: records, with or without the filters Wallet says it applied. */
export const walletRecordListSchema = z.object({ records: z.array(walletRecordSchema) });

/** What a POST of records answers — never verified: wrapped like a read, or a bare array. */
export const createdRecordsSchema = z.union([
  z.object({ records: z.array(z.looseObject({ id: z.string().min(1) })) }).transform((body) => body.records),
  z.array(z.looseObject({ id: z.string().min(1) })),
]);

/** `PatchRecordsResponse`: one result per item, the full record on success. */
export const patchedRecordsSchema = z.object({
  results: z.array(
    z.object({
      inputIndex: wireIndex,
      success: z.boolean().nullish(),
      error: z.string().nullish(),
      record: walletRecordSchema.nullish(),
    }),
  ),
});

/** One result per item of a `PATCH` or `DELETE` of categories (`207` when some failed). */
export const categoryResultsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().nullish(),
      inputIndex: wireIndex,
      success: z.boolean().nullish(),
      error: z.string().nullish(),
    }),
  ),
});

/** `{ category: { id } }` is what the endpoint documents; a bare `{ id }` is accepted too. */
export const createdCategorySchema = z.union([
  z.object({ category: z.object({ id: z.string().min(1) }) }).transform((body) => body.category.id),
  z.object({ id: z.string().min(1) }).transform((body) => body.id),
]);

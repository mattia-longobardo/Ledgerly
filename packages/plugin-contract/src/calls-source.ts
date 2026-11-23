/**
 * The calls of contract 2 for a source read with the person's own credentials (rewrite plan R5c):
 * no access to open at the provider, no session — the credentials of each call are enough. A
 * plugin answers them when its manifest declares `source.read`; the writes need their own
 * capability (`createRecord`, `editRecord`, `categories`, `deleteCategory`).
 *
 * The rule of the split: the plugin speaks to the provider and gives its data in the words of this
 * file; the core decides what the data does here — which window is read, what is gone, which
 * category a movement counts under. The plugin keeps nothing between two calls.
 */
import { z } from "zod";

export const SOURCE_PATHS = {
  accounts: "/source/accounts",
  categories: "/source/categories",
  movements: "/source/movements",
  record: "/source/record",
  push: "/push",
  edit: "/records/edit",
  writeCategories: "/categories/write",
} as const;

const credentials = z.record(z.string().min(1).max(40), z.string().min(1).max(8192));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.iso.datetime({ offset: true });
/** Signed: negative is money out. A decimal as a string, never a float. */
const signedAmount = z.string().regex(/^-?\d{1,15}(\.\d{1,8})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const externalId = z.string().min(1).max(200);
const text = z.string().min(1).max(2000);
/** A key the core makes for one movement it asks the source to create: the same at every retry. */
const idempotencyKey = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

/** The kinds of account the core knows; the plugin maps the provider's own word onto one of them. */
const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "investment",
  "pension",
  "crypto",
  "credit",
  "other",
] as const;

const credentialsOnly = z.object({ credentials });

/* accounts */

export const sourceAccountsRequestSchema = credentialsOnly;
export const sourceAccountsResponseSchema = z.object({
  accounts: z
    .array(
      z.object({
        externalId,
        name: z.string().min(1).max(200),
        type: z.enum(ACCOUNT_TYPES),
        currency,
        archived: z.boolean(),
        /** The IBAN or another number the person recognises; the core keeps it only when it is an IBAN. */
        identifier: z.string().max(64).nullable(),
        /** The balance now, with no day: the core stamps the day of its reading. `null`: none given. */
        balance: signedAmount.nullable(),
        /** The available balance when the provider gives one apart; `null` otherwise. */
        available: signedAmount.nullable(),
      }),
    )
    .max(500),
});
export type SourceAccountsResponse = z.infer<typeof sourceAccountsResponseSchema>;

/* categories */

const categoryRef = z.object({
  externalId,
  name: z.string().min(1).max(200).nullable(),
  groupExternalId: externalId.nullable(),
  groupName: z.string().min(1).max(200).nullable(),
  /** The provider's own category for a movement between two accounts of the person. */
  transfer: z.boolean(),
});

export const sourceCategoriesRequestSchema = credentialsOnly;
export const sourceCategoriesResponseSchema = z.object({
  categories: z
    .array(
      categoryRef.extend({
        name: z.string().min(1).max(200),
        /** Added by the person under a base category of the provider. */
        custom: z.boolean(),
        /** The base category a custom one hangs from; `null` for a base category. */
        parentExternalId: externalId.nullable(),
        archived: z.boolean(),
      }),
    )
    .max(5000),
});
export type SourceCategoriesResponse = z.infer<typeof sourceCategoriesResponseSchema>;

/* movements */

const movementSchema = z.object({
  externalId,
  accountExternalId: externalId,
  /** The other leg of a transfer, by the provider's id; `null` for anything else. */
  counterpartExternalId: externalId.nullable(),
  /** The day the provider stamped: the one it filters a window on. */
  day: isoDate,
  /** The instant, when the provider gives a time as well. */
  instant: isoInstant.nullable(),
  amount: signedAmount,
  currency,
  payee: text.nullable(),
  /** The person's note, without anything the plugin itself wrote in it. */
  note: text.nullable(),
  /** The key of a movement the core asked the source to create (`POST /push`), when this is it. */
  sentKey: idempotencyKey.nullable(),
  category: categoryRef.nullable(),
  labels: z.array(z.string().min(1).max(200)).max(50),
  /** The provider's kind of movement, when it says one; `null` leaves it to the sign. */
  type: z.enum(["income", "expense", "transfer"]).nullable(),
  /** `null`: the provider does not say, and the movement is taken as cleared. */
  state: z.enum(["cleared", "pending"]).nullable(),
});
export type SourceMovement = z.infer<typeof movementSchema>;

export const sourceMovementsRequestSchema = z.object({ credentials, from: isoDate, to: isoDate });
export const sourceMovementsResponseSchema = z.object({ movements: z.array(movementSchema).max(50_000) });
export type SourceMovementsResponse = z.infer<typeof sourceMovementsResponseSchema>;

export const sourceRecordRequestSchema = z.object({ credentials, externalId });
export const sourceRecordResponseSchema = z.object({ movement: movementSchema.nullable() });
export type SourceRecordResponse = z.infer<typeof sourceRecordResponseSchema>;

/* push: one movement written in the core, created at the source (`createRecord`) */

export const pushRequestSchema = z.object({
  credentials,
  idempotencyKey,
  /**
   * The day of an earlier request for the same key whose answer never came: the plugin looks for
   * the movement first and creates nothing when it finds it. `null`: never asked before.
   */
  askedOn: isoDate.nullable(),
  movement: z.object({
    accountExternalId: externalId,
    day: isoDate,
    amount: signedAmount,
    payee: text.nullable(),
    note: text.nullable(),
    categoryExternalId: externalId.nullable(),
  }),
});
export const pushResponseSchema = z.object({
  /** `null`: the answer of the provider carried no id; the movement may exist all the same. */
  externalId: externalId.nullable(),
  /** The payee reached the provider; `false` keeps the core's own. */
  payeeSent: z.boolean(),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

/* edit: a person's edit of a movement of the source (`editRecord`) */

export const editRequestSchema = z.object({
  credentials,
  externalId,
  edit: z.object({
    type: z.enum(["income", "expense", "transfer"]),
    /** The size, never negative: the type decides the direction. */
    amount: z.string().regex(/^\d{1,15}(\.\d{1,8})?$/),
    payee: text.nullable(),
    note: text.nullable(),
  }),
});
export const editResponseSchema = z.discriminatedUnion("state", [
  /** `movement`: the movement as the source holds it now, `null` when its answer carried none. */
  z.object({ state: z.literal("saved"), movement: movementSchema.nullable() }),
  z.object({ state: z.literal("unchanged") }),
  /** The source said no; the reason is a code, never the provider's words. */
  z.object({
    state: z.literal("refused"),
    reason: z.enum(["zero_amount", "no_transfer_category", "gone", "provider_refused"]),
  }),
]);
export type EditResponse = z.infer<typeof editResponseSchema>;

/* categories written at the source (`categories`; deleting: `deleteCategory`) */

export const writeCategoriesRequestSchema = z.object({
  credentials,
  rename: z.array(z.object({ externalId, name: z.string().min(1).max(200) })).max(100),
  create: z.array(z.object({ name: z.string().min(1).max(200), parentExternalId: externalId })).max(100),
  remove: z.array(externalId).max(100),
});
const writeOutcome = z.object({ externalId, ok: z.boolean() });
export const writeCategoriesResponseSchema = z.object({
  renamed: z.array(writeOutcome).max(100),
  /** In the order asked; `externalId` `null` when the answer carried none — the category may exist. */
  created: z.array(z.object({ externalId: externalId.nullable() })).max(100),
  removed: z.array(writeOutcome).max(100),
});
export type WriteCategoriesResponse = z.infer<typeof writeCategoriesResponseSchema>;

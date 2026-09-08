import { z } from "@hono/zod-openapi";

export const TransactionTypeSchema = z.enum(["income", "expense", "transfer"]).openapi("TransactionType");
export const TransactionStateSchema = z.enum(["pending", "cleared", "reconciled"]).openapi("TransactionState");
export const CategoryKindSchema = z.enum(["income", "expense", "transfer", "system"]).openapi("CategoryKind");
export const RecordSourceSchema = z.enum(["manual", "provider", "system", "migration"]).openapi("RecordSource");

export const TransactionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    occurredAt: z.string(),
    bookedAt: z.string().nullable(),
    amount: z.string(),
    currency: z.string(),
    type: TransactionTypeSchema,
    state: TransactionStateSchema,
    categoryId: z.string().uuid().nullable(),
    payee: z.string().nullable(),
    note: z.string().nullable(),
    transferGroupId: z.string().uuid().nullable(),
    source: RecordSourceSchema,
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Transaction");

export const TransactionCategorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    groupName: z.string().nullable(),
    kind: CategoryKindSchema,
    color: z.string().nullable(),
    source: RecordSourceSchema,
    archivedAt: z.string().nullable(),
  })
  .openapi("TransactionCategory");

export const TransactionLabelSchema = z
  .object({ id: z.string().uuid(), name: z.string(), color: z.string().nullable(), source: RecordSourceSchema })
  .openapi("TransactionLabel");

export const TransactionListItemSchema = z
  .object({ transaction: TransactionSchema, category: TransactionCategorySchema.nullable(), labelIds: z.array(z.string().uuid()) })
  .openapi("TransactionListItem");

export const TransactionListResponseSchema = z
  .object({ items: z.array(TransactionListItemSchema), nextCursor: z.string().nullable() })
  .openapi("TransactionListResponse");

/**
 * A bare `z.string()` accepted anything, including `"banana"` — the fake
 * repository silently returned an empty page for it, while the Drizzle
 * repository's `new Date(opts.from)` produced an Invalid Date that later
 * blew up as a 500 (`RangeError` on `.toISOString()`). Reject it here
 * instead, at the schema boundary, so both sides agree it never reaches a
 * repository at all.
 */
const dateTimeString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a valid date-time" });

export const ListTransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  type: TransactionTypeSchema.optional(),
  from: dateTimeString.optional(),
  to: dateTimeString.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const UpdateTransactionRequestSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  state: TransactionStateSchema.optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  version: z.number().int().optional(),
});

export const CategoryListResponseSchema = z.object({ items: z.array(TransactionCategorySchema) }).openapi("CategoryListResponse");
export const LabelListResponseSchema = z.object({ items: z.array(TransactionLabelSchema) }).openapi("LabelListResponse");

export const CadenceSchema = z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]).openapi("Cadence");

export const RecurringPatternSchema = z
  .object({
    id: z.string().uuid(),
    payee: z.string(),
    cadence: CadenceSchema,
    amountLow: z.string(),
    amountHigh: z.string(),
    currency: z.string(),
    lastSeenAt: z.string(),
    nextExpectedAt: z.string().nullable(),
    occurrenceCount: z.number(),
  })
  .openapi("RecurringPattern");
export const RecurringPatternListResponseSchema = z
  .object({ items: z.array(RecurringPatternSchema) })
  .openapi("RecurringPatternListResponse");

// `ErrorResponseSchema` itself is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration. Every route in this app shares
// one `OpenAPIHono` instance, so a second module-local declaration tagged
// with the same OpenAPI component name would collide with it at
// `npm run openapi:generate` time — see the corrected Ruling P3-11.

/**
 * The management write schemas (Phase 9). `TransactionCategorySchema` above is
 * the shared response shape; `parentId` is deliberately absent from it and is
 * write-only here, because nothing reads a hierarchy yet.
 */
export const CreateCategoryRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    kind: CategoryKindSchema.optional(),
    groupName: z.string().max(120).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .openapi("CreateCategoryRequest");

export const UpdateCategoryRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    color: z.string().max(32).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .openapi("UpdateCategoryRequest");

export const CreateLabelRequestSchema = z
  .object({ name: z.string().min(1).max(120), color: z.string().max(32).nullable().optional() })
  .openapi("CreateLabelRequest");

export const UpdateLabelRequestSchema = z
  .object({ name: z.string().min(1).max(120).optional(), color: z.string().max(32).nullable().optional() })
  .openapi("UpdateLabelRequest");

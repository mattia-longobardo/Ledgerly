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

export const ListTransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  type: TransactionTypeSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
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

// `ErrorResponseSchema` itself is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration. Every route in this app shares
// one `OpenAPIHono` instance, so a second module-local declaration tagged
// with the same OpenAPI component name would collide with it at
// `npm run openapi:generate` time — see the corrected Ruling P3-11.

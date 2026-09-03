import { z } from "@hono/zod-openapi";

/**
 * DTO and request Zod schemas for the accounts REST API. Kept apart from
 * `routes.ts` so the integration test can import the exact schema each route
 * responds with and assert every response body against it.
 *
 * Dates are always ISO strings, money is always a decimal string, and a
 * `MonthPoint`'s `value` is a number or null — the same wire rule the rest of
 * the app's DTOs follow (see `@/lib/contracts`).
 */

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const decimal = /^-?\d+(\.\d{1,2})?$/;

export const AccountTypeSchema = z
  .enum(["checking", "savings", "cash", "investment", "pension_fund", "crypto", "credit", "other"])
  .openapi("AccountType");
export const AccountStatusSchema = z.enum(["active", "unavailable", "archived"]).openapi("AccountStatus");
export const AccountOriginSchema = z.enum(["manual", "synced"]).openapi("AccountOrigin");
export const BalanceSourceSchema = z.enum(["manual", "provider", "system", "migration"]).openapi("BalanceSource");

export const AccountSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid().nullable(),
    name: z.string(),
    type: AccountTypeSchema,
    currency: z.string(),
    origin: AccountOriginSchema,
    provider: z.string().nullable(),
    status: AccountStatusSchema,
    includeInNetWorth: z.boolean(),
    notes: z.string().nullable(),
    sortOrder: z.number(),
    version: z.number(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Account");

export const BalancePointSchema = z
  .object({
    accountId: z.string().uuid(),
    asOf: z.string(),
    balance: z.string(),
    available: z.string().nullable(),
    source: BalanceSourceSchema,
    capturedAt: z.string(),
  })
  .openapi("BalancePoint");

export const MonthPointSchema = z
  .object({
    month: z.string(),
    value: z.number().nullable(),
  })
  .openapi("MonthPoint");

export const ProviderLinkSchema = z
  .object({
    provider: z.string(),
    entityType: z.literal("account"),
    entityId: z.string().uuid(),
    externalId: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    missingSince: z.string().nullable(),
  })
  .openapi("ProviderLink");

export const AccountListItemSchema = z
  .object({
    account: AccountSchema,
    latest: BalancePointSchema.nullable(),
    trend: z.array(MonthPointSchema),
    stale: z.boolean(),
  })
  .openapi("AccountListItem");

export const AccountListResponseSchema = z
  .object({ items: z.array(AccountListItemSchema) })
  .openapi("AccountListResponse");

export const AccountDetailSchema = z
  .object({
    account: AccountSchema,
    latest: BalancePointSchema.nullable(),
    history: z.array(BalancePointSchema),
    series: z.array(MonthPointSchema),
    link: ProviderLinkSchema.nullable(),
    stale: z.boolean(),
  })
  .openapi("AccountDetail");

export const DeleteAccountResponseSchema = z
  .object({ outcome: z.enum(["deleted", "archived"]) })
  .openapi("DeleteAccountResponse");

export const DeleteResponseSchema = z.object({ deleted: z.literal(true) }).openapi("DeleteResponse");

export const BalancesPageSchema = z
  .object({
    items: z.array(BalancePointSchema),
    nextCursor: z.string().optional(),
  })
  .openapi("BalancesPage");

export const AccountGroupSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    sortOrder: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AccountGroup");

export const AccountGroupListResponseSchema = z
  .object({ items: z.array(AccountGroupSchema) })
  .openapi("AccountGroupListResponse");

export const NetWorthAccountSeriesSchema = z
  .object({
    account: AccountSchema,
    series: z.array(MonthPointSchema),
    latest: BalancePointSchema.nullable(),
  })
  .openapi("NetWorthAccountSeries");

export const NetWorthSeriesSchema = z
  .object({
    months: z.array(z.string()),
    total: z.array(MonthPointSchema),
    perAccount: z.array(NetWorthAccountSeriesSchema),
    asOf: z.string().nullable(),
    stale: z.boolean(),
    unavailableCount: z.number(),
  })
  .openapi("NetWorthSeries");

export const WalletSyncResultSchema = z
  .object({
    created: z.number(),
    updated: z.number(),
    adopted: z.number(),
    balances: z.number(),
    missing: z.number(),
  })
  .openapi("WalletSyncResult");

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse");

// ---- Request bodies ----

export const CreateAccountRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: AccountTypeSchema,
    currency: z.string().length(3).optional(),
    groupId: z.string().uuid().nullable().optional(),
    includeInNetWorth: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
    openingBalance: z
      .object({ asOf: z.string().regex(dateOnly), balance: z.string().regex(decimal) })
      .optional(),
  })
  .openapi("CreateAccountRequest");

export const UpdateAccountRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: AccountTypeSchema.optional(),
    currency: z.string().length(3).optional(),
    groupId: z.string().uuid().nullable().optional(),
    includeInNetWorth: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
    sortOrder: z.number().int().optional(),
    /** Fallback when `If-Match` is not sent. */
    version: z.number().int().optional(),
  })
  .openapi("UpdateAccountRequest");

export const RecordBalanceRequestSchema = z
  .object({
    asOf: z.string().regex(dateOnly),
    balance: z.string().regex(decimal),
    available: z.string().regex(decimal).nullable().optional(),
  })
  .openapi("RecordBalanceRequest");

export const CreateGroupRequestSchema = z
  .object({ name: z.string().min(1).max(120), sortOrder: z.number().int().optional() })
  .openapi("CreateGroupRequest");

export const RenameGroupRequestSchema = z.object({ name: z.string().min(1).max(120) }).openapi("RenameGroupRequest");

// ---- Params and queries ----

export const AccountIdParamSchema = z.object({ id: z.string().uuid() });
export const GroupIdParamSchema = z.object({ id: z.string().uuid() });

export const ListAccountsQuerySchema = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
  months: z.string().regex(/^\d+$/).optional(),
});

export const AccountDetailQuerySchema = z.object({
  months: z.string().regex(/^\d+$/).optional(),
});

export const DeleteAccountQuerySchema = z.object({
  confirmSynced: z.enum(["true", "false"]).optional(),
});

export const BalancesQuerySchema = z.object({
  from: z.string().regex(dateOnly).optional(),
  to: z.string().regex(dateOnly).optional(),
  cursor: z.string().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const NetWorthQuerySchema = z.object({
  months: z.string().regex(/^\d+$/).optional(),
});

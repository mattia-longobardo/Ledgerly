import { z } from "@hono/zod-openapi";
import { PERMISSIONS } from "@/platform/auth/permissions";

/**
 * Wire shapes for the Security module.
 *
 * `ErrorResponseSchema` is NOT declared here: it is imported from
 * `@/modules/accounts/api/schemas` in `routes.ts`, the app's one existing
 * `.openapi("ErrorResponse")` registration.
 *
 * No schema in this file has a `tokenHash` field, and only
 * `CreatedTokenSchema` has a `token` one — the response to the single request
 * that mints it.
 */

export const ScopeSchema = z.enum(PERMISSIONS).openapi("SecurityScope");

export const SecurityTokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    /** The 8 characters after `pat_`, so a row is recognisable without the secret. */
    prefix: z.string(),
    scopes: z.array(ScopeSchema),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("SecurityToken");

export const SecurityTokenListResponseSchema = z
  .object({ items: z.array(SecurityTokenSchema) })
  .openapi("SecurityTokenListResponse");

export const CreateSecurityTokenRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    scopes: z.array(ScopeSchema).min(1),
    /** `YYYY-MM-DD` or a full ISO instant; omit or `null` for a token that never expires. */
    expiresAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
  })
  .openapi("CreateSecurityTokenRequest");

/**
 * The only response that ever carries `token`. It is not stored anywhere and
 * cannot be fetched again — `GET /security/tokens` returns
 * `SecurityToken`, which has no such field.
 */
export const CreatedSecurityTokenSchema = SecurityTokenSchema.extend({
  token: z.string().describe("The plain token, shown exactly once. Store it now; it cannot be retrieved again."),
}).openapi("CreatedSecurityToken");

export const SecurityTokenIdParamSchema = z.object({ id: z.string().uuid() });

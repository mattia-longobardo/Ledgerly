# Phase 8 (reduced): Personal access tokens

> **For agentic workers:** read `2026-09-07-phases-7-9-reduced-conventions.md` first, then the shared conventions. One session for the whole phase. Steps use `- [ ]` syntax.

**Goal:** Give the API a Bearer credential so scripts and the final e2e suite can call it without a browser session: personal access tokens with scopes, stored hashed, shown once, revocable. Everything else in the original Phase 8 is deferred — Authentik already provides login, password and MFA for the single user, and the session registry, invitations, roles and policies only matter with more than one user.

**Architecture:** `src/platform/auth/pat.ts` (generate / hash / parse / authenticate) + a thin `src/modules/security/` module with three use cases and three routes. Auth.js, `AUTHORIZED_SUB`, `requirePrincipal` and the cookie path are **untouched**; the API `authenticate` gains a Bearer branch in front of the cookie branch.

**Ruling kept:** R8-5 (token format `pat_<8>.<43>`, sha256 stored, scopes ⊆ permissions at creation and re-intersected at use, `last_used_at` throttled to once a minute).
**Rulings deferred:** R8-1, R8-2, R8-3, R8-4, R8-6, R8-7.

## Deferred (append to `docs/superpowers/DEFERRED.md`)

- Database session registry with list/revoke (original Tasks 2) — R8-1.
- TOTP + recovery codes + step-up, `/signin/mfa`, `mfa_required` error code (Task 3) — R8-3, R8-4. Authentik covers MFA.
- Sign-in resolution, invitations, user lifecycle, roles, organization policies, admin page (Task 5) — R8-2, R8-6, R8-7. Single user; `AUTHORIZED_SUB` stays the allowlist.
- Audit-log viewer (Task 6).
- Authorization matrix itest (Task 7 Step 1) — reopen when a second role is actually used.
- Security history (`security_events`), `qrcode` dependency.

## File structure

```
drizzle/0019_personal_access_tokens.sql
src/lib/db/schema/security.ts                 personalAccessTokens only
src/platform/auth/pat.ts (+test)
src/modules/security/application/ports.ts, deps.ts, errors.ts, {create-token,list-tokens,revoke-token}.ts, use-cases.itest.ts
src/modules/security/infrastructure/drizzle-tokens-repository.ts, deps.ts
src/modules/security/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/security/ui/run.ts, deps.ts
src/app/(app)/settings/security/page.tsx (add a bare Tokens section), src/app/actions/security.ts
```

---

### Task 1 ⚡: Migration 0019 and the token primitive

**Files:** Create `drizzle/0019_personal_access_tokens.sql`, `src/lib/db/schema/security.ts`, `src/platform/auth/pat.ts` (+`.test.ts`). Modify `schema/index.ts`, `src/lib/db/rls-matrix.itest.ts` (add the table).

- [ ] **Step 1: Schema** — `personalAccessTokens` verbatim from the original Phase 8 Task 1 (id, user_id, name, prefix, token_hash unique, scopes jsonb, expires_at, last_used_at, revoked_at, created_at). Nothing else from that file.
- [ ] **Step 2: Generate** → `0019_personal_access_tokens.sql`; append ENABLE/FORCE + owner policy on `user_id`. Add the table to `rls-matrix.itest.ts`.
- [ ] **Step 3: `pat.ts`** with the original Task 4 signatures: `generateToken(): { token, prefix, hash }`, `hashToken(token)`, `parseToken(header)`, `authenticateToken(db, token, now): Promise<{ principal, tokenId } | null>` — hash lookup under `withSystemContext`, not revoked/expired, user active, `permissions = userPermissions ∩ scopes`, `last_used_at` written at most once per minute. Constant-time compare via `crypto.timingSafeEqual` on the hash. `pat.test.ts`: format, hash determinism, `parseToken` variants (`bearer` lowercase, missing, wrong prefix).
- [ ] **Verify:** `npm run typecheck && npm test && npm run test:integration -- rls-matrix`. **Commit:** `git add -A drizzle src && git commit -m "feat(security): migration 0019 — personal access tokens; token primitive (R8-5)"`

---

### Task 2 ⚡: Bearer authentication, use cases, routes, bare UI, phase gate

**Files:** `src/modules/security/**` as in the file structure; modify `src/app/api/v1/[[...route]]/route.ts` (`authenticate`), `src/platform/http/app.ts` (`Authenticated.authMethod` produces `"token"`; OpenAPI `securitySchemes` gains `bearer`; register routes), `src/app/(app)/settings/security/page.tsx`, `src/app/actions/security.ts`, `docs/api/README.md`.

**Routes** (tag `Security`): `POST /security/tokens` (201; body carries `token` once), `GET /security/tokens`, `DELETE /security/tokens/{id}` (204). No permission code: any active user manages their own tokens.

- [ ] **Step 1: `authenticate`.** `parseToken(req.headers.get("authorization"))` first → `authenticateToken` → `{ principal, method: "token" }`; otherwise the existing cookie path. The global `X-Requested-With` check already keys on `authMethod` — confirm token requests are exempt; if it keys on something else, extend it in this step.
- [ ] **Step 2: Use cases** `createToken(deps)(principal, { name, scopes, expiresAt? })` → `{ token, record }` (scopes ⊆ `principal.permissions` else `InvalidInputError`; audit `security.token_created` with **no** token in the payload), `listTokens` (never the hash), `revokeToken`. `use-cases.itest.ts` against the real DB.
- [ ] **Step 3: Routes + `routes.itest.ts`:** token with `["accounts.read"]` → `GET /accounts` with Bearer and **no** `X-Requested-With` → 200; `POST /accounts` with it → 403; revoked → 401; expired → 401; the audit row for creation has no `token` key. `npm run openapi:generate`; README "Security" section documenting the Bearer scheme.
- [ ] **Step 4: Bare UI.** On the existing security page add a `Tokens` heading, a native `<form>` (name, scope checkboxes limited to the principal's permissions, optional expiry date) bound to `createTokenAction`, the one-time token printed in a `<code>` block on the redirect back (pass it through `searchParams` once, or render it from the action result — whichever the existing `ActionResult` pattern already supports), and a `<table>` of tokens with a Revoke button each.
- [ ] **Step 5: `DEFERRED.md`** gets the six items above.
- [ ] **Step 6: Phase gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`.
- [ ] **Commit:** `git add -A && git commit -m "feat(security): Bearer authentication with scoped personal access tokens; Phase 8 (reduced) gate green"`

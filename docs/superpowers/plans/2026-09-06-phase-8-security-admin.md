# Phase 8: Security and Administration

> **For agentic workers:** Codex — one task per run, see "How to execute a plan with Codex" in `2026-09-06-phases-5-9-shared-conventions.md`. Claude Code — `superpowers:subagent-driven-development`, one task per subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform its security surface (spec §8): a database-backed session registry that can be listed and revoked, TOTP with recovery codes and step-up enforcement, personal access tokens with scopes for the API, invitations and user lifecycle (roles, suspension) in Administration, organization policies, a security history for the user and an audit-log viewer for admins — and prove, with an authorization matrix test, that roles prevent unauthorized access.

**Architecture:** Auth.js keeps its JWT strategy and Authentik as the only login method; a `sessions` table registered at sign-in (the JWT carries the session id) gives list/revoke and the MFA step-up flag without adopting the Auth.js database adapter. The single-user allowlist (`AUTHORIZED_SUB`) becomes a bootstrap seed only (spec §10.3); sign-in is resolved against `users`/`user_identities`/`invitations`/policies. TOTP is RFC 6238 implemented with `node:crypto` (the same "no library for a 40-line primitive" stance as the SigV4 signer); the QR code uses one new dependency, `qrcode`. Everything lives in `src/modules/security/` (user-facing) and `src/modules/admin/` (administration), on `src/platform/auth/`.

**Tech stack:** as in the shared conventions, plus `qrcode` (+ `@types/qrcode`) for the enrolment QR.

**Spec:** §5.1 (identity tables), §8.1 (authentication and MFA), §8.2 (authorization), §8.4 (data protection), §4 (Settings › Security, Settings › Administration), §10.3 (bootstrap seed), §11 Phase 8 (exit: "MFA works with recovery codes" and "roles prevent unauthorized access"), §12.8, §13.1 (MFA placement default). Predecessor: Phase 7 checkpoint.

**Global Constraints:** see the shared conventions. Phase-specific:

- Migration **`0019`** (`0019_security.sql`).
- Secrets: TOTP secrets are encrypted with `credentialCipher()` (`src/platform/integrations/crypto.ts`, AES-256-GCM under `APP_ENCRYPTION_KEY`); recovery codes and PATs are stored as SHA-256 hex only and shown **once**. No API response, log line, audit payload or HTML ever carries a secret, a full token, or a TOTP secret after enrolment.
- Every new table carries `user_id` and the owner RLS policy; `invitations` and `security_events` additionally allow `app_is_admin()` (defined in `drizzle/0009_platform_rls.sql`) for reads, and admin use cases open `withUserContext(db, { userId, role: "admin" })`.
- New `ErrorCode` `mfa_required` (401). New permissions: none (PATs are self-service for any active user; admin actions use the existing `admin.users` and `admin.audit`).
- Constant-time comparisons everywhere a secret is checked (`constantTimeEqual` from `src/lib/auth/machine.ts` or `crypto.timingSafeEqual`).

## Scope cut (deferred, explicitly)

- **First-party email + password login** (Argon2id, spec §8.1): Authentik already provides password login and MFA options; a second credential store is a second attack surface. Deferred with a note in the checkpoint; `users.password_hash` is not added until then.
- **Data export and account deletion** (spec §8.4): deferred; the Account page keeps its "not available yet" state.
- **Retention policy wiring**: `policies.payrollRetentionDays` is stored but the retention job keeps reading `app_settings` (Phase 4 R4-5); Phase 9's housekeeping task wires it.
- SSO `amr`-based MFA exemption (spec §13.1): app-level TOTP applies to every login once enrolled, per the spec default.

## Rulings

- **R8-1 Session registry over the JWT.** At sign-in the `jwt` callback inserts a `sessions` row and stores its id as `token.sid`. Every principal resolution (`requirePrincipal`, `requirePrincipalOrRedirect`, the API `authenticate`) calls `touchSession(sid)`, which returns null when the row is revoked, expired, or the user is not active. The Auth.js `session` callback no longer checks `AUTHORIZED_SUB`.
- **R8-2 Sign-in resolution.** `resolveSignIn({ sub, email })`: an active `user_identities` match → allow; a suspended/deleted user → deny; a pending, unexpired invitation whose email matches (case-insensitive) → create the user (status `active`), identity and role, mark the invitation accepted, allow; `policies.autoJoin` → create a `member`; else deny. `AUTHORIZED_SUB` is read only by `bootstrapOwner` (also accepted under the spec's name `BOOTSTRAP_OWNER_SUB`).
- **R8-3 TOTP is hand-rolled** (HMAC-SHA1, 30 s step, 6 digits, ±1 step window, 20-byte secrets shown as base32) and verified against the RFC 6238 test vectors. A used TOTP step is remembered on `mfa_totp.last_used_step` so the same code cannot be replayed within its window.
- **R8-4 Step-up.** `sessions.mfa_verified_at` is set by a successful TOTP or recovery-code check. When the user has MFA enabled, or `policies.mfaRequired` is true, a session without `mfa_verified_at` is refused: pages redirect to `/signin/mfa`, the API answers `401 mfa_required`. Token-authenticated requests are exempt (a PAT is already a secret). A user under `mfaRequired` who has not enrolled is sent to `/signin/mfa` in enrol mode.
- **R8-5 Personal access tokens** are `pat_<8 char prefix>.<43 char base64url secret>`; the database keeps `prefix` and `sha256(full token)`. Scopes are a subset of the user's permissions at creation and are re-intersected with the user's current permissions at every use, so a role downgrade shrinks live tokens. `last_used_at` is written at most once per minute per token.
- **R8-6 Invitations are by email, accepted at first sign-in.** The spec's `token_hash` column exists and is filled, and the "copy invite link" surface uses it; acceptance is keyed on the email match (R8-2) because Authentik owns the login form. Documented as a deviation in the checkpoint.
- **R8-7 Policies live in `organizations.policies`** (jsonb, already present) validated by `OrganizationPoliciesSchema` = `{ invitationsOpen: boolean; autoJoin: boolean; mfaRequired: boolean; payrollRetentionDays: number; allowedIntegrations: ProviderCode[] }` with defaults `{ false, false, false, 3650, ["wallet","trek","payroll_silo"] }`. No `organization_policies` table.

## What already exists, and what happens to it

| File | Fate |
|---|---|
| `src/auth.ts` `signIn`/`jwt`/`session` callbacks, `logAuthEvent` | `signIn` calls `resolveSignIn` (R8-2, Task 5); `jwt` registers the session (R8-1) and carries `sid`; `session` drops the allowlist check and exposes `sid`. `logAuthEvent` keeps logging and additionally writes `security_events`. Tasks 2, 5. |
| `src/lib/auth/require-user.ts` (`getUserOrNull`) | Returns `{ id, email, name, sid }`. Task 2. |
| `src/platform/auth/require-principal.ts`, `src/app/api/v1/[[...route]]/route.ts` `authenticate` | Session check + MFA step-up + Bearer PAT path. Tasks 2, 3, 4. |
| `src/platform/http/app.ts` `Authenticated`, `AuthMethod` | `Authenticated` gains `sessionId: string \| null`; `"token"` is now produced. Task 4. |
| `src/platform/http/errors.ts` `ErrorCode` | Gains `mfa_required`. Task 1. |
| `src/app/(app)/settings/security/page.tsx`, `settings/_lib/load-settings.ts` (`describeCurrentSession`, `loadUsers`) | Security page rebuilt on the module loaders (sessions, MFA, tokens, history); `describeCurrentSession` deleted; `loadUsers` moves to `src/modules/admin/application/list-users.ts`. Tasks 2–6. |
| `src/app/(app)/settings/admin/page.tsx` | Users section becomes interactive (invite, role, suspend); gains a Policies section and a link to the audit viewer. Jobs panel unchanged. Task 5. |
| `src/app/(app)/settings/account/page.tsx` | Unchanged ("not available yet" for export/deletion stays). |
| `src/lib/env.ts` `AUTHORIZED_SUB` (required), `AUTHORIZED_EMAIL` | Both optional; `BOOTSTRAP_OWNER_SUB` added as an alias. `.env.example` comment updated. Task 5. |
| `src/lib/db/bootstrap.ts` `bootstrapOwner`, `src/lib/db/migrate.ts` | Read `BOOTSTRAP_OWNER_SUB ?? AUTHORIZED_SUB`; unchanged otherwise. Task 5. |
| `src/platform/auth/permissions.ts` | Unchanged. |

## File structure

```
drizzle/0019_security.sql
src/lib/db/schema/security.ts                   sessions, mfaTotp, mfaRecoveryCodes, personalAccessTokens, invitations, securityEvents
src/lib/db/security-rls.itest.ts
src/platform/auth/session-registry.ts (+itest)  createSession, touchSession, revokeSession, revokeAllSessions, listSessions, markMfaVerified
src/platform/auth/security-events.ts            SECURITY_EVENT_KINDS, recordSecurityEvent
src/platform/auth/sign-in.ts (+itest)           resolveSignIn
src/platform/auth/policies.ts (+test)           OrganizationPoliciesSchema, readPolicies
src/platform/auth/mfa-gate.ts (+test)           MfaRequiredError, needsStepUp
src/platform/auth/pat.ts (+test)                generateToken, hashToken, parseToken, authenticateToken
src/platform/http/errors.ts (modify)            mfa_required
src/modules/security/domain/totp.ts (+test)     base32, hotp, totp, verifyTotp, otpauthUri
src/modules/security/domain/recovery-codes.ts (+test)
src/modules/security/application/ports.ts, deps.ts, errors.ts, {start-totp-enrolment,confirm-totp-enrolment,verify-mfa,disable-totp,regenerate-recovery-codes,list-sessions,revoke-session,create-token,list-tokens,revoke-token,list-security-events}.ts (+tests)
src/modules/security/infrastructure/drizzle-mfa-repository.ts, drizzle-tokens-repository.ts, memory-repositories.ts (+test), deps.ts, repositories.itest.ts
src/modules/security/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/security/ui/run.ts, deps.ts, load-security.ts, MfaSection.tsx, SessionsSection.tsx, TokensSection.tsx, SecurityHistory.tsx, MfaChallenge.tsx
src/modules/admin/application/{list-users,invite-user,revoke-invitation,set-user-role,set-user-status,update-policies,list-audit-events}.ts (+tests), ports.ts, deps.ts, errors.ts
src/modules/admin/infrastructure/drizzle-admin-repository.ts, drizzle-audit-repository.ts, memory-repositories.ts, deps.ts, repositories.itest.ts
src/modules/admin/api/schemas.ts, routes.ts, routes.itest.ts
src/modules/admin/ui/run.ts, load-admin.ts, UsersSection.tsx, InviteForm.tsx, PoliciesForm.tsx, AuditTable.tsx
src/app/(auth)/signin/mfa/page.tsx, src/app/actions/security.ts, src/app/actions/admin.ts
src/app/(app)/settings/security/page.tsx (rewrite), settings/admin/page.tsx (modify), settings/admin/audit/page.tsx
src/platform/http/authorization-matrix.itest.ts
docs/deploy/phase-8-runbook.md, docs/superpowers/handoff/2026-09-06-phase-8-checkpoint.md
```

---

### Task 1: Migration 0019 — security tables and RLS

**Files:** Create `drizzle/0019_security.sql`, `src/lib/db/schema/security.ts`, `src/lib/db/security-rls.itest.ts`; modify `src/lib/db/schema/index.ts`, `src/platform/http/errors.ts` (`mfa_required`), `package.json` (`qrcode`, `@types/qrcode`).

- [ ] **Step 1: Schema**

```ts
// src/lib/db/schema/security.ts
import { check, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" }); // the helper integrations.ts already uses — import it from there if exported

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: tz("created_at").notNull().defaultNow(),
  lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
  expiresAt: tz("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  mfaVerifiedAt: tz("mfa_verified_at"),
  revokedAt: tz("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (t) => [index("sessions_user_created_idx").on(t.userId, t.createdAt.desc())]);

export const mfaTotp = pgTable("mfa_totp", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  secretCiphertext: bytea("secret_ciphertext").notNull(),
  keyId: text("key_id").notNull(),
  confirmedAt: tz("confirmed_at"),
  lastUsedStep: integer("last_used_step"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: tz("used_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("mfa_recovery_codes_hash_uq").on(t.codeHash), index("mfa_recovery_codes_user_idx").on(t.userId)]);

export const personalAccessTokens = pgTable("personal_access_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  expiresAt: tz("expires_at"),
  lastUsedAt: tz("last_used_at"),
  revokedAt: tz("revoked_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("personal_access_tokens_hash_uq").on(t.tokenHash), index("personal_access_tokens_user_idx").on(t.userId)]);

export const invitations = pgTable("invitations", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  roleCode: text("role_code").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: tz("expires_at").notNull(),
  status: text("status").notNull().default("pending"),
  acceptedAt: tz("accepted_at"),
  acceptedUserId: uuid("accepted_user_id").references(() => users.id),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("invitations_status_ck", sql`${t.status} IN ('pending','accepted','revoked','expired')`),
  uniqueIndex("invitations_pending_email_uq").on(sql`lower(${t.email})`).where(sql`status = 'pending'`),
  uniqueIndex("invitations_token_uq").on(t.tokenHash),
]);

export const securityEvents = pgTable("security_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  detail: jsonb("detail").notNull().default({}),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [index("security_events_user_created_idx").on(t.userId, t.createdAt.desc())]);

export type SessionRow = typeof sessions.$inferSelect;
export type PersonalAccessTokenRow = typeof personalAccessTokens.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type SecurityEventRow = typeof securityEvents.$inferSelect;
```

`security_events.kind` values (a `SECURITY_EVENT_KINDS` const in `src/platform/auth/security-events.ts`, Task 2): `login_success`, `login_denied`, `logout`, `session_revoked`, `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `mfa_disabled`, `recovery_code_used`, `recovery_codes_regenerated`, `token_created`, `token_used`, `token_revoked`, `invitation_created`, `invitation_revoked`, `invitation_accepted`, `user_suspended`, `user_reactivated`, `role_changed`, `policies_updated`.

- [ ] **Step 2: Generate** → `0019_security.sql`; append ENABLE/FORCE and policies: the owner policy on `user_id` for `sessions`, `mfa_totp`, `mfa_recovery_codes`, `personal_access_tokens`; for `security_events` `USING (app_is_system() OR app_is_admin() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id())`; for `invitations` `USING (app_is_system() OR app_is_admin()) WITH CHECK (app_is_system() OR app_is_admin())`.
- [ ] **Step 3:** `ErrorCode` gains `"mfa_required"`; `npm i qrcode && npm i -D @types/qrcode`.
- [ ] **Step 4: `security-rls.itest.ts`:** user B cannot see A's sessions/tokens/recovery codes; an admin context (`withUserContext(db, { userId: admin.id, role: "admin" })`) reads every `security_events` row and every invitation, a plain user context reads only its own events and no invitations; `invitations_pending_email_uq` rejects a second pending invite for the same email in a different case; `personal_access_tokens_hash_uq` rejects a duplicate hash.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration -- security-rls`; `git add drizzle src/lib/db src/platform/http/errors.ts package.json package-lock.json && git commit -m "feat(security): migration 0019 — sessions, MFA, tokens, invitations, security events"`

---

### Task 2: Session registry and sign-in wiring

**Files:** Create `src/platform/auth/session-registry.ts` (+`.itest.ts`), `src/platform/auth/security-events.ts`, `src/platform/auth/policies.ts` (+test), `src/modules/security/ui/SessionsSection.tsx`. Modify `src/auth.ts`, `src/lib/auth/require-user.ts`, `src/platform/auth/require-principal.ts`, `src/app/api/v1/[[...route]]/route.ts`, `src/platform/http/app.ts` (`Authenticated.sessionId`), `src/lib/auth/signout.ts`, `src/app/(app)/settings/security/page.tsx`, `src/app/actions/security.ts` (create).

**Interfaces — Produces:**
```ts
// session-registry.ts — rows are written under withSystemContext (the caller has no principal yet)
export async function createSession(db, input: { userId: string; ip: string | null; userAgent: string | null; now: Date }): Promise<{ id: string }>; // expiresAt = now + SESSION_MAX_AGE_S (export that constant from auth.ts)
export interface LiveSession { id: string; userId: string; mfaVerifiedAt: Date | null; lastSeenAt: Date }
export async function touchSession(db, sid: string, now: Date): Promise<LiveSession | null>; // null when missing, revoked, expired, or the user is not active; bumps last_seen_at at most once per minute
export async function revokeSession(db, userId: string, sid: string, reason: string, now: Date): Promise<boolean>;
export async function revokeAllSessions(db, userId: string, reason: string, now: Date, exceptSid?: string): Promise<number>;
export async function listSessions(db, userId: string): Promise<SessionRow[]>;   // active first, createdAt desc
export async function markMfaVerified(db, sid: string, now: Date): Promise<void>;
// security-events.ts
export async function recordSecurityEvent(db, e: { userId: string | null; kind: SecurityEventKind; ip?: string | null; userAgent?: string | null; detail?: Record<string, unknown> }): Promise<void>;
// policies.ts
export const OrganizationPoliciesSchema = z.object({ invitationsOpen: z.boolean().default(false), autoJoin: z.boolean().default(false), mfaRequired: z.boolean().default(false), payrollRetentionDays: z.number().int().min(30).default(3650), allowedIntegrations: z.array(z.enum(["wallet", "trek", "payroll_silo"])).default(["wallet", "trek", "payroll_silo"]) });
export type OrganizationPolicies = z.infer<typeof OrganizationPoliciesSchema>;
export async function readPolicies(db, organizationId: string): Promise<OrganizationPolicies>; // parse with defaults; invalid jsonb → defaults plus a logged warning
```

- [ ] **Step 1: `session-registry.itest.ts`:** create → touch returns the row; revoke → touch returns null; expired (`now` past `expiresAt`) → null; suspended user → null; `revokeAllSessions` with `exceptSid` keeps one; `touchSession` twice within a minute updates `last_seen_at` once.
- [ ] **Step 2: Implement** the registry, `recordSecurityEvent`, `readPolicies` (+ unit test of the schema defaults and of an invalid blob falling back to defaults).
- [ ] **Step 3: `auth.ts`.** `jwt` callback: when `account` is present (fresh sign-in) call `createSession` (read ip/user agent from `headers()` of `next/headers` inside a try/catch — unavailable in some Auth.js contexts, then store null) and set `token.sid`. `session` callback: remove the `AUTHORIZED_SUB` check; copy `token.sid` to `session.sid`; keep the `RefreshAccessTokenError` branch. `signIn` callback keeps the provider check **and, until Task 5, the `AUTHORIZED_SUB` comparison** so the app stays single-user between Tasks 2 and 5.
- [ ] **Step 4: Principal resolution.** `getUserOrNull()` returns `sid`. `requirePrincipal`, `requirePrincipalOrRedirect` and the API `authenticate` call `touchSession(db, sid, now)` and treat null as unauthenticated (`UnauthorizedError` / redirect / 401). `Authenticated` gains `sessionId`. `signOutAndEndSession` calls `revokeSession(..., "logout")` before the Authentik end-session redirect and records `logout`.
- [ ] **Step 5: Security page (first cut).** Replace `describeCurrentSession` with `listSessions` in `SessionsSection` (current session flagged by `sid`, "Revoke" per row, "Sign out everywhere" = `revokeAllSessions` except the current). Actions `revokeSessionAction`, `revokeOtherSessionsAction`.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- session-registry`; `git add -A src && git commit -m "feat(security): database session registry with list and revoke (R8-1)"`

---

### Task 3: TOTP, recovery codes, step-up

**Files:** Create `src/modules/security/domain/totp.ts` (+test), `recovery-codes.ts` (+test); `src/modules/security/application/ports.ts`, `deps.ts`, `errors.ts`, `start-totp-enrolment.ts`, `confirm-totp-enrolment.ts`, `verify-mfa.ts`, `disable-totp.ts`, `regenerate-recovery-codes.ts` (+tests); `src/modules/security/infrastructure/drizzle-mfa-repository.ts`, `memory-repositories.ts` (+test), `deps.ts`, `repositories.itest.ts`; `src/platform/auth/mfa-gate.ts` (+test); `src/modules/security/ui/run.ts`, `deps.ts`, `load-security.ts`, `MfaSection.tsx`, `MfaChallenge.tsx`; `src/app/(auth)/signin/mfa/page.tsx`; extend `src/app/actions/security.ts`. Modify `require-principal.ts`, the API `authenticate`, `src/platform/http/app.ts` (`onError` maps `MfaRequiredError`), `src/middleware.ts` (`/signin/mfa` public like `/signin`), `src/app/(app)/settings/security/page.tsx`.

**Interfaces — Produces:**
```ts
// domain/totp.ts
export function base32Encode(bytes: Uint8Array): string; export function base32Decode(s: string): Uint8Array;
export function hotp(secret: Uint8Array, counter: number, digits?: number): string;            // RFC 4226, HMAC-SHA1
export function totp(secret: Uint8Array, atMs: number, stepS?: number, digits?: number): string; // RFC 6238
export function verifyTotp(secret: Uint8Array, code: string, atMs: number, opts?: { window?: number; stepS?: number; lastUsedStep?: number | null }): { ok: true; step: number } | { ok: false };
export function otpauthUri(input: { issuer: string; account: string; secretBase32: string }): string;
// domain/recovery-codes.ts
export function generateRecoveryCodes(count?: number): string[];   // 10 codes "xxxxx-xxxxx" from crypto.randomBytes; alphabet without 0/O/1/I
export function hashRecoveryCode(code: string): string;             // sha256 hex of the normalised (lowercase, dash-stripped) code
// application
startTotpEnrolment(deps)(principal): Promise<{ secretBase32: string; otpauthUri: string; qrSvg: string }>   // stores the encrypted secret with confirmedAt null; re-running replaces an unconfirmed secret; refuses when already confirmed (InvalidInputError)
confirmTotpEnrolment(deps)(principal, input: { code: string; sessionId: string }): Promise<{ recoveryCodes: string[] }>  // verifies; sets confirmedAt; users.mfa_enabled = true; generates + stores hashed codes; marks the session mfa-verified; records mfa_enrolled
verifyMfa(deps)(principal, input: { code: string; sessionId: string }): Promise<{ method: "totp" | "recovery" }>   // TOTP first (lastUsedStep replay guard), then recovery codes (single use); failure → InvalidInputError + mfa_failed; 5 failures in 15 min → rate-limited (rate_limit_windows keyed by user id)
disableTotp(deps)(principal, code: string): Promise<void>            // requires a valid current code; deletes mfa_totp and recovery codes; users.mfa_enabled = false; refuses when policies.mfaRequired
regenerateRecoveryCodes(deps)(principal, code: string): Promise<{ recoveryCodes: string[] }>
// platform/auth/mfa-gate.ts
export class MfaRequiredError extends Error { readonly status = 401; readonly code = "mfa_required" }
export function needsStepUp(input: { mfaEnabled: boolean; mfaRequiredByPolicy: boolean; mfaVerifiedAt: Date | null; authMethod: "session" | "token" }): boolean;
```

- [ ] **Step 1: Domain tests.** `totp.test.ts` uses the RFC 6238 SHA-1 vectors (secret ASCII `12345678901234567890`, 8 digits: `59` → `94287082`, `1111111109` → `07081804`, `1234567890` → `89005924`, `2000000000` → `69279037`, `20000000000` → `65353130`), the 6-digit truncation of the same, a ±1-step window accept/reject, and the replay guard (`lastUsedStep` equal to the matching step → `ok: false`). `recovery-codes.test.ts`: 10 unique codes, alphabet check, hash normalisation (`"ABCDE-FGHIJ"` and `"abcdefghij"` hash equal).
- [ ] **Step 2: Implement** the domain with `node:crypto` (`createHmac("sha1")`, `randomBytes`); `qrSvg` via `QRCode.toString(uri, { type: "svg" })`.
- [ ] **Step 3: Ports + repositories.** `MfaRepository { get(userId); upsertSecret(userId, ciphertext: Buffer, keyId); confirm(userId, at); setLastUsedStep(userId, step); delete(userId); replaceRecoveryCodes(userId, hashes); countUnusedRecoveryCodes(userId); consumeRecoveryCode(userId, hash, at): Promise<boolean> }`, `UsersFlagRepository { setMfaEnabled(userId, enabled) }`, `SessionsPort { markMfaVerified(sid, at) }` (wrapping the registry), `Cipher` (from `credentialCipher()`), `PoliciesPort { read(organizationId) }`, `Clock`, `audit`, `securityEvents`. Memory + Drizzle + `repositories.itest.ts` (`consumeRecoveryCode` is single-use: two concurrent consumes of one hash → exactly one `true`).
- [ ] **Step 4: Use cases + tests** (memory repos): the enrolment secret never appears in the audit payload (assert the audit `after` has no `secret` key); `verifyMfa` marks the session; a recovery code works once; `disableTotp` refused under `mfaRequired`.
- [ ] **Step 5: Gate.** `needsStepUp` unit-tested for every combination. `requirePrincipal`/`requirePrincipalOrRedirect` read `users.mfa_enabled` + policies + `LiveSession.mfaVerifiedAt`; throw `MfaRequiredError` / `redirect("/signin/mfa?next=<path>")`. The API `authenticate` path maps `MfaRequiredError` to `401 mfa_required` in `app.onError`. Token auth is exempt.
- [ ] **Step 6: UI.** `/signin/mfa`: `MfaChallenge` (code input, "use a recovery code" toggle; on success redirect to `next` or `/`; in enrol mode — MFA required by policy and not enrolled — shows the QR + confirm flow). `MfaSection` on `/settings/security`: enrol (QR, secret, confirm), show recovery codes once with an "I have saved them" acknowledgement, regenerate, disable. Actions `startTotpAction`, `confirmTotpAction`, `verifyMfaAction`, `disableTotpAction`, `regenerateRecoveryCodesAction`.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- security`; `git add -A src && git commit -m "feat(security): TOTP with recovery codes and step-up enforcement (R8-3, R8-4)"`

---

### Task 4: Personal access tokens and Bearer authentication

**Files:** Create `src/platform/auth/pat.ts` (+test), `src/modules/security/application/{create-token,list-tokens,revoke-token,list-sessions,revoke-session,list-security-events}.ts` (+tests), `src/modules/security/infrastructure/drizzle-tokens-repository.ts` (+ memory twin), `src/modules/security/api/schemas.ts`, `routes.ts`, `routes.itest.ts`, `src/modules/security/ui/TokensSection.tsx`, `SecurityHistory.tsx`. Modify the API `authenticate`, `src/platform/http/app.ts` (OpenAPI `securitySchemes` gains `bearer`), `docs/api/*`.

**Interfaces — Produces:**
```ts
// platform/auth/pat.ts
export function generateToken(): { token: string; prefix: string; hash: string };   // "pat_" + 8 base62 + "." + 43 base64url; hash = sha256 hex of the full token
export function parseToken(header: string | null): string | null;                  // "Bearer pat_…" → token, else null
export async function authenticateToken(db, token: string, now: Date): Promise<{ principal: Principal; tokenId: string } | null>; // hash lookup; not revoked/expired; user active; permissions = user permissions ∩ scopes (R8-5); last_used_at and token_used throttled to once per minute
// use cases
createToken(deps)(principal, input: { name: string; scopes: Permission[]; expiresAt?: Date | null }): Promise<{ token: string; record: TokenView }>  // scopes ⊆ principal.permissions else InvalidInputError; the plain token is returned once and never stored
listTokens(deps)(principal): Promise<TokenView[]>   // { id, name, prefix, scopes, expiresAt, lastUsedAt, revokedAt, createdAt } — never the hash
revokeToken(deps)(principal, id: string): Promise<void>
listSessions(deps)(principal): Promise<SessionView[]>; revokeSession(deps)(principal, id: string): Promise<void>
listSecurityEvents(deps)(principal, opts?: { limit?: number; cursor?: string }): Promise<{ items: SecurityEventView[]; nextCursor: string | null }>
```

**Routes** (tag `Security`): `GET /security/sessions`, `DELETE /security/sessions/{id}`, `POST /security/tokens` (201; the body carries `token` once), `GET /security/tokens`, `DELETE /security/tokens/{id}`, `GET /security/events`, `POST /security/mfa/verify` (`{ code }`, for API clients under step-up).

- [ ] **Step 1: `pat.test.ts`:** format, hash determinism, `parseToken` variants (`bearer` lowercase, missing, wrong prefix). **`routes.itest.ts`:** a token with scopes `["accounts.read"]` → `GET /accounts` with `Authorization: Bearer …` and **no** `X-Requested-With` → 200; `POST /accounts` with it → 403 `permission_denied`; a revoked token → 401; an expired token → 401; the token works while the session is under step-up (no `mfa_required`); downgrading the user to `viewer` shrinks the token's permissions (R8-5).
- [ ] **Step 2: Implement** the token path in `authenticate` (`src/app/api/v1/[[...route]]/route.ts`): `parseToken(req.headers.get("authorization"))` first → `authenticateToken` → `{ principal, method: "token", sessionId: null }`; otherwise the cookie path from Tasks 2–3.
- [ ] **Step 3:** use cases, routes, `TokensSection` (create form with scope checkboxes limited to the principal's permissions, one-time token reveal, revoke), `SecurityHistory` (own events, newest first) on the Security page, `npm run openapi:generate`, README "Security" section documenting the Bearer scheme.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- security`; `git add -A src docs/api && git commit -m "feat(security): personal access tokens with scopes and Bearer authentication (R8-5)"`

---

### Task 5: Sign-in resolution, invitations, user lifecycle, roles, policies

**Files:** Create `src/platform/auth/sign-in.ts` (+`.itest.ts`); `src/modules/admin/application/{list-users,invite-user,revoke-invitation,set-user-role,set-user-status,update-policies}.ts` (+tests), `ports.ts`, `deps.ts`, `errors.ts`; `src/modules/admin/infrastructure/drizzle-admin-repository.ts`, `memory-repositories.ts`, `deps.ts`, `repositories.itest.ts`; `src/modules/admin/api/schemas.ts`, `routes.ts`, `routes.itest.ts`; `src/modules/admin/ui/run.ts`, `load-admin.ts`, `UsersSection.tsx`, `InviteForm.tsx`, `PoliciesForm.tsx`; `src/app/actions/admin.ts`. Modify `src/auth.ts` (`signIn` → `resolveSignIn`), `src/lib/env.ts`, `src/lib/db/bootstrap.ts`, `src/lib/db/migrate.ts`, `.env.example` (repo root), `src/app/(app)/settings/admin/page.tsx`, `settings/_lib/load-settings.ts` (remove `loadUsers`).

**Interfaces — Produces:**
```ts
// platform/auth/sign-in.ts — runs under withSystemContext (no principal yet)
export type SignInDecision = { ok: true; userId: string; created: boolean; via: "identity" | "invitation" | "auto_join" } | { ok: false; reason: "unknown_identity" | "suspended" | "deleted" | "invitation_expired" };
export async function resolveSignIn(db, input: { provider: string; subject: string; email: string | null; displayName: string | null; ip: string | null; userAgent: string | null; now: Date }): Promise<SignInDecision>;   // R8-2; records login_success / login_denied
// admin use cases (assertPermission "admin.users"; deps opened with withUserContext(role: "admin"))
listUsers(deps)(principal): Promise<{ users: AdminUserView[]; invitations: InvitationView[] }>
inviteUser(deps)(principal, input: { email: string; roleCode: RoleCode; expiresInDays?: number }): Promise<{ invitation: InvitationView; token: string }>   // an owner may invite any role; an admin may not invite owner; token shown once (R8-6); refused when policies.invitationsOpen is false and the principal is not owner
revokeInvitation(deps)(principal, id: string): Promise<void>
setUserRole(deps)(principal, userId: string, roleCode: RoleCode): Promise<void>     // one role per user (replaces user_roles rows); cannot remove the last owner; cannot change own role
setUserStatus(deps)(principal, userId: string, status: "active" | "suspended"): Promise<void>  // suspending revokes sessions and tokens; cannot suspend self or the last owner
updatePolicies(deps)(principal, patch: Partial<OrganizationPolicies>): Promise<OrganizationPolicies>  // principal.roles must include "owner"
```

**Routes** (tag `Admin`): `GET /admin/users`, `POST /admin/invitations` (201), `DELETE /admin/invitations/{id}`, `PATCH /admin/users/{id}` (`{ roleCode?, status? }`), `GET /admin/policies`, `PATCH /admin/policies`.

- [ ] **Step 1: `sign-in.itest.ts`:** known active identity → ok; suspended → `suspended`; pending invitation with a matching email in a different case → ok, `created: true`, the user has the invited role, the invitation is `accepted`; expired invitation → `invitation_expired`; unknown + `autoJoin` → member created; unknown otherwise → `unknown_identity`; every branch writes a `security_events` row.
- [ ] **Step 2: Implement `resolveSignIn`** and wire it into `auth.ts`'s `signIn` callback (`headers()` for ip/user agent in a try/catch). Delete the `AUTHORIZED_SUB`/`AUTHORIZED_EMAIL` checks from `auth.ts`; make both optional in `env.ts` and add `BOOTSTRAP_OWNER_SUB` (optional); `bootstrapOwner` reads `BOOTSTRAP_OWNER_SUB ?? AUTHORIZED_SUB`; `.env.example` documents `DASHBOARD_AUTHORIZED_SUB` as "bootstrap only, read when the users table is empty". Test env stubs that set `AUTHORIZED_SUB` may keep it.
- [ ] **Step 3: Admin use cases + tests** (memory repos): last-owner protection, self-protection, suspension cascades (assert sessions and tokens are revoked through the ports), the invitation token returned once, `updatePolicies` refused for a non-owner admin.
- [ ] **Step 4: Routes + `routes.itest.ts`** (member → 403 on every `/admin/*`; admin can invite `member` but not `owner`; owner can). `npm run openapi:generate`.
- [ ] **Step 5: Admin page.** `UsersSection` (role select, Suspend/Reactivate, pending invitations with Revoke and "Copy link" → `/signin?invite=<token>`), `InviteForm`, `PoliciesForm` (owner only). Actions in `src/app/actions/admin.ts`. Remove the "Read-only in this release" footnote.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- admin sign-in`; `git add -A src ../.env.example && git commit -m "feat(admin): sign-in resolution, invitations, user lifecycle, roles and policies (R8-2, R8-6, R8-7)"`

---

### Task 6: Audit-log viewer

**Files:** `src/modules/admin/application/list-audit-events.ts` (+test), `src/modules/admin/infrastructure/drizzle-audit-repository.ts`, `src/modules/admin/ui/AuditTable.tsx`, `src/app/(app)/settings/admin/audit/page.tsx`; route `GET /admin/audit` (query `entityType?`, `actorUserId?`, `action?`, `from?`, `to?`, `cursor?`, `limit?`); a link from the Administration page; `docs/api/*`.

- [ ] `listAuditEvents(deps)(principal, query): Promise<{ items: AuditEventView[]; nextCursor: string | null }>` asserting `admin.audit`; keyset cursor `createdAt|id`, newest first; the view redacts any payload key named `secret`, `token`, `password`, `credentials` defensively (unit test).
- [ ] Page: filters (entity type from the distinct values, actor from users, date range), table (time, actor, action, entity, request id), "Load more" via cursor, `notFound()` without `admin.audit`.
- [ ] `routes.itest.ts`: viewer → 403; admin sees events with filters applied; cursor pagination returns disjoint pages.
- [ ] **Verify / Commit:** `npm run typecheck && npm test && npm run test:integration -- admin`; `git add -A src docs/api && git commit -m "feat(admin): audit log viewer"`

---

### Task 7: Authorization matrix and exit criteria

**Files:** `src/platform/http/authorization-matrix.itest.ts`; `docs/deploy/phase-8-runbook.md`, `docs/superpowers/handoff/2026-09-06-phase-8-checkpoint.md`, `docs/architecture/overview.md`, `docs/api/README.md`, `.superpowers/sdd/MASTER-LEDGER.md`.

- [ ] **Step 1: The matrix test** (spec §9 "authorization tests (matrix of roles × endpoints)"). Build the API app with the integration harness, create one user per role (`owner`, `admin`, `member`, `viewer`) with a session each, and a table:

```ts
const MATRIX: { method: string; path: string; body?: unknown; expect: Record<RoleCode, number> }[] = [
  { method: "GET",   path: "/accounts",                       expect: { owner: 200, admin: 200, member: 200, viewer: 200 } },
  { method: "POST",  path: "/accounts", body: { /* valid */ }, expect: { owner: 201, admin: 201, member: 201, viewer: 403 } },
  { method: "GET",   path: "/admin/users",                    expect: { owner: 200, admin: 200, member: 403, viewer: 403 } },
  { method: "PATCH", path: "/admin/policies", body: {},       expect: { owner: 200, admin: 403, member: 403, viewer: 403 } },
  // … one row per route registered on the app
];
```
The test first asserts **coverage**: every `method + path` in `app.routes` (Hono exposes them) other than `/webhooks/{provider}` appears in `MATRIX`, so a route added later without a matrix row fails. Then it runs every cell (a 404 on a synthetic id counts as "allowed past authorization" and is asserted as such where the row says so). Also assert the unauthenticated case (no cookie, no token) → 401 for every row, and the step-up case (a session for a user with `mfa_enabled` and `mfa_verified_at = null`) → 401 `mfa_required` for a sample of rows.
- [ ] **Step 2: Gate.** `npm run typecheck && npm test && npm run test:db:up && npm run test:integration && npm run build && npm run openapi:generate && git diff --exit-code docs/api/openapi.json`; `grep -rn "AUTHORIZED_SUB" src` → only `env.ts` and `bootstrap.ts`; `grep -rn "describeCurrentSession" src` → nothing.
- [ ] **Step 3: Runbook.** Pre-checks (dump; after deploy the owner must enrol TOTP and **store the recovery codes before enabling `mfaRequired`**), deploy, migrate, verify: the sessions list shows the current session; enrol TOTP; sign out; sign in → `/signin/mfa` → code accepted; use a recovery code once and see it refused a second time; create a PAT and call `GET /api/v1/accounts` with it; invite a second identity and sign in with it (or record as owed). Rollback: restore the dump and the previous image — **sessions created under the new image vanish on rollback, which only forces re-login**. **Exit lines (spec §11 Phase 8): "MFA works with recovery codes" — Step 3 walkthrough; "roles prevent unauthorized access" — Step 1 matrix.**
- [ ] **Step 4:** `graphify update .`; checkpoint (rulings R8-1…R8-7; deferred: password login, export/deletion, retention wiring, `amr` exemption; the R8-6 deviation); architecture doc (`modules/security`, `modules/admin`, the auth flow); master ledger.
- [ ] **Commit:** `git add -A src ../docs ../graphify-out ../.superpowers && git commit -m "test(security): role × endpoint authorization matrix; docs(handoff): Phase 8 checkpoint and runbook"`

---

## Self-review against the spec

- §5.1: `sessions` ✔, `mfa_totp` ✔, `mfa_recovery_codes` ✔, `personal_access_tokens` ✔, `invitations` ✔ (token hash present, email-keyed acceptance — R8-6), `security_events` ✔, `organization_policies` → `organizations.policies` (R8-7). `users.password_hash` ✘ deferred with password login.
- §8.1: OIDC ✔; password login ✘ deferred; database sessions → registry over JWT (R8-1) giving list/revoke ✔; TOTP + 10 recovery codes + step-up on principal resolution ✔ (Task 3); PATs with scopes, expiry, last-used, revocation ✔ (Task 4); security history ✔.
- §8.2: permission codes unchanged ✔; roles map to permission sets ✔; matrix test ✔ (Task 7).
- §8.3: cookie mutations still need `X-Requested-With`; token auth exempt ✔.
- §8.4: TOTP secrets encrypted ✔; export/deletion ✘ deferred.
- §10.3: `AUTHORIZED_SUB` becomes a bootstrap seed ✔ (Task 5). §12.8 ✔.
- Type consistency: `LiveSession` (registry) is what `needsStepUp` consumes; `Authenticated.sessionId` is `null` for tokens and the CSRF check keys on `authMethod`; `OrganizationPolicies` is shared by `policies.ts`, `updatePolicies` and `PoliciesForm`; `SecurityEventKind` is the union of `SECURITY_EVENT_KINDS`.

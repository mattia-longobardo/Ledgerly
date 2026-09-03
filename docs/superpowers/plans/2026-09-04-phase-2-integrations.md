# Phase 2: Integration framework, encrypted credentials and the Settings split

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two file-mounted provider tokens with per-user integration connections whose credentials are encrypted at rest, put every provider behind one registry with a uniform connect / test / sync / disconnect lifecycle, record every sync as an auditable run, accept signed inbound webhooks, and split Settings into the five areas the spec names — with Expenses and Interests appearing in the navigation only once Wallet is connected.

**Architecture:** `src/platform/integrations/*` holds the provider-neutral framework — the credential cipher, the `IntegrationProvider` contract, the registry and the shared webhook signature check. `src/modules/integrations/*` is a full vertical slice in the accounts module's shape (`domain/`, `application/` with `ports.ts`, `infrastructure/` with Drizzle and memory repositories plus the two `*-adapter.ts` files, `api/`, `ui/`). The Wallet and Trek HTTP clients stop reading files and take their credential as a parameter, so the vault is the only place a secret is resolved.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7 strict, Drizzle ORM 0.45 + drizzle-kit 0.31, Postgres 18, Zod 4, Hono 4 + `@hono/zod-openapi` 1.x, `node:crypto` AES-256-GCM, vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` (sections 3.3, 3.4, 4, 5.2, 6, 8.3, 8.4, 11 Phase 2, 12).

## Global Constraints

- All UI copy, labels, errors and docs in English.
- **`APP_ENCRYPTION_KEY` is required** (spec §12 adds it). Credentials are encrypted with AES-256-GCM under it — "32-byte, env, rotation supported via `key_id`" (spec §6). The env value is a comma-separated list of `<keyId>:<base64 32-byte key>` entries; the **first entry is the active key** and every other entry exists only to decrypt older blobs.
- Cookie-authenticated `/api/v1` mutations require the `X-Requested-With` header with any non-empty value, else `403 csrf_required` (Ruling R17). The inbound webhook endpoint is the single exception: it is not cookie-authenticated at all and is verified by HMAC instead.
- Module layout: use cases in `src/modules/<domain>/application`, ports in `ports.ts`, Drizzle and memory repositories in `infrastructure/`, Hono routes in `api/`, loaders and components in `ui/`. UI and API call the same use cases.
- **Provider names appear only in `*-adapter.ts`.** `wallet-provider-adapter.ts` and `trek-provider-adapter.ts` are the only new files allowed to name Budget Makers Wallet or Trek fields. The framework, the use cases and the repositories speak `ProviderCode` and `SyncKind` only.
- Use cases take a `Principal` and assert a permission; RLS is the second wall. New tables carry `user_id` (directly or through their connection) and `FORCE ROW LEVEL SECURITY` with policies of the shape `app_is_system() OR user_id = app_current_user_id()`.
- New tables use `uuid` primary keys defaulting to `uuidv7()` and carry `created_at`/`updated_at` timestamptz. `integration_connections` carries `version integer not null default 1`; user-facing updates require the expected version and answer `version_mismatch` on conflict.
- **Secrets never leave the server.** A credential is never echoed back by an API response, never rendered into HTML, never logged, and never put in an audit `before`/`after` payload. Audit records the *fact* of a credential write, not its content (spec §3.2: "credentials metadata").
- Never invent financial data: a missing source renders an empty or setup state, never a zero.
- Migrations are generated with `npx drizzle-kit generate --name <name>` from `dashboard-app/`; RLS statements are appended to the generated file by hand, one per `--> statement-breakpoint`, exactly as `drizzle/0006_accounts.sql` does. **The next migration number is `0008`**; this plan adds `0008_provider_links_user_key`, `0009_platform_rls` and `0010_integrations`.
- Do not create git branches or worktrees (a project hook blocks it). Commit on the checked-out branch after every task.
- Run `graphify update .` from the repo root after each task that changes code.
- All commands run from `dashboard-app/` unless stated otherwise. Every commit message ends with the executing model's `Co-Authored-By:` trailer (Phase 0/1 used `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).
- Unit tests are `*.test.ts` next to the source and run with `npm test`; integration tests are `*.itest.ts` and run with `npm run test:integration` after `npm run test:db:up`.

## File Structure

Every file this phase creates or modifies, and the single thing it is responsible for.

```
dashboard-app/
  drizzle/0008_provider_links_user_key.sql   provider_links unique keys gain user_id
  drizzle/0009_platform_rls.sql              RLS on audit_events, idempotency_keys, rate_limit_windows
  drizzle/0010_integrations.sql              integration tables, their RLS, the provider seed

  src/lib/db/schema/integrations.ts          integrationProviders, integrationConnections, syncJobs, syncRuns, webhookDeliveries
  src/lib/db/schema/index.ts                 (modify) re-export ./integrations
  src/lib/db/schema/accounts.ts              (modify) provider_links unique indexes gain userId
  src/lib/env.ts                             (modify) add APP_ENCRYPTION_KEY; remove WALLET_TOKEN_FILE, TREK_TOKEN_FILE, walletToken(), trekConfig()
  src/test/db.ts                             (modify) resetDb re-seeds integration_providers

  src/platform/clock.ts                      the shared `Clock` interface
  src/platform/auth/owner.ts                 ownerUserId(db) — the single owner a job acts for
  src/platform/db/context.ts                 (modify) UserContext.role gains "admin"
  src/platform/http/app.ts                   (modify) public path prefixes skip auth/CSRF/rate limit; register integration routes
  src/platform/http/rate-limit.ts            (modify) counts inside withUserContext so its RLS policy applies
  src/platform/http/idempotency.ts           (modify) reads and writes inside withUserContext
  src/platform/integrations/types.ts         ProviderCode, IntegrationProvider, SyncContext, SyncRun, ...
  src/platform/integrations/crypto.ts        parseEncryptionKeys, createCredentialCipher, credentialCipher
  src/platform/integrations/registry.ts      registerProvider, providerRegistry, resetProviderRegistry
  src/platform/integrations/register-all.ts  ensureProvidersRegistered — wires the two adapters
  src/platform/integrations/webhook-signature.ts  verifyHmacSignature (shared, provider-neutral)
  src/platform/capabilities/resolve.ts       (modify) probes report connection states
  src/platform/capabilities/probes.ts        (modify) connectionStates reads integration_connections
  src/platform/capabilities/navigation.ts    (modify) Settings gains its five children

  src/modules/integrations/domain/connection.ts        status transitions and disconnect-policy rules
  src/modules/integrations/application/ports.ts        ConnectionsRepository, SyncRunsRepository, WebhookDeliveriesRepository
  src/modules/integrations/application/deps.ts         IntegrationDeps
  src/modules/integrations/application/errors.ts       ConnectionNotFoundError, UnknownProviderError, CredentialValidationError
  src/modules/integrations/application/connect-integration.ts
  src/modules/integrations/application/test-integration-connection.ts
  src/modules/integrations/application/disconnect-integration.ts
  src/modules/integrations/application/list-integrations.ts
  src/modules/integrations/application/run-sync.ts             the sync engine
  src/modules/integrations/application/handle-webhook.ts
  src/modules/integrations/application/import-file-credentials.ts
  src/modules/integrations/infrastructure/deps.ts               integrationDeps(tx, requestId)
  src/modules/integrations/infrastructure/drizzle-connections-repository.ts
  src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts
  src/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository.ts
  src/modules/integrations/infrastructure/memory-repositories.ts
  src/modules/integrations/infrastructure/wallet-provider-adapter.ts   the only new file naming Wallet fields
  src/modules/integrations/infrastructure/trek-provider-adapter.ts     the only new file naming Trek fields
  src/modules/integrations/api/schemas.ts, api/routes.ts
  src/modules/integrations/ui/run.ts                    runIntegrationsForPrincipal + test seams
  src/modules/integrations/ui/load-integrations.ts      the Settings › Integrations loader
  src/modules/integrations/ui/IntegrationsList.tsx, ConnectForm.tsx, DisconnectForm.tsx, SyncRunsTable.tsx

  src/lib/clients/wallet.ts                  (modify) WalletCallOptions.token, required
  src/lib/clients/trek.ts                    (modify) TrekCallOptions.config, required
  src/lib/jobs/wallet-accounts-sync.ts       (modify) runs through the sync engine
  src/lib/jobs/wallet-refresh.ts             (modify) credential from the vault
  src/lib/jobs/trek-sync.ts                  (modify) TrekConfig threaded through RunTrekSyncInput
  src/lib/jobs/trek-sync-job.ts              (modify) runs through the sync engine
  src/modules/accounts/application/sync-provider-accounts.ts  (modify) accepts pre-fetched accounts
  src/modules/accounts/infrastructure/wallet-adapter.ts       (modify) walletAccountsSource(clock, token)
  src/modules/accounts/api/routes.ts         (modify) the Phase-1 wallet sync route is removed
  src/app/actions/accounts.ts                (modify) syncWalletAction is superseded and removed
  src/app/actions/leave.ts                   (modify) resolves the Trek credential from the vault
  src/app/actions/integrations.ts            connect/test/sync/disconnect server actions
  src/app/api/v1/[[...route]]/route.ts       (modify) register providers before building the app

  src/app/(app)/settings/page.tsx            (modify) redirects to /settings/personal
  src/app/(app)/settings/personal/page.tsx   profile, theme, leave hours, vacation-fund setup
  src/app/(app)/settings/security/page.tsx   the current session
  src/app/(app)/settings/account/page.tsx    organization, roles, permissions
  src/app/(app)/settings/integrations/page.tsx and [provider]/page.tsx
  src/app/(app)/settings/admin/page.tsx      users list, scheduled jobs, recent runs, Payslip AI
  src/app/(app)/finance/expenses/page.tsx    (modify) empty state links to Settings › Integrations
  src/app/(app)/finance/interests/page.tsx   (modify) same
  src/app/(app)/finance/vacation/page.tsx    (modify) "Set it up" links to /settings/personal
  src/modules/home/cards.ts                  (modify) the accounts_sync card links to /settings/integrations

  scripts/import-file-credentials.ts         one-off import of the mounted tokens
  tests/e2e/settings.spec.ts                 the Settings routes answer and are gated

docs/architecture/overview.md                (modify) integration framework; the two deviations closed
docs/api/README.md, docs/api/openapi.json    (modify / regenerate)
docs/integrations/README.md                  the integration framework guide
docs/deploy/phase-2-runbook.md               env changes, key generation, credential import, rollback
.env.example, docker-compose.yml             (modify) APP_ENCRYPTION_KEY in, token files out
```

---

## Phase 2 — Deferred minors first

The checkpoint asks for these three before the framework lands on top of them.

### Task 1: `provider_links` unique keys gain `user_id`

**Files:**
- Modify: `dashboard-app/src/lib/db/schema/accounts.ts`
- Modify: `dashboard-app/src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts`
- Create: migration `dashboard-app/drizzle/0008_provider_links_user_key.sql`
- Test: `dashboard-app/src/modules/accounts/infrastructure/provider-links-user-key.itest.ts`

**Interfaces:**
- Consumes: `providerLinks` from `@/lib/db/schema`, `withUserContext` from `@/platform/db/context`, `ProviderLinksRepository` from `@/modules/accounts/application/ports`.
- Produces: no new exported names. The two unique indexes become `provider_links_external_uq (user_id, provider, entity_type, external_id)` and `provider_links_entity_uq (user_id, provider, entity_type, entity_id)`; `DrizzleProviderLinksRepository.upsertSeen` conflicts on the first of those.

- [ ] **Step 1: Write the failing integration test**

`src/modules/accounts/infrastructure/provider-links-user-key.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { DrizzleProviderLinksRepository } from "./drizzle-provider-links-repository";

describe("provider links are keyed per user", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lets two users hold the same provider external id", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const seenAt = new Date("2026-09-04T08:00:00Z");
    for (const user of [a!, b!]) {
      await withUserContext(db, { userId: user.id }, async (tx) => {
        const [account] = await tx
          .insert(accounts)
          .values({ userId: user.id, name: "Shared", type: "checking", origin: "synced", provider: "wallet" })
          .returning();
        await new DrizzleProviderLinksRepository(tx).upsertSeen(
          user.id,
          {
            provider: "wallet",
            entityType: "account",
            entityId: account!.id,
            externalId: "ext-1",
            metadata: { providerName: "Shared" },
          },
          seenAt,
        );
      });
    }

    for (const user of [a!, b!]) {
      const links = await withUserContext(db, { userId: user.id }, (tx) =>
        new DrizzleProviderLinksRepository(tx).byExternal(user.id, "wallet", "account", ["ext-1"]),
      );
      expect(links.get("ext-1")?.externalId).toBe("ext-1");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db:up && npm run test:integration -- provider-links-user-key`
Expected: FAIL — `duplicate key value violates unique constraint "provider_links_external_uq"`.

- [ ] **Step 3: Change the schema**

In `src/lib/db/schema/accounts.ts`, replace the index list on `providerLinks` with:
```ts
  (t) => [
    uniqueIndex("provider_links_external_uq").on(t.userId, t.provider, t.entityType, t.externalId),
    uniqueIndex("provider_links_entity_uq").on(t.userId, t.provider, t.entityType, t.entityId),
  ],
```

- [ ] **Step 4: Point the upsert at the new key**

In `src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts`, change the `onConflictDoUpdate` target inside `upsertSeen`:
```ts
      .onConflictDoUpdate({
        target: [
          providerLinks.userId,
          providerLinks.provider,
          providerLinks.entityType,
          providerLinks.externalId,
        ],
        // Seeing the entity again revives it: first_seen_at stays as it was.
        set: {
          entityId: sql`excluded.entity_id`,
          metadata: sql`excluded.metadata`,
          lastSeenAt: seenAt,
          missingSince: null,
        },
      });
```

- [ ] **Step 5: Generate the migration**

Run: `npx drizzle-kit generate --name provider_links_user_key`
Expected: `drizzle/0008_provider_links_user_key.sql` with a `DROP INDEX` / `CREATE UNIQUE INDEX` pair per index. Read the file and confirm both new indexes lead with `"user_id"`.

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS, including the new file.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(accounts): key provider links per user so a second user cannot steal a link"
```

---

### Task 2: Fetch the provider outside the user transaction

**Files:**
- Modify: `dashboard-app/src/modules/accounts/application/sync-provider-accounts.ts`
- Modify: `dashboard-app/src/lib/jobs/wallet-accounts-sync.ts`
- Modify: `dashboard-app/src/modules/accounts/api/routes.ts`
- Modify: `dashboard-app/src/app/actions/accounts.ts`
- Test: `dashboard-app/src/modules/accounts/application/sync-provider-accounts.test.ts` (add a case)

**Interfaces:**
- Consumes: `AccountsSource`, `ProviderAccount` from `@/modules/accounts/application/ports`.
- Produces: the use case's returned function gains a second parameter —
```ts
export function syncProviderAccounts(deps: SyncProviderAccountsDeps): (
  userId: string,
  prefetched?: readonly ProviderAccount[],
) => Promise<SyncProviderAccountsResult>;
```
When `prefetched` is given the use case does not call `deps.source.fetchAccounts()`, so the caller can hold the HTTP round trip outside its database transaction. Task 10's sync handler relies on this.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/accounts/application/sync-provider-accounts.test.ts`, inside the existing top-level `describe` (reuse whatever the file already calls its deps factory and user id; add `import type { AccountsSource, ProviderAccount } from "./ports";` if they are not imported yet):
```ts
  it("uses pre-fetched accounts and never calls the source", async () => {
    const deps = makeDeps();
    let fetches = 0;
    const source: AccountsSource = {
      provider: "wallet",
      fetchAccounts: async () => {
        fetches += 1;
        return [];
      },
    };
    const prefetched: ProviderAccount[] = [
      {
        externalId: "ext-1",
        name: "Prefetched",
        type: "checking",
        currency: "EUR",
        archived: false,
        balance: "10.00",
        available: null,
        asOf: "2026-09-04",
        updatedAt: null,
      },
    ];
    const result = await syncProviderAccounts({ ...deps, source })(USER_ID, prefetched);
    expect(fetches).toBe(0);
    expect(result.created).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sync-provider-accounts`
Expected: FAIL — `expected 1 to be 0` (the source was still called), or a TypeScript arity error.

- [ ] **Step 3: Accept pre-fetched accounts**

In `src/modules/accounts/application/sync-provider-accounts.ts`, replace the opening of the returned function; the body below `const incoming` is unchanged:
```ts
export function syncProviderAccounts(deps: SyncProviderAccountsDeps) {
  /**
   * `prefetched` exists so the caller can do the provider round trip *before*
   * opening the database transaction. A slow provider otherwise holds one of
   * the pool's eight connections — and, inside a job, an advisory lock — for
   * the whole conversation.
   */
  return async (
    userId: string,
    prefetched?: readonly ProviderAccount[],
  ): Promise<SyncProviderAccountsResult> => {
    const { provider } = deps.source;
    const now = deps.clock.now();
    const incoming = prefetched ?? (await deps.source.fetchAccounts());
```

- [ ] **Step 4: Fetch first in the job**

In `src/lib/jobs/wallet-accounts-sync.ts`, replace `syncOwner`:
```ts
async function syncOwner(userId: string): Promise<Record<string, unknown>> {
  const source = walletAccountsSource(clock);
  // Outside the transaction on purpose: see the note in syncProviderAccounts.
  const incoming = await source.fetchAccounts();
  const counts: SyncProviderAccountsResult = await withUserContext(db, { userId, role: "system" }, (tx) =>
    syncProviderAccounts({
      accounts: new DrizzleAccountsRepository(tx),
      links: new DrizzleProviderLinksRepository(tx),
      groups: new DrizzleGroupsRepository(tx),
      clock,
      audit: (e) => recordAudit(tx, e),
      source,
    })(userId, incoming),
  );
  return { ...counts };
}
```

- [ ] **Step 5: Fetch first in the route and the action**

In `src/modules/accounts/api/routes.ts`, inside the `walletSyncRoute` handler, replace the `withUserContext` block:
```ts
      const source = walletAccountsSource({ now: () => deps.now() });
      const incoming = await source.fetchAccounts();
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) => {
        const useCaseDeps: UseCaseDeps = accountDeps(tx, c.get("requestId"));
        return syncProviderAccounts({ ...useCaseDeps, source })(principal.userId, incoming);
      });
```
In `src/app/actions/accounts.ts`, apply the same shape inside `syncWalletAction`: build `walletAccountsSource({ now: () => new Date() })`, `await source.fetchAccounts()` before `runForPrincipal`, and pass the array as the second argument to the use case. (Task 14 later deletes this action outright once `syncIntegrationAction` replaces it; fixing it here keeps every commit in between shippable.)

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "perf(accounts): fetch the provider before opening the sync transaction"
```

---

### Task 3: Row-level security on the platform tables (R19)

**Files:**
- Modify: `dashboard-app/src/platform/db/context.ts`
- Modify: `dashboard-app/src/platform/http/rate-limit.ts`
- Modify: `dashboard-app/src/platform/http/idempotency.ts`
- Create: migration `dashboard-app/drizzle/0009_platform_rls.sql`
- Test: `dashboard-app/src/platform/db/platform-rls.itest.ts`

**Interfaces:**
- Consumes: `withUserContext`, `withSystemContext`.
- Produces: `UserContext.role` widens to `"user" | "system" | "admin"`; migration `0009` adds the SQL function `app_is_admin()` and three policies. `rateLimit` and `idempotency` keep their exported signatures — only their internals move inside a user context.

- [ ] **Step 1: Write the failing integration test**

`src/platform/db/platform-rls.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents, idempotencyKeys, organizations, rateLimitWindows, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("platform table RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("scopes audit, idempotency and rate-limit rows to their principal", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    await withSystemContext(db, async (tx) => {
      await tx.insert(auditEvents).values([
        { actorUserId: a!.id, action: "test.a", entityType: "test" },
        { actorUserId: b!.id, action: "test.b", entityType: "test" },
      ]);
      await tx.insert(idempotencyKeys).values([
        { principalId: a!.id, key: "k", requestHash: "h", expiresAt: new Date(Date.now() + 60_000) },
        { principalId: b!.id, key: "k", requestHash: "h", expiresAt: new Date(Date.now() + 60_000) },
      ]);
      await tx.insert(rateLimitWindows).values([
        { principalId: a!.id, windowStart: new Date("2026-09-04T08:00:00Z"), count: 1 },
        { principalId: b!.id, windowStart: new Date("2026-09-04T08:00:00Z"), count: 1 },
      ]);
    });

    const mineAudit = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(auditEvents));
    expect(mineAudit.map((r) => r.action)).toEqual(["test.a"]);
    const mineKeys = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(idempotencyKeys));
    expect(mineKeys).toHaveLength(1);
    const mineWindows = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(rateLimitWindows));
    expect(mineWindows).toHaveLength(1);

    const asAdmin = await withUserContext(db, { userId: a!.id, role: "admin" }, (tx) =>
      tx.select().from(auditEvents),
    );
    expect(asAdmin).toHaveLength(2);

    expect(await db.select().from(auditEvents)).toEqual([]);
    await expect(
      withUserContext(db, { userId: a!.id }, (tx) =>
        tx.insert(auditEvents).values({ actorUserId: b!.id, action: "forged", entityType: "test" }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- platform-rls`
Expected: FAIL — `expected [ 'test.a', 'test.b' ] to deeply equal [ 'test.a' ]` (no policy is in force yet).

- [ ] **Step 3: Widen the context role**

In `src/platform/db/context.ts`:
```ts
export interface UserContext {
  userId: string;
  /**
   * `system` bypasses the per-user predicate for cross-user jobs (Ruling R7).
   * `admin` is its read-side counterpart: the Administration area reads other
   * users' audit rows through an explicit policy, never through a bypass role
   * (spec §5). It never widens a WITH CHECK clause — an admin cannot forge a
   * row attributed to somebody else.
   */
  role?: "user" | "system" | "admin";
}
```

- [ ] **Step 4: Write the migration by hand**

`drizzle-kit generate` emits nothing for policies, so create `drizzle/0009_platform_rls.sql` directly:
```sql
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role', true) = 'admin' $$;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_owner ON audit_events USING (app_is_system() OR app_is_admin() OR actor_user_id = app_current_user_id()) WITH CHECK (app_is_system() OR actor_user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_owner ON idempotency_keys USING (app_is_system() OR principal_id = app_current_user_id()) WITH CHECK (app_is_system() OR principal_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE rate_limit_windows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_limit_windows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rate_limit_windows_owner ON rate_limit_windows USING (app_is_system() OR principal_id = app_current_user_id()) WITH CHECK (app_is_system() OR principal_id = app_current_user_id());
```
Then register it in drizzle's journal so `migrate()` applies it: append an entry to `drizzle/meta/_journal.json` copying the shape of the previous entry, with `"idx"` incremented, `"tag": "0009_platform_rls"`, `"breakpoints": true` and a fresh epoch-milliseconds `"when"`. Verify with `npm run test:integration -- migrations`, which re-applies every migration on an empty database.

- [ ] **Step 5: Run the middleware inside a user context**

`src/platform/http/rate-limit.ts` in full:
```ts
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { ApiError } from "./errors";

export function rateLimit(deps: {
  db: DbClient;
  now(): Date;
  limit?: number;
}): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  const limit = deps.limit ?? 300;
  return async (c, next) => {
    const start = new Date(Math.floor(deps.now().getTime() / 60_000) * 60_000);
    const principalId = c.get("principal").userId;
    // `rate_limit_windows` carries FORCE ROW LEVEL SECURITY since migration
    // 0009, so the upsert has to run where `app.user_id` is set — on the bare
    // pool the WITH CHECK clause rejects every insert.
    const count = await withUserContext(deps.db, { userId: principalId }, async (tx) => {
      const res = await tx.execute<{ count: number }>(sql`
        INSERT INTO rate_limit_windows (principal_id, window_start, count)
        VALUES (${principalId}, ${start}, 1)
        ON CONFLICT (principal_id, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
        RETURNING count`);
      return Number(res.rows[0]?.count ?? 0);
    });
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, limit - count)));
    if (count > limit) throw new ApiError(429, "rate_limited", "Too many requests; try again in a minute");
    await next();
  };
}
```
In `src/platform/http/idempotency.ts`, import `withUserContext` from `@/platform/db/context` and wrap both statements. The lookup:
```ts
    const [existing] = await withUserContext(deps.db, { userId: principalId }, (tx) =>
      tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, key)))
        .limit(1),
    );
```
The write:
```ts
    await withUserContext(deps.db, { userId: principalId }, (tx) =>
      tx
        .insert(idempotencyKeys)
        .values({
          principalId,
          key,
          requestHash,
          statusCode: res.status,
          responseBody: body,
          expiresAt: new Date(deps.now().getTime() + TTL_MS),
        })
        .onConflictDoUpdate({
          target: [idempotencyKeys.principalId, idempotencyKeys.key],
          set: {
            requestHash,
            statusCode: res.status,
            responseBody: body,
            expiresAt: new Date(deps.now().getTime() + TTL_MS),
          },
        }),
    );
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS, including `routes.itest.ts` (which exercises idempotent replay) and the new `platform-rls.itest.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(platform): row-level security on audit, idempotency and rate-limit tables"
```

---

## Phase 2 — The integration framework

### Task 4: Credential encryption under `APP_ENCRYPTION_KEY`

**Files:**
- Create: `dashboard-app/src/platform/clock.ts`
- Create: `dashboard-app/src/platform/integrations/crypto.ts`, `crypto.test.ts`
- Modify: `dashboard-app/src/lib/env.ts`

**Interfaces:**
- Consumes: `env()` from `@/lib/env`.
- Produces:
```ts
// src/platform/clock.ts
export interface Clock { now(): Date }

// src/platform/integrations/crypto.ts
export interface SealedCredential { keyId: string; ciphertext: Buffer }
export interface CredentialCipher {
  readonly activeKeyId: string;
  seal(plaintext: Record<string, string>): SealedCredential;
  open(sealed: SealedCredential): Record<string, string>;
}
export class CredentialCryptoError extends Error {}
export function parseEncryptionKeys(raw: string): Map<string, Buffer>;
export function createCredentialCipher(raw: string): CredentialCipher;
export function credentialCipher(): CredentialCipher;
export function resetCredentialCipher(): void;
```
**Key format** (documented here and in `docs/integrations/README.md`): `APP_ENCRYPTION_KEY` is `keyId:base64key[,keyId:base64key]…`, each key exactly 32 bytes once base64-decoded, each `keyId` matching `^[a-z0-9_-]{1,32}$`. The first entry is the active key. **Blob layout** is `0x01 || iv(12) || tag(16) || ciphertext`, with the key id as AES-GCM additional authenticated data so a blob cannot be replayed under a different key id.

- [ ] **Step 1: Write the failing test**

`src/platform/integrations/crypto.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialCryptoError, createCredentialCipher, parseEncryptionKeys } from "./crypto";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");

describe("parseEncryptionKeys", () => {
  it("reads a comma-separated list, active key first", () => {
    const keys = parseEncryptionKeys(`k2:${K2},k1:${K1}`);
    expect([...keys.keys()]).toEqual(["k2", "k1"]);
    expect(keys.get("k1")).toHaveLength(32);
  });

  it("refuses an empty value, a bad key id, a short key and a duplicate id", () => {
    expect(() => parseEncryptionKeys("")).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`BAD ID:${K1}`)).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`k1:${randomBytes(16).toString("base64")}`)).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`k1:${K1},k1:${K2}`)).toThrow(CredentialCryptoError);
  });
});

describe("credential cipher", () => {
  it("round-trips a credential under the active key", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const sealed = cipher.seal({ token: "wallet-secret" });
    expect(sealed.keyId).toBe("k1");
    expect(sealed.ciphertext.toString("utf8")).not.toContain("wallet-secret");
    expect(cipher.open(sealed)).toEqual({ token: "wallet-secret" });
  });

  it("produces a different blob every time", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const a = cipher.seal({ token: "same" });
    const b = cipher.seal({ token: "same" });
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("still opens a blob sealed under a retired key", () => {
    const old = createCredentialCipher(`k1:${K1}`);
    const sealed = old.seal({ token: "old-secret" });
    const rotated = createCredentialCipher(`k2:${K2},k1:${K1}`);
    expect(rotated.activeKeyId).toBe("k2");
    expect(rotated.open(sealed)).toEqual({ token: "old-secret" });
  });

  it("refuses an unknown key id, a tampered blob and a relabelled blob", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const sealed = cipher.seal({ token: "x" });
    expect(() => cipher.open({ keyId: "nope", ciphertext: sealed.ciphertext })).toThrow(CredentialCryptoError);
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => cipher.open({ keyId: "k1", ciphertext: tampered })).toThrow(CredentialCryptoError);
    const two = createCredentialCipher(`k2:${K2},k1:${K1}`);
    const underK2 = two.seal({ token: "x" });
    expect(() => two.open({ keyId: "k1", ciphertext: underK2.ciphertext })).toThrow(CredentialCryptoError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- crypto`
Expected: FAIL — `Cannot find module './crypto'`.

- [ ] **Step 3: Write the clock and the cipher**

`src/platform/clock.ts`:
```ts
/**
 * The one clock interface the platform passes around. Structurally identical
 * to the accounts module's `Clock`, so either can be handed to the other.
 */
export interface Clock {
  now(): Date;
}
```

`src/platform/integrations/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/** Anything wrong with a key, a blob, or the pairing of the two. Never carries the plaintext. */
export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

export interface SealedCredential {
  keyId: string;
  ciphertext: Buffer;
}

export interface CredentialCipher {
  readonly activeKeyId: string;
  seal(plaintext: Record<string, string>): SealedCredential;
  open(sealed: SealedCredential): Record<string, string>;
}

const KEY_ID = /^[a-z0-9_-]{1,32}$/;
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * `APP_ENCRYPTION_KEY` is `keyId:base64key[,keyId:base64key]…` and insertion
 * order is meaningful: the FIRST entry is the active key, the rest exist only
 * so blobs written before a rotation can still be opened. A Map preserves that
 * order, which is why the return type is a Map and not a plain object.
 */
export function parseEncryptionKeys(raw: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (entries.length === 0) {
    throw new CredentialCryptoError("APP_ENCRYPTION_KEY is empty; expected keyId:base64key");
  }
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new CredentialCryptoError("APP_ENCRYPTION_KEY entry is not keyId:base64key");
    }
    const keyId = entry.slice(0, separator);
    if (!KEY_ID.test(keyId)) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY key id must match ${KEY_ID.source}`);
    }
    if (keys.has(keyId)) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY repeats the key id ${keyId}`);
    }
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (key.length !== 32) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY key ${keyId} is not 32 bytes once base64-decoded`);
    }
    keys.set(keyId, key);
  }
  return keys;
}

export function createCredentialCipher(raw: string): CredentialCipher {
  const keys = parseEncryptionKeys(raw);
  const activeKeyId = [...keys.keys()][0]!;

  return {
    activeKeyId,

    seal(plaintext) {
      const key = keys.get(activeKeyId)!;
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      // The key id is authenticated, not encrypted: a blob relabelled with a
      // different key id fails its tag check instead of silently decrypting.
      cipher.setAAD(Buffer.from(activeKeyId, "utf8"));
      const body = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
      return {
        keyId: activeKeyId,
        ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]),
      };
    },

    open(sealed) {
      const key = keys.get(sealed.keyId);
      if (!key) throw new CredentialCryptoError(`No key ${sealed.keyId} in APP_ENCRYPTION_KEY`);
      const blob = sealed.ciphertext;
      if (blob.length < 1 + IV_BYTES + TAG_BYTES || blob[0] !== VERSION) {
        throw new CredentialCryptoError("Credential blob is malformed");
      }
      const iv = blob.subarray(1, 1 + IV_BYTES);
      const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const body = blob.subarray(1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(sealed.keyId, "utf8"));
      decipher.setAuthTag(tag);
      let json: string;
      try {
        json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch {
        throw new CredentialCryptoError("Credential blob failed authentication");
      }
      const parsed: unknown = JSON.parse(json);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CredentialCryptoError("Credential blob did not contain an object");
      }
      return parsed as Record<string, string>;
    },
  };
}

let cached: CredentialCipher | null = null;

/** The process-wide cipher. Memoised because parsing the key list is pure. */
export function credentialCipher(): CredentialCipher {
  if (!cached) cached = createCredentialCipher(env().APP_ENCRYPTION_KEY);
  return cached;
}

/** Test seam: `credentialCipher()` is memoised and the environment changes between cases. */
export function resetCredentialCipher(): void {
  cached = null;
}
```

- [ ] **Step 4: Add the env var**

In `src/lib/env.ts`, add to the schema next to `AUTH_SECRET`:
```ts
  /**
   * Credential encryption keys, `keyId:base64key[,keyId:base64key]…`, active
   * key first (spec §6, §12). Parsed by
   * `src/platform/integrations/crypto.ts`. Required: an integration cannot be
   * connected without it.
   */
  APP_ENCRYPTION_KEY: z.string().min(1),
```

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npm test -- crypto`
Expected: PASS (6 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(platform): AES-256-GCM credential cipher with key rotation by key id"
```

---

### Task 5: Integration tables and their row-level security

**Files:**
- Create: `dashboard-app/src/lib/db/schema/integrations.ts`
- Modify: `dashboard-app/src/lib/db/schema/index.ts`, `dashboard-app/src/test/db.ts`
- Create: migration `dashboard-app/drizzle/0010_integrations.sql` (generated, then RLS and the seed appended)
- Test: `dashboard-app/src/lib/db/integrations-rls.itest.ts`

**Interfaces:**
- Produces Drizzle exports `integrationProviders, integrationConnections, syncJobs, syncRuns, webhookDeliveries` and row types `IntegrationProviderRow, IntegrationConnectionRow, SyncJobRow, SyncRunRow, WebhookDeliveryRow`.

- [ ] **Step 1: Write the schema**

`src/lib/db/schema/integrations.ts`:
```ts
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/** Drizzle 0.45 has no first-class bytea column; this is the documented custom type. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Static catalogue, seeded by the migration; `capabilities` mirrors each adapter's own list. */
export const integrationProviders = pgTable("integration_providers", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  capabilities: jsonb("capabilities").notNull().default([]),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull().references(() => integrationProviders.code),
    status: text("status").notNull().default("disconnected"),
    credentialsCiphertext: bytea("credentials_ciphertext"),
    keyId: text("key_id"),
    settings: jsonb("settings").notNull().default({}),
    lastTestAt: tz("last_test_at"),
    lastSyncAt: tz("last_sync_at"),
    lastError: text("last_error"),
    disconnectPolicy: text("disconnect_policy").notNull().default("keep"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("integration_connections_status_ck", sql`${t.status} IN ('disconnected','connected','error','disabled')`),
    check("integration_connections_policy_ck", sql`${t.disconnectPolicy} IN ('keep','archive','purge')`),
    uniqueIndex("integration_connections_user_provider_uq").on(t.userId, t.provider),
  ],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The dispatch tier the job registry runs this on, not a cron expression — see Ruling P2-4. */
    schedule: text("schedule").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("sync_jobs_schedule_ck", sql`${t.schedule} IN ('hourly','daily','monthly')`),
    uniqueIndex("sync_jobs_connection_kind_uq").on(t.connectionId, t.kind),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    trigger: text("trigger").notNull(),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    check("sync_runs_status_ck", sql`${t.status} IN ('running','success','failed','skipped')`),
    check("sync_runs_trigger_ck", sql`${t.trigger} IN ('cron','manual','webhook','api')`),
    index("sync_runs_connection_started_idx").on(t.connectionId, t.startedAt.desc()),
  ],
);

/**
 * One row per webhook seen. `direction` is present from the start so Phase 9's
 * outbound deliveries reuse this table instead of adding a near-twin.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    direction: text("direction").notNull().default("inbound"),
    event: text("event").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    responseCode: integer("response_code"),
    error: text("error"),
    receivedAt: tz("received_at").notNull().defaultNow(),
  },
  (t) => [
    check("webhook_deliveries_direction_ck", sql`${t.direction} IN ('inbound','outbound')`),
    check("webhook_deliveries_status_ck", sql`${t.status} IN ('accepted','rejected','delivered','failed')`),
    index("webhook_deliveries_provider_received_idx").on(t.provider, t.receivedAt.desc()),
  ],
);

export type IntegrationProviderRow = typeof integrationProviders.$inferSelect;
export type IntegrationConnectionRow = typeof integrationConnections.$inferSelect;
export type SyncJobRow = typeof syncJobs.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
```
Add `export * from "./integrations";` to `src/lib/db/schema/index.ts`.

- [ ] **Step 2: Generate the migration, then append the seed and RLS**

Run: `npx drizzle-kit generate --name integrations`
Then append to `drizzle/0010_integrations.sql`:
```sql
--> statement-breakpoint
INSERT INTO integration_providers (code, label, capabilities) VALUES
  ('wallet', 'Budget Makers Wallet', '["accounts","transactions","interest_posting"]'::jsonb),
  ('trek', 'Trek', '["leave"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_connections_owner ON integration_connections USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sync_jobs_owner ON sync_jobs USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sync_runs_owner ON sync_runs USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_deliveries_owner ON webhook_deliveries USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));
```

- [ ] **Step 3: Keep the provider seed alive across `resetDb`**

`resetDb` truncates every public table, the provider catalogue included. In `src/test/db.ts`, after the `TRUNCATE`, append:
```ts
  await d.execute(sql`
    INSERT INTO integration_providers (code, label, capabilities) VALUES
      ('wallet', 'Budget Makers Wallet', '["accounts","transactions","interest_posting"]'::jsonb),
      ('trek', 'Trek', '["leave"]'::jsonb)
    ON CONFLICT (code) DO NOTHING`);
```

- [ ] **Step 4: Write the RLS test**

`src/lib/db/integrations-rls.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { integrationConnections, integrationProviders, organizations, syncRuns, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("integration tables RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("seeds the provider catalogue and scopes connections and runs per user", async () => {
    const db = await testDb();
    const providers = await db.select().from(integrationProviders);
    expect(providers.map((p) => p.code).sort()).toEqual(["trek", "wallet"]);

    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const created = await withSystemContext(db, (tx) =>
      tx
        .insert(integrationConnections)
        .values([
          { userId: a!.id, provider: "wallet", status: "connected" },
          { userId: b!.id, provider: "wallet", status: "connected" },
        ])
        .returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(syncRuns).values([
        { connectionId: created[0]!.id, kind: "accounts", status: "success", trigger: "manual" },
        { connectionId: created[1]!.id, kind: "accounts", status: "success", trigger: "manual" },
      ]),
    );

    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(integrationConnections));
    expect(mine).toHaveLength(1);
    const myRuns = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(syncRuns));
    expect(myRuns).toHaveLength(1);
    expect(await db.select().from(integrationConnections)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run**

Run: `npm run typecheck && npm run test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(integrations): connections, sync jobs, sync runs and webhook deliveries with RLS"
```

---

### Task 6: Framework contract, provider registry and shared HMAC verification

**Files:**
- Create: `dashboard-app/src/platform/integrations/types.ts`
- Create: `dashboard-app/src/platform/integrations/registry.ts`, `registry.test.ts`
- Create: `dashboard-app/src/platform/integrations/webhook-signature.ts`, `webhook-signature.test.ts`

**Interfaces:**
- Consumes: `Clock` from `@/platform/clock`, `DbClient` from `@/lib/db/client`, `AuditInput` from `@/platform/audit/record`, `ZodType` from `zod`.
- Produces the whole framework vocabulary, used verbatim by Tasks 7–18:
```ts
export type ProviderCode = "wallet" | "trek";
export type IntegrationCapability = "accounts" | "transactions" | "interest_posting" | "leave" | "documents";
export type ConnectionStatus = "disconnected" | "connected" | "error" | "disabled";
export type DisconnectPolicy = "keep" | "archive" | "purge";
export type SyncKind = "accounts" | "leave";
export type SyncTrigger = "cron" | "manual" | "webhook" | "api";
export type SyncRunStatus = "running" | "success" | "failed" | "skipped";

export interface IntegrationConnection {
  id: string; userId: string; provider: ProviderCode; status: ConnectionStatus;
  settings: Record<string, unknown>; lastTestAt: Date | null; lastSyncAt: Date | null;
  lastError: string | null; disconnectPolicy: DisconnectPolicy; version: number;
  createdAt: Date; updatedAt: Date;
}
export interface SyncRun {
  id: string; connectionId: string; kind: SyncKind; status: SyncRunStatus; trigger: SyncTrigger;
  stats: Record<string, number>; error: string | null; startedAt: Date; finishedAt: Date | null;
}
export interface TestResult { ok: boolean; message: string }
export interface CredentialField { name: string; label: string; secret: boolean; placeholder?: string }
export interface SyncContext {
  connection: IntegrationConnection; credentials: Record<string, string>; runId: string;
  db: DbClient; clock: Clock; audit(e: AuditInput): Promise<void>;
}
export interface DisconnectContext {
  connection: IntegrationConnection; policy: DisconnectPolicy;
  db: DbClient; clock: Clock; audit(e: AuditInput): Promise<void>;
}
export type SyncHandler = (ctx: SyncContext) => Promise<Record<string, number>>;
export interface WebhookRequest { rawBody: string; headers: Headers }
export interface SyncRequest { kind: SyncKind; event: string }
export interface IntegrationProvider {
  code: ProviderCode; label: string; capabilities: readonly IntegrationCapability[];
  credentialSchema: ZodType<Record<string, string>>;
  credentialFields: readonly CredentialField[];
  testConnection(credentials: Record<string, string>, settings: Record<string, unknown>): Promise<TestResult>;
  syncs: Partial<Record<SyncKind, SyncHandler>>;
  webhook?: { verify(req: WebhookRequest, secret: string): boolean; toSyncRequests(payload: unknown): SyncRequest[] };
  onDisconnect(ctx: DisconnectContext): Promise<void>;
}
export interface ProviderRegistry {
  get(code: string): IntegrationProvider | null;
  list(): IntegrationProvider[];
}
// registry.ts
export function registerProvider(p: IntegrationProvider): void;
export const providerRegistry: ProviderRegistry;
export function resetProviderRegistry(): void;
// webhook-signature.ts
export function verifyHmacSignature(input: { rawBody: string; presented: string | null; secret: string }): boolean;
```

- [ ] **Step 1: Write the failing tests**

`src/platform/integrations/registry.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { providerRegistry, registerProvider, resetProviderRegistry } from "./registry";
import type { IntegrationProvider, ProviderCode } from "./types";

function stub(code: ProviderCode): IntegrationProvider {
  return {
    code,
    label: code,
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

describe("provider registry", () => {
  beforeEach(resetProviderRegistry);

  it("returns a registered provider and null for anything else", () => {
    registerProvider(stub("wallet"));
    expect(providerRegistry.get("wallet")?.label).toBe("wallet");
    expect(providerRegistry.get("nope")).toBeNull();
  });

  it("lists providers in registration order and refuses a duplicate", () => {
    registerProvider(stub("wallet"));
    registerProvider(stub("trek"));
    expect(providerRegistry.list().map((p) => p.code)).toEqual(["wallet", "trek"]);
    expect(() => registerProvider(stub("wallet"))).toThrow(/already registered/);
  });
});
```

`src/platform/integrations/webhook-signature.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "./webhook-signature";

const SECRET = "shhh";
const BODY = '{"event":"sync.requested"}';
const GOOD = `sha256=${createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex")}`;

describe("verifyHmacSignature", () => {
  it("accepts a correct sha256 signature, with or without the prefix", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: SECRET })).toBe(true);
    expect(
      verifyHmacSignature({ rawBody: BODY, presented: GOOD.slice("sha256=".length), secret: SECRET }),
    ).toBe(true);
  });

  it("rejects a missing, empty, malformed, wrong-body and wrong-secret signature", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: null, secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: "", secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: "sha256=zz", secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: "{}", presented: GOOD, secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: "other" })).toBe(false);
  });

  it("rejects everything when the secret is empty", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: "" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- integrations/registry integrations/webhook-signature`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write `types.ts`**

Create `src/platform/integrations/types.ts` containing exactly the declarations listed under **Interfaces** above (minus the `registry.ts` / `webhook-signature.ts` lines), with these imports at the top and a doc comment on `IntegrationProvider` naming spec §6 as its source:
```ts
import type { ZodType } from "zod";
import type { DbClient } from "@/lib/db/client";
import type { AuditInput } from "@/platform/audit/record";
import type { Clock } from "@/platform/clock";
```

- [ ] **Step 4: Write the registry and the signature helper**

`src/platform/integrations/registry.ts`:
```ts
import type { IntegrationProvider, ProviderRegistry } from "./types";

const providers = new Map<string, IntegrationProvider>();

export function registerProvider(provider: IntegrationProvider): void {
  if (providers.has(provider.code)) throw new Error(`provider ${provider.code} is already registered`);
  providers.set(provider.code, provider);
}

/**
 * The read side, handed to use cases as a port so a test can pass a two-line
 * stub instead of registering the real adapters.
 */
export const providerRegistry: ProviderRegistry = {
  get: (code) => providers.get(code) ?? null,
  list: () => [...providers.values()],
};

export function resetProviderRegistry(): void {
  providers.clear();
}
```

`src/platform/integrations/webhook-signature.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `X-Signature: sha256=<hex>` over the RAW request body (spec §6). Shared by
 * every adapter rather than reimplemented per provider, because getting the
 * comparison wrong is the whole vulnerability: the presented value is shape-
 * checked and hex-decoded to a fixed 32 bytes before `timingSafeEqual`, so
 * neither its length nor its prefix leaks through an early return.
 */
export function verifyHmacSignature(input: {
  rawBody: string;
  presented: string | null;
  secret: string;
}): boolean {
  if (!input.secret) return false;
  const presented = (input.presented ?? "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  const expected = createHmac("sha256", input.secret).update(input.rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(presented, "hex"), expected);
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npm test -- integrations/registry integrations/webhook-signature`
Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(integrations): provider contract, registry and shared webhook signature check"
```

---
### Task 7: Connection domain, ports and in-memory repositories

**Files:**
- Create: `dashboard-app/src/modules/integrations/domain/connection.ts`, `connection.test.ts`
- Create: `dashboard-app/src/modules/integrations/application/ports.ts`
- Create: `dashboard-app/src/modules/integrations/application/deps.ts`
- Create: `dashboard-app/src/modules/integrations/application/errors.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/memory-repositories.ts`, `memory-repositories.test.ts`

**Interfaces:**
- Consumes: everything from `@/platform/integrations/types`, `SealedCredential`/`CredentialCipher` from `@/platform/integrations/crypto`, `AuditInput` from `@/platform/audit/record`, `DbClient` from `@/lib/db/client`.
- Produces:
```ts
// domain/connection.ts
export function statusAfterTest(result: TestResult): ConnectionStatus;               // ok → "connected", else "error"
export function isUsable(c: IntegrationConnection): boolean;                          // status === "connected"
export function nextStatusAfterSync(failed: boolean): ConnectionStatus;               // failed → "error", else "connected"
export const DISCONNECT_POLICIES: readonly DisconnectPolicy[];
export function describeDisconnectPolicy(p: DisconnectPolicy): string;

// application/ports.ts
export interface NewConnection {
  userId: string; provider: ProviderCode; status: ConnectionStatus;
  settings: Record<string, unknown>; disconnectPolicy: DisconnectPolicy;
}
export type ConnectionPatch = Partial<Pick<IntegrationConnection, "settings" | "disconnectPolicy">>;
export interface ConnectionStatePatch {
  status?: ConnectionStatus; lastTestAt?: Date | null; lastSyncAt?: Date | null; lastError?: string | null;
}
export interface ConnectionsRepository {
  list(userId: string): Promise<IntegrationConnection[]>;
  get(userId: string, id: string): Promise<IntegrationConnection | null>;
  getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null>;
  create(input: NewConnection): Promise<IntegrationConnection>;
  update(userId: string, id: string, expectedVersion: number, patch: ConnectionPatch):
    Promise<IntegrationConnection | "version_mismatch" | null>;
  recordState(id: string, patch: ConnectionStatePatch): Promise<void>;
  delete(userId: string, id: string): Promise<boolean>;
  readCredentials(userId: string, id: string): Promise<SealedCredential | null>;
  writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void>;
  /** Every connection for a provider, across users. Used only by the webhook resolver, which has no principal. */
  candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]>;
}
export interface SyncRunsRepository {
  start(input: { connectionId: string; kind: SyncKind; trigger: SyncTrigger; startedAt: Date }): Promise<SyncRun>;
  finish(id: string, patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date }): Promise<void>;
  running(connectionId: string, kind: SyncKind): Promise<SyncRun | null>;
  recent(connectionId: string, limit: number): Promise<SyncRun[]>;
  recentForUser(userId: string, limit: number): Promise<SyncRun[]>;
}
export interface WebhookDelivery {
  connectionId: string | null; provider: ProviderCode; event: string; payloadHash: string;
  status: "accepted" | "rejected"; error: string | null; receivedAt: Date;
}
export interface WebhookDeliveriesRepository {
  record(input: WebhookDelivery): Promise<void>;
}

// application/deps.ts
export interface IntegrationDeps {
  connections: ConnectionsRepository;
  runs: SyncRunsRepository;
  deliveries: WebhookDeliveriesRepository;
  cipher: CredentialCipher;
  registry: ProviderRegistry;
  db: DbClient;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

// application/errors.ts
export class UnknownProviderError extends Error {}       // no adapter registered under that code
export class ConnectionNotFoundError extends Error {}    // no connection, or it belongs to somebody else
export class CredentialValidationError extends Error { readonly issues?: unknown }
export class ConnectionVersionMismatchError extends Error {}

// infrastructure/memory-repositories.ts
export class MemoryConnectionsRepository implements ConnectionsRepository {}
export class MemorySyncRunsRepository implements SyncRunsRepository {}
export class MemoryWebhookDeliveriesRepository implements WebhookDeliveriesRepository {}
export function memoryCipher(): CredentialCipher;   // reversible, in-process, never touches the environment
```

- [ ] **Step 1: Write the failing domain test**

`src/modules/integrations/domain/connection.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  DISCONNECT_POLICIES,
  describeDisconnectPolicy,
  isUsable,
  nextStatusAfterSync,
  statusAfterTest,
} from "./connection";
import type { IntegrationConnection } from "@/platform/integrations/types";

const base: IntegrationConnection = {
  id: "c1",
  userId: "u1",
  provider: "wallet",
  status: "connected",
  settings: {},
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  disconnectPolicy: "keep",
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("connection domain", () => {
  it("maps a test result onto a status", () => {
    expect(statusAfterTest({ ok: true, message: "ok" })).toBe("connected");
    expect(statusAfterTest({ ok: false, message: "401" })).toBe("error");
  });

  it("only a connected connection is usable", () => {
    expect(isUsable(base)).toBe(true);
    for (const status of ["disconnected", "error", "disabled"] as const) {
      expect(isUsable({ ...base, status })).toBe(false);
    }
  });

  it("a failed sync moves the connection to error and a good one back to connected", () => {
    expect(nextStatusAfterSync(true)).toBe("error");
    expect(nextStatusAfterSync(false)).toBe("connected");
  });

  it("describes all three disconnect policies", () => {
    expect(DISCONNECT_POLICIES).toEqual(["keep", "archive", "purge"]);
    for (const policy of DISCONNECT_POLICIES) {
      expect(describeDisconnectPolicy(policy).length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: Write the failing memory-repository test**

`src/modules/integrations/infrastructure/memory-repositories.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  memoryCipher,
} from "./memory-repositories";

const USER = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";

describe("memory connections repository", () => {
  it("creates, finds by provider, hides another user's row and enforces the version", async () => {
    const repo = new MemoryConnectionsRepository();
    const created = await repo.create({
      userId: USER,
      provider: "wallet",
      status: "disconnected",
      settings: {},
      disconnectPolicy: "keep",
    });
    expect(created.version).toBe(1);
    expect((await repo.getByProvider(USER, "wallet"))?.id).toBe(created.id);
    expect(await repo.getByProvider(OTHER, "wallet")).toBeNull();
    expect(await repo.get(OTHER, created.id)).toBeNull();

    const updated = await repo.update(USER, created.id, 1, { disconnectPolicy: "archive" });
    expect(updated).not.toBe("version_mismatch");
    expect((updated as { version: number }).version).toBe(2);
    expect(await repo.update(USER, created.id, 1, { disconnectPolicy: "purge" })).toBe("version_mismatch");
  });

  it("round-trips credentials and clears them on null", async () => {
    const repo = new MemoryConnectionsRepository();
    const cipher = memoryCipher();
    const c = await repo.create({
      userId: USER,
      provider: "wallet",
      status: "disconnected",
      settings: {},
      disconnectPolicy: "keep",
    });
    await repo.writeCredentials(USER, c.id, cipher.seal({ token: "t" }));
    const sealed = await repo.readCredentials(USER, c.id);
    expect(sealed).not.toBeNull();
    expect(cipher.open(sealed!)).toEqual({ token: "t" });
    await repo.writeCredentials(USER, c.id, null);
    expect(await repo.readCredentials(USER, c.id)).toBeNull();
  });
});

describe("memory sync runs repository", () => {
  it("reports a running run and stops reporting it once finished", async () => {
    const runs = new MemorySyncRunsRepository();
    const started = await runs.start({
      connectionId: "c1",
      kind: "accounts",
      trigger: "manual",
      startedAt: new Date("2026-09-04T08:00:00Z"),
    });
    expect((await runs.running("c1", "accounts"))?.id).toBe(started.id);
    await runs.finish(started.id, {
      status: "success",
      stats: { created: 2 },
      error: null,
      finishedAt: new Date("2026-09-04T08:00:05Z"),
    });
    expect(await runs.running("c1", "accounts")).toBeNull();
    expect((await runs.recent("c1", 10))[0]?.stats).toEqual({ created: 2 });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm test -- integrations/domain integrations/infrastructure/memory-repositories`
Expected: FAIL — `Cannot find module './connection'` and `Cannot find module './memory-repositories'`.

- [ ] **Step 4: Write the domain**

`src/modules/integrations/domain/connection.ts`:
```ts
import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  TestResult,
} from "@/platform/integrations/types";

/** A test is the only thing that can move a connection into `connected`. */
export function statusAfterTest(result: TestResult): ConnectionStatus {
  return result.ok ? "connected" : "error";
}

/**
 * `disabled` is a deliberate pause and `error` is a broken credential; neither
 * may be synced from. Keeping this in one predicate is what stops a caller
 * from checking `!== "disconnected"` and quietly syncing a broken connection.
 */
export function isUsable(connection: IntegrationConnection): boolean {
  return connection.status === "connected";
}

export function nextStatusAfterSync(failed: boolean): ConnectionStatus {
  return failed ? "error" : "connected";
}

export const DISCONNECT_POLICIES: readonly DisconnectPolicy[] = ["keep", "archive", "purge"];

/** The exact sentence the disconnect dialog shows, so UI and API cannot describe the same policy differently. */
export function describeDisconnectPolicy(policy: DisconnectPolicy): string {
  if (policy === "keep") {
    return "Keep everything. The credential is deleted; synced accounts and their history stay exactly as they are.";
  }
  if (policy === "archive") {
    return "Archive. The credential is deleted and every account this provider owned is archived, history included.";
  }
  return "Purge. The credential is deleted, the provider links are removed, and accounts nothing else references are deleted.";
}
```

- [ ] **Step 5: Write the ports, deps and errors**

Create `src/modules/integrations/application/ports.ts`, `deps.ts` and `errors.ts` with exactly the declarations in **Interfaces** above. `ports.ts` imports its types from `@/platform/integrations/types` and `SealedCredential` from `@/platform/integrations/crypto`; `deps.ts` additionally imports `CredentialCipher`, `ProviderRegistry`, `Clock`, `DbClient` and `AuditInput`. Give each error class a `this.name` assignment, and `CredentialValidationError` a second constructor parameter `readonly issues?: unknown` (mirroring `InvalidInputError` in the accounts module). Document on `ConnectionsRepository.recordState` why it does not take a version:

```ts
  /**
   * Lifecycle stamps — status, last test, last sync, last error — written by
   * the engine itself. Deliberately not version-checked: a sync finishing must
   * not lose a race with a person editing the connection's settings, and
   * neither write can invalidate the other.
   */
```

- [ ] **Step 6: Write the memory repositories**

`src/modules/integrations/infrastructure/memory-repositories.ts`:
```ts
import type { SealedCredential, CredentialCipher } from "@/platform/integrations/crypto";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  SyncRun,
  SyncTrigger,
  SyncRunStatus,
} from "@/platform/integrations/types";
import type {
  ConnectionPatch,
  ConnectionStatePatch,
  ConnectionsRepository,
  NewConnection,
  SyncRunsRepository,
  WebhookDeliveriesRepository,
  WebhookDelivery,
} from "../application/ports";

interface Stored {
  connection: IntegrationConnection;
  sealed: SealedCredential | null;
}

export class MemoryConnectionsRepository implements ConnectionsRepository {
  private rows: Stored[] = [];

  private find(userId: string, id: string): Stored | undefined {
    return this.rows.find((r) => r.connection.userId === userId && r.connection.id === id);
  }

  async list(userId: string): Promise<IntegrationConnection[]> {
    return this.rows.filter((r) => r.connection.userId === userId).map((r) => r.connection);
  }

  async get(userId: string, id: string): Promise<IntegrationConnection | null> {
    return this.find(userId, id)?.connection ?? null;
  }

  async getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null> {
    return (
      this.rows.find((r) => r.connection.userId === userId && r.connection.provider === provider)?.connection ??
      null
    );
  }

  async create(input: NewConnection): Promise<IntegrationConnection> {
    const now = new Date();
    const connection: IntegrationConnection = {
      ...input,
      id: crypto.randomUUID(),
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push({ connection, sealed: null });
    return connection;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null> {
    const row = this.find(userId, id);
    if (!row) return null;
    if (row.connection.version !== expectedVersion) return "version_mismatch";
    row.connection = {
      ...row.connection,
      ...patch,
      version: row.connection.version + 1,
      updatedAt: new Date(),
    };
    return row.connection;
  }

  async recordState(id: string, patch: ConnectionStatePatch): Promise<void> {
    const row = this.rows.find((r) => r.connection.id === id);
    if (!row) return;
    row.connection = { ...row.connection, ...patch, updatedAt: new Date() };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((r) => r.connection.userId === userId && r.connection.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async readCredentials(userId: string, id: string): Promise<SealedCredential | null> {
    return this.find(userId, id)?.sealed ?? null;
  }

  async writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void> {
    const row = this.find(userId, id);
    if (row) row.sealed = sealed;
  }

  async candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]> {
    return this.rows.filter((r) => r.connection.provider === provider).map((r) => r.connection);
  }
}

export class MemorySyncRunsRepository implements SyncRunsRepository {
  private rows: SyncRun[] = [];
  /** The memory repositories have no join to `integration_connections`, so ownership is recorded here. */
  private owners = new Map<string, string>();

  setOwner(connectionId: string, userId: string): void {
    this.owners.set(connectionId, userId);
  }

  async start(input: {
    connectionId: string;
    kind: SyncKind;
    trigger: SyncTrigger;
    startedAt: Date;
  }): Promise<SyncRun> {
    const run: SyncRun = {
      id: crypto.randomUUID(),
      connectionId: input.connectionId,
      kind: input.kind,
      status: "running",
      trigger: input.trigger,
      stats: {},
      error: null,
      startedAt: input.startedAt,
      finishedAt: null,
    };
    this.rows.unshift(run);
    return run;
  }

  async finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index === -1) return;
    this.rows[index] = { ...this.rows[index]!, ...patch };
  }

  async running(connectionId: string, kind: SyncKind): Promise<SyncRun | null> {
    return (
      this.rows.find((r) => r.connectionId === connectionId && r.kind === kind && r.status === "running") ?? null
    );
  }

  async recent(connectionId: string, limit: number): Promise<SyncRun[]> {
    return this.rows.filter((r) => r.connectionId === connectionId).slice(0, limit);
  }

  async recentForUser(userId: string, limit: number): Promise<SyncRun[]> {
    return this.rows.filter((r) => this.owners.get(r.connectionId) === userId).slice(0, limit);
  }
}

export class MemoryWebhookDeliveriesRepository implements WebhookDeliveriesRepository {
  readonly rows: WebhookDelivery[] = [];

  async record(input: WebhookDelivery): Promise<void> {
    this.rows.push(input);
  }
}

/**
 * A reversible stand-in for the real cipher. Deliberately NOT encryption: it
 * keeps the tests free of `APP_ENCRYPTION_KEY` while still forcing every use
 * case through seal/open, so nothing can accidentally store a plaintext
 * credential and pass.
 */
export function memoryCipher(): CredentialCipher {
  return {
    activeKeyId: "memory",
    seal: (plaintext) => ({
      keyId: "memory",
      ciphertext: Buffer.from(JSON.stringify(plaintext), "utf8"),
    }),
    open: (sealed) => JSON.parse(sealed.ciphertext.toString("utf8")) as Record<string, string>,
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `npm run typecheck && npm test -- integrations`
Expected: PASS (10 cases across the four integration test files so far).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(integrations): connection domain, ports and in-memory repositories"
```

---

### Task 8: Drizzle repositories and the production deps bag

**Files:**
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-connections-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/deps.ts`
- Test: `dashboard-app/src/modules/integrations/infrastructure/repositories.itest.ts`

**Interfaces:**
- Consumes: the ports from Task 7, the Drizzle tables from Task 5, `recordAudit`, `credentialCipher`, `providerRegistry`.
- Produces:
```ts
export class DrizzleConnectionsRepository implements ConnectionsRepository { constructor(db: DbClient) }
export class DrizzleSyncRunsRepository implements SyncRunsRepository { constructor(db: DbClient) }
export class DrizzleWebhookDeliveriesRepository implements WebhookDeliveriesRepository { constructor(db: DbClient) }
export function integrationDeps(tx: DbClient, requestId?: string | null): IntegrationDeps;
```

- [ ] **Step 1: Write the failing integration test**

`src/modules/integrations/infrastructure/repositories.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { createCredentialCipher } from "@/platform/integrations/crypto";
import { DrizzleConnectionsRepository } from "./drizzle-connections-repository";
import { DrizzleSyncRunsRepository } from "./drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "./drizzle-webhook-deliveries-repository";

const KEY = `k1:${Buffer.alloc(32, 7).toString("base64")}`;

describe("integration repositories", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores a connection with sealed credentials, records runs and deliveries", async () => {
    const db = await testDb();
    const cipher = createCredentialCipher(KEY);
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();

    const created = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).create({
        userId: user!.id,
        provider: "wallet",
        status: "disconnected",
        settings: { note: "primary" },
        disconnectPolicy: "keep",
      }),
    );
    expect(created.version).toBe(1);
    expect(created.settings).toEqual({ note: "primary" });

    await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).writeCredentials(user!.id, created.id, cipher.seal({ token: "secret" })),
    );
    const sealed = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).readCredentials(user!.id, created.id),
    );
    expect(cipher.open(sealed!)).toEqual({ token: "secret" });

    const bumped = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).update(user!.id, created.id, 1, { disconnectPolicy: "archive" }),
    );
    expect(bumped).not.toBe("version_mismatch");
    expect((bumped as { version: number }).version).toBe(2);
    const stale = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).update(user!.id, created.id, 1, { disconnectPolicy: "purge" }),
    );
    expect(stale).toBe("version_mismatch");

    await withUserContext(db, { userId: user!.id }, async (tx) => {
      const runs = new DrizzleSyncRunsRepository(tx);
      const run = await runs.start({
        connectionId: created.id,
        kind: "accounts",
        trigger: "manual",
        startedAt: new Date("2026-09-04T08:00:00Z"),
      });
      expect((await runs.running(created.id, "accounts"))?.id).toBe(run.id);
      await runs.finish(run.id, {
        status: "success",
        stats: { created: 3 },
        error: null,
        finishedAt: new Date("2026-09-04T08:00:02Z"),
      });
      expect(await runs.running(created.id, "accounts")).toBeNull();
      expect((await runs.recentForUser(user!.id, 5))[0]?.stats).toEqual({ created: 3 });

      await new DrizzleWebhookDeliveriesRepository(tx).record({
        connectionId: created.id,
        provider: "wallet",
        event: "sync.requested",
        payloadHash: "abc",
        status: "accepted",
        error: null,
        receivedAt: new Date("2026-09-04T08:01:00Z"),
      });
    });

    // `candidatesForWebhook` has no principal, so it runs in the system context.
    const candidates = await withUserContext(db, { userId: user!.id, role: "system" }, (tx) =>
      new DrizzleConnectionsRepository(tx).candidatesForWebhook("wallet"),
    );
    expect(candidates.map((c) => c.id)).toEqual([created.id]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- integrations/infrastructure/repositories`
Expected: FAIL — `Cannot find module './drizzle-connections-repository'`.

- [ ] **Step 3: Write the connections repository**

`src/modules/integrations/infrastructure/drizzle-connections-repository.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { integrationConnections, type IntegrationConnectionRow } from "@/lib/db/schema";
import type { SealedCredential } from "@/platform/integrations/crypto";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
} from "@/platform/integrations/types";
import type {
  ConnectionPatch,
  ConnectionStatePatch,
  ConnectionsRepository,
  NewConnection,
} from "../application/ports";

function toConnection(row: IntegrationConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as ProviderCode,
    status: row.status as ConnectionStatus,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    lastTestAt: row.lastTestAt,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    disconnectPolicy: row.disconnectPolicy as DisconnectPolicy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed connections. Expects a client already inside
 * `withUserContext`, so RLS scopes every statement on top of the explicit
 * `user_id` predicates below.
 *
 * The credential columns are never selected by the read methods: a connection
 * object handed to a use case, a route or a template can therefore never carry
 * a secret, because the shape has no field for one.
 */
export class DrizzleConnectionsRepository implements ConnectionsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<IntegrationConnection[]> {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.userId, userId));
    return rows.map(toConnection).sort((a, b) => a.provider.localeCompare(b.provider));
  }

  async get(userId: string, id: string): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .limit(1);
    return row ? toConnection(row) : null;
  }

  async getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)))
      .limit(1);
    return row ? toConnection(row) : null;
  }

  async create(input: NewConnection): Promise<IntegrationConnection> {
    const [row] = await this.db
      .insert(integrationConnections)
      .values({
        userId: input.userId,
        provider: input.provider,
        status: input.status,
        settings: input.settings,
        disconnectPolicy: input.disconnectPolicy,
      })
      .returning();
    return toConnection(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null> {
    const [row] = await this.db
      .update(integrationConnections)
      .set({
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
        ...(patch.disconnectPolicy !== undefined ? { disconnectPolicy: patch.disconnectPolicy } : {}),
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.userId, userId),
          eq(integrationConnections.id, id),
          eq(integrationConnections.version, expectedVersion),
        ),
      )
      .returning();
    if (row) return toConnection(row);
    return (await this.get(userId, id)) === null ? null : "version_mismatch";
  }

  async recordState(id: string, patch: ConnectionStatePatch): Promise<void> {
    await this.db
      .update(integrationConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(integrationConnections.id, id));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  async readCredentials(userId: string, id: string): Promise<SealedCredential | null> {
    const [row] = await this.db
      .select({
        ciphertext: integrationConnections.credentialsCiphertext,
        keyId: integrationConnections.keyId,
      })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .limit(1);
    if (!row || !row.ciphertext || !row.keyId) return null;
    return { keyId: row.keyId, ciphertext: row.ciphertext };
  }

  async writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void> {
    await this.db
      .update(integrationConnections)
      .set({
        credentialsCiphertext: sealed?.ciphertext ?? null,
        keyId: sealed?.keyId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)));
  }

  /** No principal exists when a webhook arrives, so the caller runs this in the system context. */
  async candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]> {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(eq(integrationConnections.provider, provider), eq(integrationConnections.status, "connected")),
      );
    return rows.map(toConnection);
  }
}
```

- [ ] **Step 4: Write the runs and deliveries repositories**

`src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts`:
```ts
import { and, desc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { integrationConnections, syncRuns, type SyncRunRow } from "@/lib/db/schema";
import type {
  SyncKind,
  SyncRun,
  SyncRunStatus,
  SyncTrigger,
} from "@/platform/integrations/types";
import type { SyncRunsRepository } from "../application/ports";

function toRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind as SyncKind,
    status: row.status as SyncRunStatus,
    trigger: row.trigger as SyncTrigger,
    stats: (row.stats ?? {}) as Record<string, number>,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export class DrizzleSyncRunsRepository implements SyncRunsRepository {
  constructor(private readonly db: DbClient) {}

  async start(input: {
    connectionId: string;
    kind: SyncKind;
    trigger: SyncTrigger;
    startedAt: Date;
  }): Promise<SyncRun> {
    const [row] = await this.db
      .insert(syncRuns)
      .values({
        connectionId: input.connectionId,
        kind: input.kind,
        status: "running",
        trigger: input.trigger,
        startedAt: input.startedAt,
      })
      .returning();
    return toRun(row!);
  }

  async finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void> {
    await this.db
      .update(syncRuns)
      .set({ status: patch.status, stats: patch.stats, error: patch.error, finishedAt: patch.finishedAt })
      .where(eq(syncRuns.id, id));
  }

  async running(connectionId: string, kind: SyncKind): Promise<SyncRun | null> {
    const [row] = await this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, connectionId), eq(syncRuns.kind, kind), eq(syncRuns.status, "running")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    return row ? toRun(row) : null;
  }

  async recent(connectionId: string, limit: number): Promise<SyncRun[]> {
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
    return rows.map(toRun);
  }

  async recentForUser(userId: string, limit: number): Promise<SyncRun[]> {
    const rows = await this.db
      .select({ run: syncRuns })
      .from(syncRuns)
      .innerJoin(integrationConnections, eq(integrationConnections.id, syncRuns.connectionId))
      .where(eq(integrationConnections.userId, userId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
    return rows.map((r) => toRun(r.run));
  }
}
```

`src/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository.ts`:
```ts
import type { DbClient } from "@/lib/db/client";
import { webhookDeliveries } from "@/lib/db/schema";
import type { WebhookDeliveriesRepository, WebhookDelivery } from "../application/ports";

export class DrizzleWebhookDeliveriesRepository implements WebhookDeliveriesRepository {
  constructor(private readonly db: DbClient) {}

  async record(input: WebhookDelivery): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      connectionId: input.connectionId,
      provider: input.provider,
      direction: "inbound",
      event: input.event,
      payloadHash: input.payloadHash,
      status: input.status,
      error: input.error,
      receivedAt: input.receivedAt,
    });
  }
}
```

- [ ] **Step 5: Write the production deps bag**

`src/modules/integrations/infrastructure/deps.ts`:
```ts
import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import { credentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import type { IntegrationDeps } from "../application/deps";
import { DrizzleConnectionsRepository } from "./drizzle-connections-repository";
import { DrizzleSyncRunsRepository } from "./drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "./drizzle-webhook-deliveries-repository";

/**
 * The production assembly of `IntegrationDeps`, bound to one transaction —
 * the mirror of `accountDeps` in the accounts module, and split from `ui/`
 * for the same reason: the API layer must be able to build it without
 * dragging Auth.js (and through it `next/server`) into the import graph.
 */
export function integrationDeps(tx: DbClient, requestId?: string | null): IntegrationDeps {
  return {
    connections: new DrizzleConnectionsRepository(tx),
    runs: new DrizzleSyncRunsRepository(tx),
    deliveries: new DrizzleWebhookDeliveriesRepository(tx),
    cipher: credentialCipher(),
    registry: providerRegistry,
    db: tx,
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm run test:integration -- integrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): Drizzle repositories for connections, sync runs and deliveries"
```

---

### Task 9: Connect, test, list and disconnect

**Files:**
- Create: `dashboard-app/src/modules/integrations/application/connect-integration.ts`
- Create: `dashboard-app/src/modules/integrations/application/test-integration-connection.ts`
- Create: `dashboard-app/src/modules/integrations/application/disconnect-integration.ts`
- Create: `dashboard-app/src/modules/integrations/application/list-integrations.ts`
- Test: `dashboard-app/src/modules/integrations/application/lifecycle.test.ts`

**Interfaces:**
- Consumes: `IntegrationDeps`, the ports and errors from Task 7, the domain helpers, `assertPermission`/`Principal` from `@/platform/auth/principal`.
- Produces:
```ts
export interface ConnectIntegrationInput {
  provider: ProviderCode;
  credentials: Record<string, string>;
  settings?: Record<string, unknown>;
  disconnectPolicy?: DisconnectPolicy;
}
export function connectIntegration(deps: IntegrationDeps): (
  principal: Principal, input: ConnectIntegrationInput,
) => Promise<{ connection: IntegrationConnection; test: TestResult }>;

export function testIntegrationConnection(deps: IntegrationDeps): (
  principal: Principal, provider: ProviderCode,
) => Promise<TestResult>;

export function disconnectIntegration(deps: IntegrationDeps): (
  principal: Principal, provider: ProviderCode, policy?: DisconnectPolicy,
) => Promise<{ policy: DisconnectPolicy }>;

export interface IntegrationSummary {
  provider: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialFields: readonly CredentialField[];
  connection: IntegrationConnection | null;
  recentRuns: SyncRun[];
}
export function listIntegrations(deps: IntegrationDeps): (principal: Principal) => Promise<IntegrationSummary[]>;
```
Every one of the four asserts `integrations.manage` except `listIntegrations`, which asserts `accounts.read` — reading which integrations exist is not a privileged act, and Settings › Integrations must render for a viewer with a "you cannot change this" state rather than a 403 page.

- [ ] **Step 1: Write the failing test**

`src/modules/integrations/application/lifecycle.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type { IntegrationProvider, ProviderRegistry, TestResult } from "@/platform/integrations/types";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "../infrastructure/memory-repositories";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { disconnectIntegration } from "./disconnect-integration";
import { listIntegrations } from "./list-integrations";
import { testIntegrationConnection } from "./test-integration-connection";
import { CredentialValidationError, UnknownProviderError, ConnectionNotFoundError } from "./errors";

const principal = testPrincipal();

let nextTest: TestResult;
let disconnects: string[];

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => nextTest,
    syncs: {},
    onDisconnect: async (ctx) => {
      disconnects.push(ctx.policy);
    },
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return {
    connections: new MemoryConnectionsRepository(),
    runs: new MemorySyncRunsRepository(),
    deliveries: new MemoryWebhookDeliveriesRepository(),
    cipher: memoryCipher(),
    registry,
    db: {} as never,
    clock: { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: async () => {},
  };
}

describe("integration lifecycle", () => {
  beforeEach(() => {
    nextTest = { ok: true, message: "Reached the provider." };
    disconnects = [];
  });

  it("connects, seals the credential and never returns it", async () => {
    const deps = makeDeps();
    const { connection, test } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "secret" },
    });
    expect(test.ok).toBe(true);
    expect(connection.status).toBe("connected");
    expect(JSON.stringify(connection)).not.toContain("secret");
    const sealed = await deps.connections.readCredentials(principal.userId, connection.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "secret" });
  });

  it("records a failed test as an error status with the message", async () => {
    const deps = makeDeps();
    nextTest = { ok: false, message: "401 from the provider" };
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "bad" },
    });
    expect(connection.status).toBe("error");
    expect(connection.lastError).toBe("401 from the provider");
  });

  it("reconnecting replaces the credential on the same row", async () => {
    const deps = makeDeps();
    const first = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "one" },
    });
    const second = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "two" },
    });
    expect(second.connection.id).toBe(first.connection.id);
    const sealed = await deps.connections.readCredentials(principal.userId, second.connection.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "two" });
  });

  it("refuses a credential the provider's schema rejects, and an unknown provider", async () => {
    const deps = makeDeps();
    await expect(
      connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "" } }),
    ).rejects.toBeInstanceOf(CredentialValidationError);
    await expect(
      connectIntegration(deps)(principal, { provider: "trek", credentials: { token: "x" } }),
    ).rejects.toBeInstanceOf(UnknownProviderError);
  });

  it("refuses a principal without integrations.manage", async () => {
    const deps = makeDeps();
    const viewer = testPrincipal({ roles: ["viewer"] });
    await expect(
      connectIntegration(deps)(viewer, { provider: "wallet", credentials: { token: "x" } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("tests an existing connection and stamps the result", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    nextTest = { ok: false, message: "gone" };
    const result = await testIntegrationConnection(deps)(principal, "wallet");
    expect(result.ok).toBe(false);
    const connection = await deps.connections.getByProvider(principal.userId, "wallet");
    expect(connection?.status).toBe("error");
    expect(connection?.lastTestAt).toEqual(new Date("2026-09-04T09:00:00Z"));
  });

  it("refuses to test a provider that was never connected", async () => {
    const deps = makeDeps();
    await expect(testIntegrationConnection(deps)(principal, "wallet")).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });

  it("disconnects: credential gone, status disconnected, provider hook called with the policy", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
      disconnectPolicy: "archive",
    });
    const result = await disconnectIntegration(deps)(principal, "wallet");
    expect(result.policy).toBe("archive");
    expect(disconnects).toEqual(["archive"]);
    expect(await deps.connections.readCredentials(principal.userId, connection.id)).toBeNull();
    expect((await deps.connections.getByProvider(principal.userId, "wallet"))?.status).toBe("disconnected");
  });

  it("an explicit policy overrides the stored one", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    const result = await disconnectIntegration(deps)(principal, "wallet", "purge");
    expect(result.policy).toBe("purge");
    expect(disconnects).toEqual(["purge"]);
  });

  it("lists every registered provider, connected or not", async () => {
    const deps = makeDeps();
    const before = await listIntegrations(deps)(principal);
    expect(before).toHaveLength(1);
    expect(before[0]!.connection).toBeNull();
    expect(before[0]!.credentialFields.map((f) => f.name)).toEqual(["token"]);
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    const after = await listIntegrations(deps)(principal);
    expect(after[0]!.connection?.status).toBe("connected");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- integrations/application/lifecycle`
Expected: FAIL — `Cannot find module './connect-integration'`.

- [ ] **Step 3: Write `connect-integration.ts`**

```ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type {
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
  TestResult,
} from "@/platform/integrations/types";
import { statusAfterTest } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import { CredentialValidationError, UnknownProviderError } from "./errors";

export interface ConnectIntegrationInput {
  provider: ProviderCode;
  credentials: Record<string, string>;
  settings?: Record<string, unknown>;
  disconnectPolicy?: DisconnectPolicy;
}

/**
 * Connecting is idempotent per (user, provider): there is one row per pair and
 * reconnecting replaces the credential on it rather than adding a second.
 *
 * A failed test does NOT abort the connect. The credential is still stored and
 * the connection lands in `error` with the provider's own message, because the
 * common failure is a typo the person is about to fix — losing what they typed
 * would make them retype the whole secret.
 */
export function connectIntegration(deps: IntegrationDeps) {
  return async (
    principal: Principal,
    input: ConnectIntegrationInput,
  ): Promise<{ connection: IntegrationConnection; test: TestResult }> => {
    assertPermission(principal, "integrations.manage");

    const provider = deps.registry.get(input.provider);
    if (!provider) throw new UnknownProviderError(`No integration named ${input.provider}`);

    const parsed = provider.credentialSchema.safeParse(input.credentials);
    if (!parsed.success) {
      throw new CredentialValidationError("Check the fields and try again.", parsed.error.issues);
    }

    const settings = input.settings ?? {};
    const existing = await deps.connections.getByProvider(principal.userId, input.provider);
    const test = await provider.testConnection(parsed.data, settings);
    const status = statusAfterTest(test);
    const now = deps.clock.now();

    let connection =
      existing ??
      (await deps.connections.create({
        userId: principal.userId,
        provider: input.provider,
        status,
        settings,
        disconnectPolicy: input.disconnectPolicy ?? "keep",
      }));

    if (existing) {
      const updated = await deps.connections.update(principal.userId, existing.id, existing.version, {
        settings,
        ...(input.disconnectPolicy ? { disconnectPolicy: input.disconnectPolicy } : {}),
      });
      if (updated && updated !== "version_mismatch") connection = updated;
    }

    await deps.connections.writeCredentials(principal.userId, connection.id, deps.cipher.seal(parsed.data));
    await deps.connections.recordState(connection.id, {
      status,
      lastTestAt: now,
      lastError: test.ok ? null : test.message,
    });

    // The credential itself is never audited — only that one was written, and
    // under which key (spec §3.2 "credentials metadata").
    await deps.audit({
      actorUserId: principal.userId,
      action: "integration.connect",
      entityType: "integration_connection",
      entityId: connection.id,
      after: { provider: input.provider, status, keyId: deps.cipher.activeKeyId, testOk: test.ok },
    });

    const fresh = await deps.connections.get(principal.userId, connection.id);
    return { connection: fresh ?? { ...connection, status, lastTestAt: now, lastError: test.ok ? null : test.message }, test };
  };
}
```

- [ ] **Step 4: Write `test-integration-connection.ts` and `disconnect-integration.ts`**

```ts
// test-integration-connection.ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { ProviderCode, TestResult } from "@/platform/integrations/types";
import { statusAfterTest } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import { ConnectionNotFoundError, UnknownProviderError } from "./errors";

/** "Does this credential still work?", answered without changing anything but the stamps. */
export function testIntegrationConnection(deps: IntegrationDeps) {
  return async (principal: Principal, providerCode: ProviderCode): Promise<TestResult> => {
    assertPermission(principal, "integrations.manage");
    const provider = deps.registry.get(providerCode);
    if (!provider) throw new UnknownProviderError(`No integration named ${providerCode}`);
    const connection = await deps.connections.getByProvider(principal.userId, providerCode);
    if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);

    const sealed = await deps.connections.readCredentials(principal.userId, connection.id);
    if (!sealed) throw new ConnectionNotFoundError(`${providerCode} has no stored credential`);

    const result = await provider.testConnection(deps.cipher.open(sealed), connection.settings);
    await deps.connections.recordState(connection.id, {
      status: statusAfterTest(result),
      lastTestAt: deps.clock.now(),
      lastError: result.ok ? null : result.message,
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "integration.test",
      entityType: "integration_connection",
      entityId: connection.id,
      after: { provider: providerCode, ok: result.ok },
    });
    return result;
  };
}
```
```ts
// disconnect-integration.ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { DisconnectPolicy, ProviderCode } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { ConnectionNotFoundError, UnknownProviderError } from "./errors";

/**
 * Spec §5.2: what happens to the data the provider left behind is the
 * connection's `disconnect_policy`, and a caller may override it once. The
 * credential is destroyed in every case (spec §8.4: "purges credentials
 * immediately"); only the domain data differs, and only the provider's own
 * adapter knows what that data is — which is why the work happens in
 * `onDisconnect` rather than here.
 */
export function disconnectIntegration(deps: IntegrationDeps) {
  return async (
    principal: Principal,
    providerCode: ProviderCode,
    policy?: DisconnectPolicy,
  ): Promise<{ policy: DisconnectPolicy }> => {
    assertPermission(principal, "integrations.manage");
    const provider = deps.registry.get(providerCode);
    if (!provider) throw new UnknownProviderError(`No integration named ${providerCode}`);
    const connection = await deps.connections.getByProvider(principal.userId, providerCode);
    if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);

    const effective = policy ?? connection.disconnectPolicy;

    await provider.onDisconnect({
      connection,
      policy: effective,
      db: deps.db,
      clock: deps.clock,
      audit: deps.audit,
    });

    await deps.connections.writeCredentials(principal.userId, connection.id, null);
    await deps.connections.recordState(connection.id, {
      status: "disconnected",
      lastError: null,
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "integration.disconnect",
      entityType: "integration_connection",
      entityId: connection.id,
      after: { provider: providerCode, policy: effective },
    });

    return { policy: effective };
  };
}
```

- [ ] **Step 5: Write `list-integrations.ts`**

```ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type {
  CredentialField,
  IntegrationCapability,
  IntegrationConnection,
  ProviderCode,
  SyncRun,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";

export interface IntegrationSummary {
  provider: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialFields: readonly CredentialField[];
  connection: IntegrationConnection | null;
  recentRuns: SyncRun[];
}

/**
 * Every registered provider, whether connected or not — Settings › Integrations
 * has to offer the ones that are missing, so an unconnected provider is a row
 * with a null connection rather than an absent row.
 */
export function listIntegrations(deps: IntegrationDeps) {
  return async (principal: Principal): Promise<IntegrationSummary[]> => {
    assertPermission(principal, "accounts.read");
    const connections = await deps.connections.list(principal.userId);
    const byProvider = new Map(connections.map((c) => [c.provider, c]));

    return Promise.all(
      deps.registry.list().map(async (provider) => {
        const connection = byProvider.get(provider.code) ?? null;
        return {
          provider: provider.code,
          label: provider.label,
          capabilities: provider.capabilities,
          credentialFields: provider.credentialFields,
          connection,
          recentRuns: connection ? await deps.runs.recent(connection.id, 10) : [],
        };
      }),
    );
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test -- integrations/application/lifecycle`
Expected: PASS (10 cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): connect, test, list and disconnect use cases"
```

---

### Task 10: The sync engine

**Files:**
- Create: `dashboard-app/src/modules/integrations/application/run-sync.ts`
- Test: `dashboard-app/src/modules/integrations/application/run-sync.test.ts`

**Interfaces:**
- Consumes: `IntegrationDeps`, `isUsable`/`nextStatusAfterSync` from the domain, the errors from Task 7.
- Produces:
```ts
export interface RunSyncInput { provider: ProviderCode; kind: SyncKind; trigger: SyncTrigger }
// Both live in ./errors alongside the Task 7 error classes; run-sync.ts imports them.
export class SyncNotSupportedError extends Error {}
export class ConnectionNotUsableError extends Error {}
export function runSync(deps: IntegrationDeps): (principal: Principal, input: RunSyncInput) => Promise<SyncRun>;
/** The same engine without a principal, for the cron path. Asserts nothing; the caller has already decided. */
export function runSyncForUser(deps: IntegrationDeps): (userId: string, input: RunSyncInput) => Promise<SyncRun>;
```
`runSync` asserts `integrations.manage` and delegates to `runSyncForUser`. Manual triggers are **idempotent per running job** (spec §6): if a run for the same `(connection, kind)` is already `running`, the existing run is returned untouched.

- [ ] **Step 1: Write the failing test**

`src/modules/integrations/application/run-sync.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type { IntegrationProvider, ProviderRegistry, SyncContext } from "@/platform/integrations/types";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "../infrastructure/memory-repositories";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { runSync } from "./run-sync";
import { ConnectionNotUsableError, SyncNotSupportedError } from "./errors";

const principal = testPrincipal();
let seen: SyncContext[] = [];
let handler: (ctx: SyncContext) => Promise<Record<string, number>>;

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: { accounts: (ctx) => handler(ctx) },
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return {
    connections: new MemoryConnectionsRepository(),
    runs: new MemorySyncRunsRepository(),
    deliveries: new MemoryWebhookDeliveriesRepository(),
    cipher: memoryCipher(),
    registry,
    db: {} as never,
    clock: { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: async () => {},
  };
}

async function connected(deps: IntegrationDeps) {
  const { connection } = await connectIntegration(deps)(principal, {
    provider: "wallet",
    credentials: { token: "t" },
  });
  return connection;
}

describe("runSync", () => {
  beforeEach(() => {
    seen = [];
    handler = async (ctx) => {
      seen.push(ctx);
      return { created: 2, updated: 1 };
    };
  });

  it("records a successful run with the handler's stats and hands it the open credential", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.status).toBe("success");
    expect(run.stats).toEqual({ created: 2, updated: 1 });
    expect(run.finishedAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(seen[0]!.credentials).toEqual({ token: "t" });
    expect(seen[0]!.connection.id).toBe(connection.id);
    expect(seen[0]!.runId).toBe(run.id);
    const fresh = await deps.connections.getByProvider(principal.userId, "wallet");
    expect(fresh?.lastSyncAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(fresh?.status).toBe("connected");
  });

  it("records a thrown handler as a failed run and moves the connection to error", async () => {
    const deps = makeDeps();
    await connected(deps);
    handler = async () => {
      throw new Error("provider said no");
    };
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "cron" });
    expect(run.status).toBe("failed");
    expect(run.error).toBe("provider said no");
    expect((await deps.connections.getByProvider(principal.userId, "wallet"))?.status).toBe("error");
  });

  it("returns the running run instead of starting a second one", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const inFlight = await deps.runs.start({
      connectionId: connection.id,
      kind: "accounts",
      trigger: "cron",
      startedAt: new Date("2026-09-04T08:59:00Z"),
    });
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.id).toBe(inFlight.id);
    expect(run.status).toBe("running");
    expect(seen).toHaveLength(0);
  });

  it("refuses a kind the provider does not implement and a connection that is not connected", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "leave", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncNotSupportedError);
    await deps.connections.recordState(connection.id, { status: "disabled" });
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" }),
    ).rejects.toBeInstanceOf(ConnectionNotUsableError);
  });

  it("refuses a principal without integrations.manage", async () => {
    const deps = makeDeps();
    await connected(deps);
    await expect(
      runSync(deps)(testPrincipal({ roles: ["viewer"] }), {
        provider: "wallet",
        kind: "accounts",
        trigger: "manual",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- integrations/application/run-sync`
Expected: FAIL — `Cannot find module './run-sync'`.

- [ ] **Step 3: Write the engine**

`src/modules/integrations/application/run-sync.ts`:
```ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { ProviderCode, SyncKind, SyncRun, SyncTrigger } from "@/platform/integrations/types";
import { isUsable, nextStatusAfterSync } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  SyncNotSupportedError,
  UnknownProviderError,
} from "./errors";

export interface RunSyncInput {
  provider: ProviderCode;
  kind: SyncKind;
  trigger: SyncTrigger;
}

/**
 * One unit of work against one connection, recorded start to finish.
 *
 * Everything provider-specific is behind `provider.syncs[kind]`; this function
 * only owns the bookkeeping, and it owns all of it — which is why a handler
 * that throws still produces a finished `sync_runs` row and a connection in
 * `error`. A run that vanished without a row would be indistinguishable from
 * one that never started.
 */
export function runSyncForUser(deps: IntegrationDeps) {
  return async (userId: string, input: RunSyncInput): Promise<SyncRun> => {
    const provider = deps.registry.get(input.provider);
    if (!provider) throw new UnknownProviderError(`No integration named ${input.provider}`);
    const handler = provider.syncs[input.kind];
    if (!handler) throw new SyncNotSupportedError(`${input.provider} has no ${input.kind} sync`);

    const connection = await deps.connections.getByProvider(userId, input.provider);
    if (!connection) throw new ConnectionNotFoundError(`${input.provider} is not connected`);
    if (!isUsable(connection)) {
      throw new ConnectionNotUsableError(`${input.provider} is ${connection.status}; reconnect it first`);
    }

    // Idempotent per running job (spec §6): a second trigger joins the run in
    // flight rather than doubling the work against the provider.
    const inFlight = await deps.runs.running(connection.id, input.kind);
    if (inFlight) return inFlight;

    const sealed = await deps.connections.readCredentials(userId, connection.id);
    if (!sealed) throw new ConnectionNotFoundError(`${input.provider} has no stored credential`);

    const run = await deps.runs.start({
      connectionId: connection.id,
      kind: input.kind,
      trigger: input.trigger,
      startedAt: deps.clock.now(),
    });

    try {
      const stats = await handler({
        connection,
        credentials: deps.cipher.open(sealed),
        runId: run.id,
        db: deps.db,
        clock: deps.clock,
        audit: deps.audit,
      });
      const finishedAt = deps.clock.now();
      await deps.runs.finish(run.id, { status: "success", stats, error: null, finishedAt });
      await deps.connections.recordState(connection.id, {
        status: nextStatusAfterSync(false),
        lastSyncAt: finishedAt,
        lastError: null,
      });
      await deps.audit({
        actorUserId: userId,
        action: "integration.sync",
        entityType: "sync_run",
        entityId: run.id,
        after: { provider: input.provider, kind: input.kind, trigger: input.trigger, ...stats },
      });
      return { ...run, status: "success", stats, finishedAt };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const finishedAt = deps.clock.now();
      await deps.runs.finish(run.id, { status: "failed", stats: {}, error, finishedAt });
      await deps.connections.recordState(connection.id, {
        status: nextStatusAfterSync(true),
        lastError: error,
      });
      await deps.audit({
        actorUserId: userId,
        action: "integration.sync_failed",
        entityType: "sync_run",
        entityId: run.id,
        after: { provider: input.provider, kind: input.kind, trigger: input.trigger, error },
      });
      return { ...run, status: "failed", error, finishedAt };
    }
  };
}

export function runSync(deps: IntegrationDeps) {
  return async (principal: Principal, input: RunSyncInput): Promise<SyncRun> => {
    assertPermission(principal, "integrations.manage");
    return runSyncForUser(deps)(principal.userId, input);
  };
}
```
Add `SyncNotSupportedError` and `ConnectionNotUsableError` to `src/modules/integrations/application/errors.ts` (same shape as the Task 7 classes: a `this.name` assignment and nothing else), so this module, the routes and the tests all import them from one place.

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npm test -- integrations`
Expected: PASS (5 new cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(integrations): sync engine recording every run start to finish"
```

---
### Task 11: Port the Wallet adapter onto the framework

**Files:**
- Modify: `dashboard-app/src/lib/clients/wallet.ts`, `wallet.test.ts`
- Modify: `dashboard-app/src/modules/accounts/infrastructure/wallet-adapter.ts`, `wallet-adapter.test.ts`
- Create: `dashboard-app/src/platform/auth/owner.ts`, `owner.itest.ts`
- Create: `dashboard-app/src/platform/integrations/register-all.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/wallet-provider-adapter.ts`, `wallet-provider-adapter.test.ts`
- Modify: `dashboard-app/src/lib/jobs/wallet-accounts-sync.ts`, `wallet-accounts-sync.test.ts`
- Modify: `dashboard-app/src/lib/jobs/wallet-refresh.ts`, `wallet-refresh.test.ts`

**Interfaces:**
- Consumes: `IntegrationProvider`/`SyncContext` from `@/platform/integrations/types`, `runSyncForUser` from `@/modules/integrations/application/run-sync`, `integrationDeps` from `@/modules/integrations/infrastructure/deps`, `syncProviderAccounts` and `walletAccountsSource` from the accounts module.
- Produces:
```ts
// src/lib/clients/wallet.ts — the credential is now a parameter, never a file read
export interface WalletCallOptions {
  token: string;                   // REQUIRED
  sleep?: SleepFn; jitter?: () => number; attempts?: number; signal?: AbortSignal;
}
export function getAccounts(opts: WalletCallOptions): Promise<WalletAccount[]>;
export function getBalances(opts: WalletCallOptions): Promise<WalletBalances>;

// src/modules/accounts/infrastructure/wallet-adapter.ts
export function walletAccountsSource(clock: Clock, token: string): AccountsSource;

// src/platform/auth/owner.ts
export function ownerUserId(db: DbClient): Promise<string | null>;

// src/modules/integrations/infrastructure/wallet-provider-adapter.ts
export const walletProvider: IntegrationProvider;   // code "wallet", capabilities ["accounts","transactions","interest_posting"]

// src/platform/integrations/register-all.ts
export function ensureProvidersRegistered(): void;   // idempotent, like ensureJobsRegistered
```

- [ ] **Step 1: Write the failing adapter test**

`src/modules/integrations/infrastructure/wallet-provider-adapter.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { walletProvider } from "./wallet-provider-adapter";

vi.mock("@/lib/clients/wallet", () => ({
  getAccounts: vi.fn(async (opts: { token: string }) => {
    if (opts.token !== "good") throw new Error("401 from the Wallet API");
    return [
      {
        id: "w1",
        name: "ING - Salary",
        currencyCode: "EUR",
        archived: false,
        accountType: "general",
        balance: { currentBalance: 1234.5 },
      },
    ];
  }),
}));

describe("wallet provider adapter", () => {
  it("declares its code, capabilities and a single secret credential field", () => {
    expect(walletProvider.code).toBe("wallet");
    expect([...walletProvider.capabilities]).toContain("accounts");
    expect(walletProvider.credentialFields.map((f) => f.name)).toEqual(["token", "webhookSecret"]);
    expect(walletProvider.credentialFields[0]!.secret).toBe(true);
  });

  it("rejects an empty token through its credential schema", () => {
    expect(walletProvider.credentialSchema.safeParse({ token: "" }).success).toBe(false);
    expect(walletProvider.credentialSchema.safeParse({ token: "good" }).success).toBe(true);
  });

  it("reports a reachable provider and a refused one, never leaking the token", async () => {
    const ok = await walletProvider.testConnection({ token: "good" }, {});
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/1 account/);
    const bad = await walletProvider.testConnection({ token: "bad" }, {});
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain("bad");
  });

  it("has an accounts sync and no leave sync", () => {
    expect(typeof walletProvider.syncs.accounts).toBe("function");
    expect(walletProvider.syncs.leave).toBeUndefined();
  });

  it("verifies a webhook with the connection's own secret", () => {
    const body = '{"event":"accounts.changed"}';
    const secret = "s3cret";
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const headers = new Headers({ "x-signature": signature });
    expect(walletProvider.webhook!.verify({ rawBody: body, headers }, secret)).toBe(true);
    expect(walletProvider.webhook!.verify({ rawBody: body, headers }, "wrong")).toBe(false);
    expect(walletProvider.webhook!.toSyncRequests({ event: "accounts.changed" })).toEqual([
      { kind: "accounts", event: "accounts.changed" },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- wallet-provider-adapter`
Expected: FAIL — `Cannot find module './wallet-provider-adapter'`.

- [ ] **Step 3: Make the Wallet client take its credential**

In `src/lib/clients/wallet.ts`:
```ts
export interface WalletCallOptions {
  /**
   * The bearer token, always passed in. It used to be read from
   * `WALLET_TOKEN_FILE` on every request; since Phase 2 the credential lives
   * encrypted in `integration_connections` and is resolved by the caller, so
   * this module no longer touches the filesystem or the environment for it.
   */
  token: string;
  /** Injectable so tests don't sit through the backoff. */
  sleep?: SleepFn;
  jitter?: () => number;
  attempts?: number;
  signal?: AbortSignal;
}
```
```ts
function headers(opts: WalletCallOptions): Record<string, string> {
  return { authorization: `Bearer ${opts.token}` };
}
```
```ts
export async function getAccounts(opts: WalletCallOptions): Promise<WalletAccount[]> {
  try {
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/accounts?limit=200`, accountsSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.accounts;
  } catch (err) {
    throw translate(err);
  }
}
```
```ts
export async function getBalances(opts: WalletCallOptions): Promise<WalletBalances> {
  return reduceBalances(await getAccounts(opts));
}
```
Delete the `walletToken` import. In `src/lib/clients/wallet.test.ts`, delete the `process.env.WALLET_TOKEN_FILE` line and the token-file fixture, and give every `getAccounts(...)` / `getBalances(...)` call a token — `getBalances({ token: "t" })`, `getBalances({ token: "t", sleep, jitter: () => 0 })`, and so on. The assertions are unchanged.

- [ ] **Step 4: Make the accounts source take the token**

In `src/modules/accounts/infrastructure/wallet-adapter.ts`:
```ts
/**
 * `token` is passed in rather than read here: the credential lives in the
 * encrypted vault from Phase 2 on, and an adapter that reached for it itself
 * could not be used on behalf of a second user.
 */
export function walletAccountsSource(clock: Clock, token: string): AccountsSource {
  return {
    provider: WALLET_PROVIDER,
    async fetchAccounts(): Promise<ProviderAccount[]> {
      const asOf = romeDate(clock.now());
      const raw = await getAccounts({ token });
      return raw.map((a) => mapWalletAccount(a, asOf));
    },
  };
}
```
Update every `walletAccountsSource(clock)` call site to `walletAccountsSource(clock, token)`; `wallet-adapter.test.ts` passes `"test-token"`.

- [ ] **Step 5: Write the owner helper**

`src/platform/auth/owner.ts`:
```ts
import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { userRoles, users } from "@/lib/db/schema";

/**
 * The oldest active owner; there is only ever one in practice.
 *
 * Lifted out of `wallet-accounts-sync.ts` because three jobs now need it. It
 * queries `users`/`user_roles`, which carry no RLS, so it is safe on the bare
 * pool — and must be, since it runs before any user context exists.
 */
export async function ownerUserId(db: DbClient): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, "owner"), eq(users.status, "active")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row?.id ?? null;
}
```
`src/platform/auth/owner.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, roles, userRoles, users } from "@/lib/db/schema";
import { ownerUserId } from "./owner";

describe("ownerUserId", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("is null with no owner and the oldest active owner otherwise", async () => {
    const db = await testDb();
    expect(await ownerUserId(db)).toBeNull();
    await db.insert(roles).values({ code: "owner", label: "Owner" }).onConflictDoNothing();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    await db.insert(userRoles).values({ userId: user!.id, roleCode: "owner" });
    expect(await ownerUserId(db)).toBe(user!.id);
  });
});
```

- [ ] **Step 6: Write the provider adapter**

`src/modules/integrations/infrastructure/wallet-provider-adapter.ts`:
```ts
/**
 * Budget Makers Wallet as an `IntegrationProvider`.
 *
 * The only new file that knows Wallet exists. Everything it exposes is in the
 * framework's vocabulary: a credential schema, a reachability test, one sync
 * handler per `SyncKind`, and what disconnecting should do to the accounts it
 * created.
 */

import { z } from "zod";
import { getAccounts } from "@/lib/clients/wallet";
import { errorMessage } from "@/lib/clients/http";
import { recordAudit } from "@/platform/audit/record";
import { verifyHmacSignature } from "@/platform/integrations/webhook-signature";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncContext,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { deletionDecision } from "@/modules/accounts/domain/account";
import { syncProviderAccounts } from "@/modules/accounts/application/sync-provider-accounts";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { walletAccountsSource, WALLET_PROVIDER } from "@/modules/accounts/infrastructure/wallet-adapter";

const credentialSchema = z.object({
  token: z.string().min(1),
  /** Optional: only a deployment that actually receives Wallet webhooks needs one. */
  webhookSecret: z.string().optional().default(""),
});

async function testConnection(credentials: Record<string, string>): Promise<TestResult> {
  try {
    const accounts = await getAccounts({ token: credentials.token!, attempts: 1 });
    return { ok: true, message: `Reached the Wallet API and read ${accounts.length} account(s).` };
  } catch (err) {
    // `errorMessage` never includes the request headers, so the token cannot
    // reach this string; the message is shown to the user verbatim.
    return { ok: false, message: errorMessage(err) };
  }
}

async function syncAccounts(ctx: SyncContext): Promise<Record<string, number>> {
  const source = walletAccountsSource(ctx.clock, ctx.credentials.token!);
  const incoming = await source.fetchAccounts();
  const deps = accountDeps(ctx.db);
  const result = await syncProviderAccounts({ ...deps, source })(ctx.connection.userId, incoming);
  return { ...result };
}

/**
 * Spec §5.2's `disconnect_policy`, applied to the accounts this provider owns.
 * `keep` deliberately does nothing here: the credential is destroyed by the use
 * case in every case, and "keep" means the history stays exactly as it is.
 */
async function onDisconnect(ctx: DisconnectContext): Promise<void> {
  if (ctx.policy === "keep") return;
  const deps = accountDeps(ctx.db);
  const accounts = (await deps.accounts.list(ctx.connection.userId, { includeArchived: true })).filter(
    (a) => a.provider === WALLET_PROVIDER,
  );
  const now = ctx.clock.now();
  let archived = 0;
  let deleted = 0;

  for (const account of accounts) {
    if (ctx.policy === "archive") {
      if (account.status === "archived") continue;
      await deps.accounts.update(ctx.connection.userId, account.id, account.version, {
        status: "archived",
        archivedAt: now,
      });
      archived += 1;
      continue;
    }
    // purge: the link goes first, so `deletionDecision` no longer sees a live
    // provider link and can answer hard_delete for an unreferenced account.
    const decision = deletionDecision(
      { ...account, origin: "manual" },
      { hasLiveProviderLink: false, hasReferences: await deps.accounts.hasReferences(account.id) },
    );
    if (decision === "hard_delete") {
      await deps.accounts.delete(ctx.connection.userId, account.id);
      deleted += 1;
    } else {
      await deps.accounts.update(ctx.connection.userId, account.id, account.version, {
        status: "archived",
        archivedAt: now,
      });
      archived += 1;
    }
  }

  if (ctx.policy === "purge") {
    // Everything is missing now: an empty seen list marks every link.
    await deps.links.markMissing(ctx.connection.userId, WALLET_PROVIDER, "account", [], now);
  }

  await recordAudit(ctx.db, {
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: WALLET_PROVIDER, policy: ctx.policy, archived, deleted },
  });
}

export const walletProvider: IntegrationProvider = {
  code: "wallet",
  label: "Budget Makers Wallet",
  capabilities: ["accounts", "transactions", "interest_posting"],
  credentialSchema,
  credentialFields: [
    { name: "token", label: "API token", secret: true, placeholder: "Bearer token from the BudgetBakers portal" },
    { name: "webhookSecret", label: "Webhook secret", secret: true, placeholder: "Optional" },
  ],
  testConnection: (credentials) => testConnection(credentials),
  syncs: { accounts: syncAccounts },
  webhook: {
    verify: (req, secret) =>
      verifyHmacSignature({ rawBody: req.rawBody, presented: req.headers.get("x-signature"), secret }),
    toSyncRequests: (payload): SyncRequest[] => {
      const event =
        typeof payload === "object" && payload !== null && typeof (payload as { event?: unknown }).event === "string"
          ? (payload as { event: string }).event
          : "unknown";
      return [{ kind: "accounts", event }];
    },
  },
  onDisconnect,
};
```
`credentialSchema`'s inferred output has `webhookSecret: string`, which satisfies `ZodType<Record<string, string>>`.

- [ ] **Step 7: Register the provider**

`src/platform/integrations/register-all.ts`:
```ts
import { walletProvider } from "@/modules/integrations/infrastructure/wallet-provider-adapter";
import { registerProvider } from "./registry";

let done = false;

/** Idempotent, like `ensureJobsRegistered` — every entry point may call it. */
export function ensureProvidersRegistered(): void {
  if (done) return;
  done = true;
  registerProvider(walletProvider);
}
```

- [ ] **Step 8: Run the two Wallet jobs through the engine**

`src/lib/jobs/wallet-accounts-sync.ts` — the whole file below the doc comment becomes:
```ts
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { ownerUserId } from "@/platform/auth/owner";
import { withUserContext } from "@/platform/db/context";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { runSyncForUser } from "@/modules/integrations/application/run-sync";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";

export const JOB_NAME = "wallet_accounts_sync" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunWalletAccountsSyncInput {
  trigger?: "cron" | "manual";
}

/**
 * Daily Wallet account sync, now a thin wrapper over the integration engine:
 * the reconciliation, the credential and the run recording all live there, and
 * this file owns only the `job_runs` row, the advisory lock and the alert.
 *
 * It still syncs exactly one user — the owner — because the schedule is
 * process-wide and there is no per-user cron. Per-user schedules arrive with
 * `sync_jobs` becoming dispatchable in a later phase.
 */
async function syncOwner(userId: string): Promise<Record<string, unknown>> {
  ensureProvidersRegistered();
  const run = await withUserContext(db, { userId, role: "system" }, (tx) =>
    runSyncForUser(integrationDeps(tx))(userId, { provider: "wallet", kind: "accounts", trigger: "cron" }),
  );
  if (run.status === "failed") throw new Error(run.error ?? "wallet accounts sync failed");
  return { runId: run.id, status: run.status, ...run.stats };
}

/** Never throws. Every path ends in a `job_runs` row and a `JobResult`. */
export async function runWalletAccountsSync(input: RunWalletAccountsSyncInput = {}): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });

  try {
    const owner = await ownerUserId(db);
    if (!owner) {
      const skipped = { reason: "no_owner" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    // "Not connected" is a configuration state, not a failure: recorded so the
    // run log explains the silence, but never alerted on.
    const connected = await withUserContext(db, { userId: owner, role: "system" }, (tx) =>
      integrationDeps(tx).connections.getByProvider(owner, "wallet"),
    );
    if (!connected || connected.status !== "connected") {
      const skipped = { reason: "wallet_not_connected" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = await withJobLock(LOCK_KEY, () => syncOwner(owner));
    if (detail === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```
`src/lib/jobs/wallet-refresh.ts` — `refresh(now)` becomes `refresh(now, token)` and `getBalances({ token })`; `runWalletRefresh` resolves the owner's credential before taking the lock:
```ts
    const owner = await ownerUserId(db);
    if (!owner) {
      const skipped = { reason: "no_owner" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const token = await withUserContext(db, { userId: owner, role: "system" }, async (tx) => {
      const deps = integrationDeps(tx);
      const connection = await deps.connections.getByProvider(owner, "wallet");
      if (!connection || connection.status !== "connected") return null;
      const sealed = await deps.connections.readCredentials(owner, connection.id);
      return sealed ? (deps.cipher.open(sealed).token ?? null) : null;
    });
    if (!token) {
      const skipped = { reason: "wallet_not_connected" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
```
then `withJobLock(LOCK_KEY, () => refresh(now, token))`. Update `wallet-refresh.test.ts` and `wallet-accounts-sync.test.ts` mocks accordingly: they already mock `@/lib/clients/wallet` and `@/lib/repo/jobs`; add a mock of `@/modules/integrations/infrastructure/deps` (or of `@/platform/auth/owner` plus the connections repository) returning a connected wallet connection whose credential opens to `{ token: "test-token" }`, and keep every existing assertion about `job_runs` states.

- [ ] **Step 9: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS. `wallet.test.ts`, `wallet-adapter.test.ts`, `wallet-accounts-sync.test.ts` and `wallet-refresh.test.ts` all still assert the same behaviour; only their credential plumbing changed.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(integrations): Budget Makers Wallet on the integration framework"
```

---

### Task 12: Port the Trek adapter onto the framework

**Files:**
- Modify: `dashboard-app/src/lib/clients/trek.ts`, `trek.test.ts`
- Modify: `dashboard-app/src/lib/jobs/trek-sync.ts`, `trek-sync.test.ts`
- Modify: `dashboard-app/src/lib/jobs/trek-sync-job.ts`, `trek-sync-job.test.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/trek-provider-adapter.ts`, `trek-provider-adapter.test.ts`
- Modify: `dashboard-app/src/platform/integrations/register-all.ts`

**Interfaces:**
- Produces:
```ts
// src/lib/clients/trek.ts — the credential is now a parameter
export interface TrekCallOptions {
  config: TrekConfig;              // REQUIRED — { baseUrl, token }
  sleep?: SleepFn; jitter?: () => number; attempts?: number; signal?: AbortSignal;
}
export function getEntries(year: number, opts: TrekCallOptions): Promise<TrekEntry[]>;
export function getStats(year: number, opts: TrekCallOptions): Promise<TrekYearStats | null>;
export function applyDesiredState(input: ApplyDesiredStateInput, opts: TrekCallOptions): Promise<ApplyDesiredStateResult>;
// `trekConfigured()` and `TrekNotConfiguredError` are deleted: "is it set up" is now
// a question about `integration_connections`, not about a file.

// src/lib/jobs/trek-sync.ts
export interface RunTrekSyncInput { year?: number; now?: Date; withStats?: boolean; call: TrekCallOptions }

// src/modules/integrations/infrastructure/trek-provider-adapter.ts
export const trekProvider: IntegrationProvider;   // code "trek", capabilities ["leave"]
```
`TrekConfig` stays exported from `@/lib/env` as a plain interface (`{ baseUrl: string; token: string }`); only `trekConfig()`, the function that read the file, goes away.

- [ ] **Step 1: Write the failing adapter test**

`src/modules/integrations/infrastructure/trek-provider-adapter.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { trekProvider } from "./trek-provider-adapter";

vi.mock("@/lib/clients/trek", () => ({
  getEntries: vi.fn(async (_year: number, opts: { config: { token: string } }) => {
    if (opts.config.token !== "trek_good") throw new Error("MCP rejected the token");
    return [{ id: 1, date: "2026-09-04", note: "", fraction: 1, kind: "vacation" }];
  }),
}));

vi.mock("@/lib/jobs/trek-sync", () => ({
  runTrekSync: vi.fn(async () => ({
    status: "ok",
    year: 2026,
    pulled: 3,
    deleted: 0,
    pushed: 1,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
  })),
}));

describe("trek provider adapter", () => {
  it("declares its code, capability and both credential fields", () => {
    expect(trekProvider.code).toBe("trek");
    expect([...trekProvider.capabilities]).toEqual(["leave"]);
    expect(trekProvider.credentialFields.map((f) => f.name)).toEqual(["baseUrl", "token", "webhookSecret"]);
  });

  it("requires a URL and a token", () => {
    expect(trekProvider.credentialSchema.safeParse({ token: "trek_good" }).success).toBe(false);
    expect(
      trekProvider.credentialSchema.safeParse({ baseUrl: "https://trek.example", token: "trek_good" }).success,
    ).toBe(true);
    expect(
      trekProvider.credentialSchema.safeParse({ baseUrl: "not a url", token: "trek_good" }).success,
    ).toBe(false);
  });

  it("tests with a pure read and reports failure without leaking the token", async () => {
    const ok = await trekProvider.testConnection(
      { baseUrl: "https://trek.example", token: "trek_good" },
      {},
    );
    expect(ok.ok).toBe(true);
    const bad = await trekProvider.testConnection(
      { baseUrl: "https://trek.example", token: "trek_bad" },
      {},
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain("trek_bad");
  });

  it("runs a leave sync and reports the pass counts as stats", async () => {
    const stats = await trekProvider.syncs.leave!({
      connection: {
        id: "c1",
        userId: "u1",
        provider: "trek",
        status: "connected",
        settings: {},
        lastTestAt: null,
        lastSyncAt: null,
        lastError: null,
        disconnectPolicy: "keep",
        version: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      credentials: { baseUrl: "https://trek.example", token: "trek_good" },
      runId: "r1",
      db: {} as never,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async () => {},
    });
    expect(stats).toEqual({ pulled: 3, deleted: 0, pushed: 1 });
  });

  it("leaves leave data alone on every disconnect policy", async () => {
    const audits: string[] = [];
    await trekProvider.onDisconnect({
      connection: {
        id: "c1",
        userId: "u1",
        provider: "trek",
        status: "connected",
        settings: {},
        lastTestAt: null,
        lastSyncAt: null,
        lastError: null,
        disconnectPolicy: "purge",
        version: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      policy: "purge",
      db: {} as never,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async (e) => {
        audits.push(e.action);
      },
    });
    expect(audits).toEqual(["integration.disconnect_applied"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- trek-provider-adapter`
Expected: FAIL — `Cannot find module './trek-provider-adapter'`.

- [ ] **Step 3: Make the Trek client take its credential**

In `src/lib/clients/trek.ts`:
- Add `config: TrekConfig;` as the first member of `TrekCallOptions`, with the same doc comment shape as the Wallet client's `token`.
- Delete `function config()`, `trekConfigured()`, `TrekNotConfiguredError` and `isTrekNotConfigured`, and their `trekConfig` import; keep the `TrekConfig` type import from `@/lib/env`.
- In `getEntries`, `getStats` and `applyDesiredState`, replace `const cfg = config();` with `const cfg = opts.config;`.
- In `trek.test.ts`, replace the token-file/env fixture with a literal `const CONFIG = { baseUrl: "https://trek.example", token: "trek_test" };` and pass `{ config: CONFIG, ... }` at every call site. The `resetTrekAuthCache()` calls stay: the session cache is still per credential fingerprint.

- [ ] **Step 4: Thread the config through the sync**

In `src/lib/jobs/trek-sync.ts`:
```ts
export interface RunTrekSyncInput {
  year?: number;
  now?: Date;
  /**
   * Skips `GET /stats/:year`, which has a write side effect upstream (it
   * persists carry-over). The UI wants the figures; a background pass need not
   * pay for them.
   */
  withStats?: boolean;
  /** The credential, resolved by the caller from the integration vault. */
  call: TrekCallOptions;
}
```
```ts
export async function runTrekSync(input: RunTrekSyncInput): Promise<TrekSyncResult> {
  const year = input.year ?? (input.now ?? new Date()).getFullYear();
  const result = await withJobLock(TREK_SYNC_LOCK_KEY, () => syncPass(input, year));
  return result ?? empty("skipped", year);
}
```
The `trekConfigured()` guard and the `disabled` early return are gone — a caller that has no connection never reaches this function. Keep the `"disabled"` member of `TrekSyncStatus` and the `empty("disabled", year)` helper: `trek-sync-job.ts` still returns it. Inside `syncPass`, `const opts = input.call;` (no `?? {}`).
Update `trek-sync.test.ts`: every `runTrekSync({...})` gains `call: { config: CONFIG, sleep: async () => {} }`, and the case that asserted the unconfigured `disabled` result moves to `trek-sync-job.test.ts` as "no connection ⇒ already_done".

- [ ] **Step 5: Write the provider adapter**

`src/modules/integrations/infrastructure/trek-provider-adapter.ts`:
```ts
/**
 * Trek's Vacay leave planner as an `IntegrationProvider`.
 *
 * The only new file that knows Trek exists. `testConnection` deliberately calls
 * `getEntries` and not `getStats`: the stats tool PERSISTS carry-over as a side
 * effect upstream, and a connection test must not write to the provider.
 */

import { z } from "zod";
import { errorMessage } from "@/lib/clients/http";
import { getEntries } from "@/lib/clients/trek";
import { runTrekSync } from "@/lib/jobs/trek-sync";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncContext,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { verifyHmacSignature } from "@/platform/integrations/webhook-signature";

const TREK_PROVIDER = "trek" as const;

const credentialSchema = z.object({
  baseUrl: z.url(),
  token: z.string().min(1),
  webhookSecret: z.string().optional().default(""),
});

function configOf(credentials: Record<string, string>) {
  return { baseUrl: credentials.baseUrl!.replace(/\/+$/, ""), token: credentials.token! };
}

async function testConnection(credentials: Record<string, string>): Promise<TestResult> {
  try {
    const year = new Date().getFullYear();
    const entries = await getEntries(year, { config: configOf(credentials), attempts: 1 });
    return { ok: true, message: `Reached Trek and read ${entries.length} leave day(s) for ${year}.` };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

async function syncLeave(ctx: SyncContext): Promise<Record<string, number>> {
  const result = await runTrekSync({
    now: ctx.clock.now(),
    call: { config: configOf(ctx.credentials) },
  });
  if (result.status === "failed" || result.status === "partial") {
    // A partial pass means a local edit has not reached Trek. Recording it as a
    // success would let the last-sync stamp stay green while the two calendars
    // drift apart, so the engine is told it failed.
    throw new Error(result.errors.join("; ") || "Trek sync did not complete");
  }
  return { pulled: result.pulled, deleted: result.deleted, pushed: result.pushed };
}

/**
 * Leave days are the user's own record of their year, not the provider's:
 * `leave_days` is written by the dashboard as much as by the sync. No policy
 * deletes them, so all three are a no-op beyond the audit line. The timeoff
 * module (Phase 7) revisits this when the data model becomes `timeoff_events`.
 */
async function onDisconnect(ctx: DisconnectContext): Promise<void> {
  await ctx.audit({
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: TREK_PROVIDER, policy: ctx.policy, leaveDaysKept: true },
  });
}

export const trekProvider: IntegrationProvider = {
  code: TREK_PROVIDER,
  label: "Trek",
  capabilities: ["leave"],
  credentialSchema,
  credentialFields: [
    { name: "baseUrl", label: "Trek URL", secret: false, placeholder: "https://trek.example.com" },
    { name: "token", label: "MCP token", secret: true, placeholder: "trek_…" },
    { name: "webhookSecret", label: "Webhook secret", secret: true, placeholder: "Optional" },
  ],
  testConnection: (credentials) => testConnection(credentials),
  syncs: { leave: syncLeave },
  webhook: {
    verify: (req, secret) =>
      verifyHmacSignature({ rawBody: req.rawBody, presented: req.headers.get("x-signature"), secret }),
    toSyncRequests: (payload): SyncRequest[] => {
      const event =
        typeof payload === "object" && payload !== null && typeof (payload as { event?: unknown }).event === "string"
          ? (payload as { event: string }).event
          : "unknown";
      return [{ kind: "leave", event }];
    },
  },
  onDisconnect,
};
```
Register it in `src/platform/integrations/register-all.ts`:
```ts
  registerProvider(walletProvider);
  registerProvider(trekProvider);
```

- [ ] **Step 6: Run the Trek job through the engine**

`src/lib/jobs/trek-sync-job.ts` keeps its `job_runs` bookkeeping and its "does not alert" policy, and resolves the connection instead of the file:
```ts
export async function runTrekSyncJob(input: RunTrekSyncJobInput = {}): Promise<JobResult> {
  const { trigger = "cron" } = input;
  ensureProvidersRegistered();

  // Checked before opening a run row, so an install with no Trek connection
  // writes nothing: an hourly job logging "not configured" 24 times a day would
  // push every other job off the Administration page's 20-row log.
  const owner = await ownerUserId(db);
  const connection = owner
    ? await withUserContext(db, { userId: owner, role: "system" }, (tx) =>
        integrationDeps(tx).connections.getByProvider(owner, "trek"),
      )
    : null;
  if (!owner || !connection || connection.status !== "connected") {
    return { job: JOB_NAME, status: "already_done", detail: { reason: "not_connected" } };
  }

  const run = await startRun({ jobName: JOB_NAME, trigger });
  try {
    const syncRun = await withUserContext(db, { userId: owner, role: "system" }, (tx) =>
      runSyncForUser(integrationDeps(tx))(owner, { provider: "trek", kind: "leave", trigger: "cron" }),
    );
    if (syncRun.status === "failed") {
      await finishRun(run.id, "failed", { error: syncRun.error ?? "trek sync failed", detail: syncRun.stats });
      return { job: JOB_NAME, status: "failed", error: syncRun.error ?? "trek sync failed", detail: syncRun.stats };
    }
    if (syncRun.status === "running") {
      const skipped = { reason: "already_running" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const detail = { runId: syncRun.id, ...syncRun.stats };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, "failed", { error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```
Keep `summarize()` exported and tested — the Work page still formats a pass with it.

`src/app/actions/leave.ts` calls `runTrekSync` in three places (`setLeaveDay`, `removeLeaveDay`, `syncLeaveNow`), so it needs the credential too. Add one helper at the top of that file and pass its result into every call:
```ts
/**
 * The signed-in user's Trek credential, or null when they have not connected
 * it. Every caller below treats null as "the sync is off" rather than an
 * error — the same contract the deleted `trekConfig()` had.
 */
async function trekCall(): Promise<TrekCallOptions | null> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, async (tx) => {
    const deps = integrationDeps(tx);
    const connection = await deps.connections.getByProvider(principal.userId, "trek");
    if (!connection || connection.status !== "connected") return null;
    const sealed = await deps.connections.readCredentials(principal.userId, connection.id);
    if (!sealed) return null;
    const credentials = deps.cipher.open(sealed);
    return { config: { baseUrl: credentials.baseUrl!, token: credentials.token! } };
  });
}
```
At each call site, `const call = await trekCall();` then `if (!call) return fail("Trek is not connected. Connect it in Settings › Integrations.");` before `runTrekSync({ ..., call })`. Update `src/app/actions/leave.test.ts`'s `runTrekSync` mock assertions to expect the extra `call` argument, and add one case asserting the "not connected" message.

- [ ] **Step 7: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration && grep -rn "trekConfig(\|walletToken(" src`
Expected: tests PASS; the grep prints nothing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(integrations): Trek on the integration framework"
```

---

### Task 13: One-time import of the file-mounted credentials

**Files:**
- Create: `dashboard-app/src/modules/integrations/application/import-file-credentials.ts`, `import-file-credentials.test.ts`
- Create: `dashboard-app/scripts/import-file-credentials.ts`
- Modify: `dashboard-app/package.json` (script), `dashboard-app/Dockerfile` (bundle and copy the script)

**Interfaces:**
- Consumes: `IntegrationDeps`, `connectIntegration`.
- Produces:
```ts
export interface FileCredentials {
  wallet?: { token: string };
  trek?: { baseUrl: string; token: string };
}
export interface ImportResult { imported: ProviderCode[]; skipped: { provider: ProviderCode; reason: string }[] }
export function importFileCredentials(deps: IntegrationDeps): (
  principal: Principal, files: FileCredentials,
) => Promise<ImportResult>;
```
Import is idempotent: a provider that already has a connection with a stored credential is skipped with `reason: "already_connected"`, so re-running the script after a failed deploy step is safe. `npm run migrate:credentials` runs the script.

- [ ] **Step 1: Write the failing test**

`src/modules/integrations/application/import-file-credentials.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "../infrastructure/memory-repositories";
import type { IntegrationDeps } from "./deps";
import { importFileCredentials } from "./import-file-credentials";

const principal = testPrincipal();

function stub(code: "wallet" | "trek"): IntegrationProvider {
  return {
    code,
    label: code,
    capabilities: code === "wallet" ? ["accounts"] : ["leave"],
    credentialSchema:
      code === "wallet"
        ? z.object({ token: z.string().min(1) })
        : z.object({ baseUrl: z.url(), token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" || code === "trek" ? stub(code) : null),
    list: () => [stub("wallet"), stub("trek")],
  };
  return {
    connections: new MemoryConnectionsRepository(),
    runs: new MemorySyncRunsRepository(),
    deliveries: new MemoryWebhookDeliveriesRepository(),
    cipher: memoryCipher(),
    registry,
    db: {} as never,
    clock: { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: async () => {},
  };
}

describe("importFileCredentials", () => {
  it("imports both tokens into encrypted connections", async () => {
    const deps = makeDeps();
    const result = await importFileCredentials(deps)(principal, {
      wallet: { token: "wallet-token" },
      trek: { baseUrl: "https://trek.example", token: "trek_token" },
    });
    expect(result.imported.sort()).toEqual(["trek", "wallet"]);
    const wallet = await deps.connections.getByProvider(principal.userId, "wallet");
    const sealed = await deps.connections.readCredentials(principal.userId, wallet!.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "wallet-token" });
  });

  it("skips a provider with no file and one that is already connected", async () => {
    const deps = makeDeps();
    await importFileCredentials(deps)(principal, { wallet: { token: "first" } });
    const second = await importFileCredentials(deps)(principal, { wallet: { token: "second" } });
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual([
      { provider: "wallet", reason: "already_connected" },
      { provider: "trek", reason: "no_file" },
    ]);
    const wallet = await deps.connections.getByProvider(principal.userId, "wallet");
    const sealed = await deps.connections.readCredentials(principal.userId, wallet!.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "first" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- import-file-credentials`
Expected: FAIL — `Cannot find module './import-file-credentials'`.

- [ ] **Step 3: Write the use case**

`src/modules/integrations/application/import-file-credentials.ts`:
```ts
import type { Principal } from "@/platform/auth/principal";
import type { ProviderCode } from "@/platform/integrations/types";
import { connectIntegration } from "./connect-integration";
import type { IntegrationDeps } from "./deps";

export interface FileCredentials {
  wallet?: { token: string };
  trek?: { baseUrl: string; token: string };
}

export interface ImportResult {
  imported: ProviderCode[];
  skipped: { provider: ProviderCode; reason: string }[];
}

/**
 * The one-time migration from the two mounted token files to the encrypted
 * vault (spec §6, §12).
 *
 * Idempotent on purpose: a provider that already holds a credential is skipped
 * rather than overwritten, so re-running after a half-finished deploy step
 * cannot replace a token the owner has since rotated from the UI.
 */
export function importFileCredentials(deps: IntegrationDeps) {
  return async (principal: Principal, files: FileCredentials): Promise<ImportResult> => {
    const result: ImportResult = { imported: [], skipped: [] };
    const entries: [ProviderCode, Record<string, string> | undefined][] = [
      ["wallet", files.wallet],
      ["trek", files.trek],
    ];

    for (const [provider, credentials] of entries) {
      if (!credentials) {
        result.skipped.push({ provider, reason: "no_file" });
        continue;
      }
      const existing = await deps.connections.getByProvider(principal.userId, provider);
      if (existing && (await deps.connections.readCredentials(principal.userId, existing.id))) {
        result.skipped.push({ provider, reason: "already_connected" });
        continue;
      }
      await connectIntegration(deps)(principal, { provider, credentials });
      result.imported.push(provider);
    }

    await deps.audit({
      actorUserId: principal.userId,
      action: "integration.import_file_credentials",
      entityType: "integration_connection",
      after: { imported: result.imported, skipped: result.skipped },
    });
    return result;
  };
}
```

- [ ] **Step 4: Write the script**

`scripts/import-file-credentials.ts`. Per Ruling R16 it builds its own Drizzle client from `DATABASE_URL` and reads the remaining variables straight from `process.env`, so the one-off container needs no full app environment:
```ts
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { DbClient } from "@/lib/db/client";
import { ownerUserId } from "@/platform/auth/owner";
import { withUserContext } from "@/platform/db/context";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { createCredentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { recordAudit } from "@/platform/audit/record";
import { DrizzleConnectionsRepository } from "@/modules/integrations/infrastructure/drizzle-connections-repository";
import { DrizzleSyncRunsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "@/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository";
import {
  importFileCredentials,
  type FileCredentials,
} from "@/modules/integrations/application/import-file-credentials";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function readTrimmed(path: string | undefined): string | null {
  if (!path) return null;
  try {
    const value = readFileSync(path, "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const encryptionKey = process.env.APP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("APP_ENCRYPTION_KEY is required");

  ensureProvidersRegistered();
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = drizzle(pool, { schema }) as unknown as DbClient;
    const owner = await ownerUserId(db);
    if (!owner) throw new Error("No active owner; run the app once so the bootstrap seed can run");
    const [row] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, owner));

    const walletToken = readTrimmed(process.env.WALLET_TOKEN_FILE ?? "/secrets/wallet-token");
    const trekToken = readTrimmed(process.env.TREK_TOKEN_FILE ?? "/secrets/trek-token");
    const trekUrl = process.env.TREK_URL?.trim();
    const files: FileCredentials = {
      ...(walletToken ? { wallet: { token: walletToken } } : {}),
      ...(trekToken && trekUrl && trekUrl !== "https://"
        ? { trek: { baseUrl: trekUrl.replace(/\/+$/, ""), token: trekToken } }
        : {}),
    };

    const result = await withUserContext(db, { userId: owner }, (tx) =>
      importFileCredentials({
        connections: new DrizzleConnectionsRepository(tx),
        runs: new DrizzleSyncRunsRepository(tx),
        deliveries: new DrizzleWebhookDeliveriesRepository(tx),
        cipher: createCredentialCipher(encryptionKey),
        registry: providerRegistry,
        db: tx,
        clock: { now: () => new Date() },
        audit: (e) => recordAudit(tx, e),
      })(
        {
          userId: owner,
          organizationId: row!.organizationId,
          roles: ["owner"],
          permissions: permissionsForRoles(["owner"]),
        },
        files,
      ),
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
```
Add to `package.json`: `"migrate:credentials": "tsx scripts/import-file-credentials.ts"`.

The runbook execs this inside the container, so it also has to ship in the image. In `dashboard-app/Dockerfile`, add a third esbuild block copying the `migrate-teable.ts` one exactly, with the input and output changed:
```dockerfile
RUN ./node_modules/.bin/esbuild scripts/import-file-credentials.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node22 \
      --external:pg-native \
      --external:cloudflare:sockets \
      --banner:js="import{createRequire as __nodeRequire}from'node:module';const require=__nodeRequire(import.meta.url);" \
      --outfile=import-file-credentials.mjs
```
and a matching copy line next to the other three:
```dockerfile
COPY --from=builder --chown=1000:1000 /app/import-file-credentials.mjs ./import-file-credentials.mjs
```

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npm test -- import-file-credentials`
Expected: PASS (2 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(integrations): one-time import of the mounted Wallet and Trek tokens"
```

---
### Task 14: The integrations REST API

**Files:**
- Create: `dashboard-app/src/modules/integrations/api/schemas.ts`, `routes.ts`
- Test: `dashboard-app/src/modules/integrations/api/routes.itest.ts`
- Modify: `dashboard-app/src/platform/http/app.ts`
- Modify: `dashboard-app/src/modules/accounts/api/routes.ts` (drop the Phase-1 wallet route)
- Modify: `dashboard-app/src/app/api/v1/[[...route]]/route.ts`

**Interfaces:**
- Consumes: `ApiApp`, `ApiDeps` from `@/platform/http/app`; the use cases from Tasks 9, 10 and 13; `integrationDeps`.
- Produces the routes below and `export function registerIntegrationRoutes(app: ApiApp, deps: ApiDeps): void`.

| Method | Path | Permission | Body / query |
|---|---|---|---|
| `GET` | `/api/v1/integrations` | `accounts.read` | — |
| `POST` | `/api/v1/integrations/{provider}/connect` | `integrations.manage` | `{ credentials: Record<string,string>, settings?: object, disconnectPolicy?: "keep"\|"archive"\|"purge" }` |
| `POST` | `/api/v1/integrations/{provider}/test` | `integrations.manage` | — |
| `POST` | `/api/v1/integrations/{provider}/sync` | `integrations.manage` | `{ kind?: "accounts"\|"leave" }` |
| `POST` | `/api/v1/integrations/{provider}/disconnect` | `integrations.manage` | `{ policy?: "keep"\|"archive"\|"purge" }` |
| `GET` | `/api/v1/integrations/{provider}/sync-runs` | `accounts.read` | `?limit=` (1–200, default 20) |

`POST /api/v1/integrations/wallet/sync` keeps working — the Phase-1 route's path is a special case of the new one — but its **response shape changes** from the raw reconciliation counts to `{ run: SyncRun }`, with the counts under `run.stats`. That is the one breaking API change in Phase 2 and Task 18 documents it. Every route answers `503 integration_unavailable` where Phase 1 did, via the same `errorResponses` map.

- [ ] **Step 1: Write the failing API integration test**

`src/modules/integrations/api/routes.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, users } from "@/lib/db/schema";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import { resetCredentialCipher } from "@/platform/integrations/crypto";
import { z } from "zod";
import type { IntegrationProvider } from "@/platform/integrations/types";
import {
  ConnectionSchema,
  IntegrationListResponseSchema,
  SyncRunSchema,
  SyncRunsPageSchema,
  TestResultSchema,
} from "./schemas";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";

const KEY = `k1:${Buffer.alloc(32, 3).toString("base64")}`;

function fakeProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async (credentials) =>
      credentials.token === "good"
        ? { ok: true, message: "Reached the provider." }
        : { ok: false, message: "Refused." },
    syncs: { accounts: async () => ({ created: 1 }) },
    onDisconnect: async () => {},
  };
}

describe("integration routes", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    resetCredentialCipher();
    process.env.APP_ENCRYPTION_KEY = KEY;
    registerProvider(fakeProvider());
  });
  afterAll(closeDb);

  async function seed() {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Acme" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const deps: ApiDeps = {
      db,
      authenticate: async (req: Request) => {
        const id = req.headers.get("x-test-user");
        if (!id) return null;
        const roles = [(req.headers.get("x-test-role") ?? "owner") as RoleCode];
        const principal: Principal = {
          userId: id,
          organizationId: org!.id,
          roles,
          permissions: permissionsForRoles(roles),
        };
        return { principal, method: "session" as const };
      },
      now: () => new Date("2026-09-04T09:00:00Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), userA: userA! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  it("lists, connects, tests, syncs, lists runs and disconnects", async () => {
    const { app, userA } = await seed();
    const h = headers(userA.id);

    const before = await app.request("/api/v1/integrations", { headers: h });
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(IntegrationListResponseSchema.parse(beforeBody)).toBeTruthy();
    expect(beforeBody.items[0].connection).toBeNull();

    const connect = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(connect.status).toBe(200);
    const connected = await connect.json();
    expect(ConnectionSchema.parse(connected.connection)).toBeTruthy();
    expect(connected.connection.status).toBe("connected");
    // The response must never carry the credential back.
    expect(JSON.stringify(connected)).not.toContain("good");

    const test = await app.request("/api/v1/integrations/wallet/test", { method: "POST", headers: h });
    expect(test.status).toBe(200);
    expect(TestResultSchema.parse(await test.json())).toBeTruthy();

    const sync = await app.request("/api/v1/integrations/wallet/sync", {
      method: "POST",
      headers: h,
      body: JSON.stringify({}),
    });
    expect(sync.status).toBe(200);
    const syncBody = await sync.json();
    expect(SyncRunSchema.parse(syncBody.run)).toBeTruthy();
    expect(syncBody.run.status).toBe("success");
    expect(syncBody.run.stats).toEqual({ created: 1 });

    const runs = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: h });
    expect(runs.status).toBe(200);
    const runsBody = await runs.json();
    expect(SyncRunsPageSchema.parse(runsBody)).toBeTruthy();
    expect(runsBody.items).toHaveLength(1);

    const disconnect = await app.request("/api/v1/integrations/wallet/disconnect", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ policy: "keep" }),
    });
    expect(disconnect.status).toBe(200);
    expect(await disconnect.json()).toEqual({ policy: "keep" });
  });

  it("refuses an unknown provider, a viewer's write and a cookie write without X-Requested-With", async () => {
    const { app, userA } = await seed();

    const unknown = await app.request("/api/v1/integrations/nope/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(unknown.status).toBe(404);
    expect(ErrorResponseSchema.parse(await unknown.json())).toBeTruthy();

    const viewer = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id, { "x-test-role": "viewer" }),
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(viewer.status).toBe(403);

    const noCsrf = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userA.id },
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("csrf_required");
  });

  it("refuses a sync for a provider that was never connected", async () => {
    const { app, userA } = await seed();
    const res = await app.request("/api/v1/integrations/wallet/sync", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- integrations/api/routes`
Expected: FAIL — `Cannot find module './schemas'`.

- [ ] **Step 3: Write the schemas**

`src/modules/integrations/api/schemas.ts` — Zod schemas via `z` from `@hono/zod-openapi`, matching the accounts module's style (`.openapi({ example })` where helpful):
```ts
import { z } from "@hono/zod-openapi";

export const ProviderParamSchema = z.object({
  provider: z.string().min(1).openapi({ param: { name: "provider", in: "path" }, example: "wallet" }),
});

export const ConnectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  status: z.enum(["disconnected", "connected", "error", "disabled"]),
  settings: z.record(z.string(), z.unknown()),
  lastTestAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  disconnectPolicy: z.enum(["keep", "archive", "purge"]),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CredentialFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean(),
  placeholder: z.string().optional(),
});

export const IntegrationSummarySchema = z.object({
  provider: z.string(),
  label: z.string(),
  capabilities: z.array(z.string()),
  credentialFields: z.array(CredentialFieldSchema),
  connection: ConnectionSchema.nullable(),
});

export const IntegrationListResponseSchema = z.object({ items: z.array(IntegrationSummarySchema) });

export const SyncRunSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  kind: z.enum(["accounts", "leave"]),
  status: z.enum(["running", "success", "failed", "skipped"]),
  trigger: z.enum(["cron", "manual", "webhook", "api"]),
  stats: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const SyncRunsPageSchema = z.object({ items: z.array(SyncRunSchema) });
export const SyncResponseSchema = z.object({ run: SyncRunSchema });

export const TestResultSchema = z.object({ ok: z.boolean(), message: z.string() });

export const ConnectRequestSchema = z.object({
  /** Field names come from the provider's own `credentialFields`; values are write-only and never returned. */
  credentials: z.record(z.string(), z.string()),
  settings: z.record(z.string(), z.unknown()).optional(),
  disconnectPolicy: z.enum(["keep", "archive", "purge"]).optional(),
});

export const ConnectResponseSchema = z.object({
  connection: ConnectionSchema,
  test: TestResultSchema,
});

export const SyncRequestBodySchema = z.object({ kind: z.enum(["accounts", "leave"]).optional() });
export const DisconnectRequestSchema = z.object({ policy: z.enum(["keep", "archive", "purge"]).optional() });
export const DisconnectResponseSchema = z.object({ policy: z.enum(["keep", "archive", "purge"]) });
export const SyncRunsQuerySchema = z.object({ limit: z.string().optional() });
```

- [ ] **Step 4: Write the routes**

`src/modules/integrations/api/routes.ts` follows `src/modules/accounts/api/routes.ts` exactly: one `createRoute` per endpoint with `tags: ["Integrations"]`, `security: [{ session: [] }]`, the shared `commonErrorResponses`, and a `toApiError` mapper:
```ts
function toApiError(err: unknown): ApiError {
  if (err instanceof UnknownProviderError) return new ApiError(404, "not_found", err.message);
  if (err instanceof ConnectionNotFoundError) return new ApiError(409, "conflict", err.message);
  if (err instanceof ConnectionNotUsableError) return new ApiError(409, "conflict", err.message);
  if (err instanceof SyncNotSupportedError) return new ApiError(422, "validation_failed", err.message);
  if (err instanceof CredentialValidationError) return new ApiError(422, "validation_failed", err.message, err.issues);
  if (err instanceof ConnectionVersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof UpstreamError) return new ApiError(503, "integration_unavailable", err.message);
  throw err;
}
```
DTOs serialise dates with `toISOString()` and `null` stays `null`, exactly as `accountDto` does. Each handler resolves the provider code from the path parameter, wraps its use case in `withUserContext(deps.db, { userId: principal.userId }, tx => …(integrationDeps(tx, c.get("requestId"))))`, and returns the DTO. The sync handler defaults `kind` to the provider's first implemented sync:
```ts
    const provider = providerRegistry.get(providerCode);
    if (!provider) throw new ApiError(404, "not_found", `No integration named ${providerCode}`);
    const kind = body.kind ?? (Object.keys(provider.syncs)[0] as SyncKind | undefined);
    if (!kind) throw new ApiError(422, "validation_failed", `${providerCode} has no sync to run`);
```
Export `registerIntegrationRoutes(app, deps)` registering all six.

- [ ] **Step 5: Wire it in and remove the Phase-1 wallet route**

In `src/platform/http/app.ts`:
```ts
import { registerIntegrationRoutes } from "@/modules/integrations/api/routes";
```
```ts
export function registerAllRoutes(app: ApiApp, deps: ApiDeps): void {
  registerAccountRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
}
```
In `src/modules/accounts/api/routes.ts`, delete `walletSyncRoute`, its handler, the `WalletSyncResultSchema` import (and its declaration in `api/schemas.ts`), and the now-unused imports (`assertWalletSyncAllowed`, `syncProviderAccounts`, `walletAccountsSource`, `walletToken`, and `UpstreamError` if nothing else in the file uses it). Update `routes.itest.ts`, which asserts on the old wallet-sync route, to drop those assertions — the new route has its own test file.

Delete `assertWalletSyncAllowed` from `sync-provider-accounts.ts` and the cases covering it in `sync-provider-accounts.test.ts`: Rulings R10 and R18 are superseded, because a connection now has an owner of its own and `integrations.manage` on it is the whole check (Ruling P2-7).

Delete `syncWalletAction` from `src/app/actions/accounts.ts` and its test; `syncIntegrationAction` (Task 18) replaces it. Point the Accounts page's "Sync now" control at the new action, or — until Task 18 lands — at a link to `/settings/integrations/wallet`.

In `src/app/api/v1/[[...route]]/route.ts`, call `ensureProvidersRegistered()` before `createApiApp(...)`.

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS. `npm test` will fail the OpenAPI drift test — that is expected and Task 18 regenerates the document; note it and continue.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): REST API for connect, test, sync, sync runs and disconnect"
```

---

### Task 15: The inbound webhook endpoint

**Files:**
- Create: `dashboard-app/src/modules/integrations/application/handle-webhook.ts`, `handle-webhook.test.ts`
- Modify: `dashboard-app/src/modules/integrations/api/routes.ts`, `schemas.ts`
- Modify: `dashboard-app/src/platform/http/app.ts`
- Test: `dashboard-app/src/modules/integrations/api/webhook.itest.ts`

**Interfaces:**
- Consumes: `IntegrationDeps`, `runSyncForUser`, `verifyHmacSignature` (through each provider's `webhook.verify`).
- Produces:
```ts
export interface WebhookOutcome {
  accepted: boolean;
  connectionId: string | null;
  runIds: string[];
}
export function handleWebhook(deps: IntegrationDeps): (input: {
  provider: string; rawBody: string; headers: Headers;
}) => Promise<WebhookOutcome>;
```
Route: `POST /api/v1/webhooks/{provider}`. It carries **no session**, so `createApiApp` must skip authentication, the CSRF check and the per-principal rate limiter for it:
```ts
/** Paths that authenticate themselves. Only the inbound webhook qualifies today. */
const PUBLIC_PREFIXES = ["/api/v1/webhooks/"];
function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}
```
guarding the three `app.use("*", …)` middlewares with `if (isPublic(c.req.path)) return next();`.

Verification, per spec §6: the body's HMAC-SHA256 must match `X-Signature: sha256=<hex>` under **the receiving connection's own `webhookSecret`**. Since the path names only the provider, every `connected` connection for that provider is tried and the first whose secret verifies wins; a connection whose stored `webhookSecret` is empty can never match. No match ⇒ `404` and a `rejected` delivery row, mirroring `src/lib/auth/machine.ts`'s "a machine endpoint must not confirm it exists".

- [ ] **Step 1: Write the failing use-case test**

`src/modules/integrations/application/handle-webhook.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import { verifyHmacSignature } from "@/platform/integrations/webhook-signature";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "../infrastructure/memory-repositories";
import { connectIntegration } from "./connect-integration";
import type { IntegrationDeps } from "./deps";
import { handleWebhook } from "./handle-webhook";

const principal = testPrincipal();
const BODY = '{"event":"accounts.changed"}';
const SECRET = "hook-secret";

let syncs: number;

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1), webhookSecret: z.string().optional().default("") }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {
      accounts: async () => {
        syncs += 1;
        return { created: 1 };
      },
    },
    webhook: {
      verify: (req, secret) =>
        verifyHmacSignature({ rawBody: req.rawBody, presented: req.headers.get("x-signature"), secret }),
      toSyncRequests: () => [{ kind: "accounts", event: "accounts.changed" }],
    },
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return {
    connections: new MemoryConnectionsRepository(),
    runs: new MemorySyncRunsRepository(),
    deliveries: new MemoryWebhookDeliveriesRepository(),
    cipher: memoryCipher(),
    registry,
    db: {} as never,
    clock: { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: async () => {},
  };
}

function signature(secret: string): Headers {
  return new Headers({
    "x-signature": `sha256=${createHmac("sha256", secret).update(BODY, "utf8").digest("hex")}`,
  });
}

describe("handleWebhook", () => {
  beforeEach(() => {
    syncs = 0;
  });

  it("accepts a correctly signed body and starts the provider's syncs", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const outcome = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature(SECRET),
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.runIds).toHaveLength(1);
    expect(syncs).toBe(1);
    const deliveries = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows;
    expect(deliveries[0]!.status).toBe("accepted");
    expect(deliveries[0]!.event).toBe("accounts.changed");
  });

  it("rejects a wrong signature, an unknown provider and a connection with no secret", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const wrong = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature("not-the-secret"),
    });
    expect(wrong.accepted).toBe(false);
    expect(syncs).toBe(0);
    expect((deps.deliveries as MemoryWebhookDeliveriesRepository).rows[0]!.status).toBe("rejected");

    const unknown = await handleWebhook(deps)({
      provider: "nope",
      rawBody: BODY,
      headers: signature(SECRET),
    });
    expect(unknown.accepted).toBe(false);

    const noSecret = makeDeps();
    await connectIntegration(noSecret)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: "" },
    });
    const result = await handleWebhook(noSecret)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature(""),
    });
    expect(result.accepted).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- handle-webhook`
Expected: FAIL — `Cannot find module './handle-webhook'`.

- [ ] **Step 3: Write the use case**

`src/modules/integrations/application/handle-webhook.ts`:
```ts
import { createHash } from "node:crypto";
import type { ProviderCode } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { runSyncForUser } from "./run-sync";

export interface WebhookOutcome {
  accepted: boolean;
  connectionId: string | null;
  runIds: string[];
}

/**
 * Spec §3.4: an inbound webhook validates its signature and turns into sync
 * work — it never does the work inline in the request that delivered it, and
 * it never trusts a single field of the payload beyond the event name.
 *
 * The path names only the provider, so the receiving connection is discovered
 * by trying each connected one's own webhook secret. That is O(connections),
 * which is one or two here, and it keeps the secret per connection rather than
 * making one deployment-wide secret speak for every user.
 */
export function handleWebhook(deps: IntegrationDeps) {
  return async (input: {
    provider: string;
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookOutcome> => {
    const rejected: WebhookOutcome = { accepted: false, connectionId: null, runIds: [] };
    const provider = deps.registry.get(input.provider);
    if (!provider?.webhook) return rejected;

    const code = provider.code as ProviderCode;
    const payloadHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");
    const receivedAt = deps.clock.now();

    const candidates = await deps.connections.candidatesForWebhook(code);
    for (const connection of candidates) {
      const sealed = await deps.connections.readCredentials(connection.userId, connection.id);
      if (!sealed) continue;
      const secret = deps.cipher.open(sealed).webhookSecret ?? "";
      if (!secret) continue;
      if (!provider.webhook.verify({ rawBody: input.rawBody, headers: input.headers }, secret)) continue;

      let payload: unknown = null;
      try {
        payload = JSON.parse(input.rawBody);
      } catch {
        payload = null;
      }
      const requests = provider.webhook.toSyncRequests(payload);
      const runIds: string[] = [];
      for (const request of requests) {
        const run = await runSyncForUser(deps)(connection.userId, {
          provider: code,
          kind: request.kind,
          trigger: "webhook",
        });
        runIds.push(run.id);
      }
      await deps.deliveries.record({
        connectionId: connection.id,
        provider: code,
        event: requests[0]?.event ?? "unknown",
        payloadHash,
        status: "accepted",
        error: null,
        receivedAt,
      });
      return { accepted: true, connectionId: connection.id, runIds };
    }

    await deps.deliveries.record({
      connectionId: null,
      provider: code,
      event: "unverified",
      payloadHash,
      status: "rejected",
      error: "No connected connection verified this signature",
      receivedAt,
    });
    return rejected;
  };
}
```

- [ ] **Step 4: Open the public path and add the route**

In `src/platform/http/app.ts`, add the `PUBLIC_PREFIXES` / `isPublic` pair described under **Interfaces** and guard the authenticate, CSRF and rate-limit middlewares with it. Keep the request-id middleware unguarded — a webhook still gets a request id.

In `src/modules/integrations/api/schemas.ts` add:
```ts
export const WebhookResponseSchema = z.object({
  accepted: z.boolean(),
  runIds: z.array(z.string()),
});
```
In `routes.ts`, register:
```ts
const webhookRoute = createRoute({
  method: "post",
  path: "/webhooks/{provider}",
  tags: ["Integrations"],
  // No `security`: this endpoint authenticates itself with an HMAC over the
  // raw body, using the receiving connection's own webhook secret.
  request: { params: ProviderParamSchema, body: { content: { "application/json": { schema: z.unknown() } } } },
  responses: {
    202: { description: "Signature verified; syncs queued.", content: { "application/json": { schema: WebhookResponseSchema } } },
    404: errorResponse("The signature did not verify against any connection, or the provider does not exist."),
  },
});
```
Handler:
```ts
  app.openapi(webhookRoute, async (c) => {
    const providerCode = c.req.param("provider")!;
    const rawBody = await c.req.raw.clone().text();
    // No principal exists here, so the lookup runs in the system context; the
    // sync itself still runs as the connection's own user.
    const outcome = await withSystemContext(deps.db, (tx) =>
      handleWebhook(integrationDeps(tx, c.get("requestId")))({
        provider: providerCode,
        rawBody,
        headers: c.req.raw.headers,
      }),
    );
    if (!outcome.accepted) {
      throw new ApiError(404, "not_found", "No such webhook endpoint");
    }
    return c.json({ accepted: true, runIds: outcome.runIds }, 202);
  });
```

- [ ] **Step 5: Write the route integration test**

`src/modules/integrations/api/webhook.itest.ts` — same `seed()` shape as `routes.itest.ts` (registering a provider whose `webhook.verify` uses `verifyHmacSignature`), then:
```ts
  it("accepts a signed webhook without a session and refuses an unsigned one", async () => {
    const { app, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    const body = '{"event":"accounts.changed"}';
    const signature = `sha256=${createHmac("sha256", "hook-secret").update(body, "utf8").digest("hex")}`;

    const ok = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    expect(ok.status).toBe(202);
    const okBody = await ok.json();
    expect(okBody.accepted).toBe(true);
    expect(okBody.runIds).toHaveLength(1);

    const unsigned = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(unsigned.status).toBe(404);

    // And it is genuinely public: no session header was sent on either call.
    const runs = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    expect((await runs.json()).items.some((r: { trigger: string }) => r.trigger === "webhook")).toBe(true);
  });
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS apart from the known OpenAPI drift failure, which Task 18 clears.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): signed inbound webhook endpoint that queues syncs"
```

---

### Task 16: Capabilities and navigation from connections

**Files:**
- Modify: `dashboard-app/src/platform/capabilities/resolve.ts`, `resolve.test.ts`
- Modify: `dashboard-app/src/platform/capabilities/probes.ts`, `probes.itest.ts`
- Modify: `dashboard-app/src/platform/capabilities/navigation.ts`, `navigation.test.ts`
- Modify: `dashboard-app/src/modules/home/cards.ts`, `cards.test.ts`
- Modify: `dashboard-app/src/app/(app)/finance/expenses/page.tsx`, `interests/page.tsx`

**Interfaces:**
- Produces:
```ts
// resolve.ts
export interface CapabilityProbes {
  /** Connection status per provider for this user, straight from integration_connections. */
  connectionStates(userId: string): Promise<Record<ProviderCode, IntegrationState>>;
  /** Still environment-driven until the document store lands in Phase 4. */
  payrollConfigured(): boolean;
  hasAccounts(userId: string): Promise<boolean>;
  hasPayrollRecords(userId: string): Promise<boolean>;
}
// probes.ts
export function connectionProbes(client: DbClient): Pick<CapabilityProbes, "connectionStates">;
export function stateForStatus(status: ConnectionStatus | null): IntegrationState;
// navigation.ts — unchanged signature; Settings now returns children
```
`Capabilities` itself is unchanged: `integrations: { wallet, trek, payroll }` with the same `IntegrationState` union.

- [ ] **Step 1: Write the failing tests**

In `src/platform/capabilities/resolve.test.ts`, replace the existing `probes` factory (which today returns `walletConfigured`/`trekConfigured` booleans) with one built on connection states, and add two cases:
```ts
import type { IntegrationState } from "./resolve";

const probes = (o: Partial<{ wallet: IntegrationState; trek: IntegrationState; payroll: boolean }>) => ({
  connectionStates: async (_userId: string) => ({
    wallet: o.wallet ?? ("not_configured" as IntegrationState),
    trek: o.trek ?? ("not_configured" as IntegrationState),
  }),
  payrollConfigured: () => o.payroll ?? false,
  hasAccounts: async (_userId: string) => true,
  hasPayrollRecords: async (_userId: string) => false,
});
```
```ts
  it("derives features from connection state, not from configuration files", async () => {
    const caps = await resolveCapabilities(testPrincipal(), probes({ wallet: "connected", trek: "error" }));
    expect(caps.integrations).toEqual({ wallet: "connected", trek: "error", payroll: "not_configured" });
    expect(caps.features.expenses).toBe(true);
    expect(caps.features.interests).toBe(true);
    // An integration in `error` is not a working integration.
    expect(caps.features.timeoff).toBe(false);
  });

  it("hides Expenses and Interests when Wallet is not connected", async () => {
    const caps = await resolveCapabilities(testPrincipal(), probes({}));
    expect(caps.features.expenses).toBe(false);
    expect(caps.features.interests).toBe(false);
  });
```
The file's existing first case calls `probes({ wallet: true })`; change it to `probes({ wallet: "connected" })` and keep its assertions.

In `src/platform/capabilities/navigation.test.ts`, replace the module-level `probes` object the same way:
```ts
const probes = {
  connectionStates: async (_userId: string) => ({
    wallet: "not_configured" as const,
    trek: "not_configured" as const,
  }),
  payrollConfigured: () => true,
  hasAccounts: async (_userId: string) => false,
  hasPayrollRecords: async (_userId: string) => false,
};
```
and add:
```ts
  it("gives Settings its areas, Administration only for a principal with admin.users", async () => {
    const owner = buildNavigation(await resolveCapabilities(testPrincipal(), probes));
    const settings = owner.find((i) => i.href === "/settings")!;
    expect(settings.children?.map((c) => c.href)).toEqual([
      "/settings/personal",
      "/settings/security",
      "/settings/account",
      "/settings/integrations",
      "/settings/admin",
    ]);
    const member = buildNavigation(await resolveCapabilities(testPrincipal({ roles: ["member"] }), probes));
    expect(member.find((i) => i.href === "/settings")!.children).not.toContainEqual({
      href: "/settings/admin",
      label: "Administration",
    });
  });
```
(`owner` holds every permission, `member` does not hold `admin.users` — see `ROLE_PERMISSIONS` in `src/platform/auth/permissions.ts`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- capabilities`
Expected: FAIL — the probe object no longer type-checks and Settings has no children.

- [ ] **Step 3: Change the resolver**

In `src/platform/capabilities/resolve.ts`, replace `CapabilityProbes` with the interface above (importing `ProviderCode` from `@/platform/integrations/types`), and the body of `resolveCapabilities`:
```ts
export async function resolveCapabilities(principal: Principal, probes: CapabilityProbes): Promise<Capabilities> {
  const [states, hasAccounts, hasPayrollRecords] = await Promise.all([
    probes.connectionStates(principal.userId),
    probes.hasAccounts(principal.userId),
    probes.hasPayrollRecords(principal.userId),
  ]);
  const wallet = states.wallet;
  const trek = states.trek;
  const payroll: IntegrationState = probes.payrollConfigured() ? "connected" : "not_configured";
  return {
    features: {
      accounts: true,
      funds: true,
      budgets: true,
      expenses: wallet === "connected",
      interests: wallet === "connected",
      payroll: payroll === "connected",
      timeoff: payroll === "connected" || trek === "connected",
    },
    integrations: { wallet, trek, payroll },
    permissions: principal.permissions,
    data: { hasAccounts, hasPayrollRecords },
  };
}
```
Update the module's doc comment: `integrations` now reports the state of a stored connection rather than the presence of a mounted file, which is why "wired up" and "configured" have stopped being the same question.

- [ ] **Step 4: Change the probes**

In `src/platform/capabilities/probes.ts`, drop the `node:fs` and `trekConfig` imports and add:
```ts
/** `disabled` reads as `disconnected` to the UI: both mean "nothing will sync". */
export function stateForStatus(status: ConnectionStatus | null): IntegrationState {
  if (status === null) return "not_configured";
  if (status === "connected") return "connected";
  if (status === "error") return "error";
  return "disconnected";
}

export function connectionProbes(client: DbClient): Pick<CapabilityProbes, "connectionStates"> {
  return {
    connectionStates: (userId) =>
      withUserContext(client, { userId }, async (tx) => {
        const rows = await tx
          .select({ provider: integrationConnections.provider, status: integrationConnections.status })
          .from(integrationConnections)
          .where(eq(integrationConnections.userId, userId));
        const byProvider = new Map(rows.map((r) => [r.provider, r.status as ConnectionStatus]));
        return {
          wallet: stateForStatus(byProvider.get("wallet") ?? null),
          trek: stateForStatus(byProvider.get("trek") ?? null),
        };
      }),
  };
}
```
and `realProbes` becomes:
```ts
export const realProbes: CapabilityProbes = {
  // Replaced by the document-store probe in Phase 4.
  payrollConfigured: () => Boolean(env().PAPERLESS_URL),
  ...connectionProbes(db),
  ...dataProbes(db),
};
```
Extend `probes.itest.ts` with a case that inserts a `connected` wallet connection for one user and asserts the other user still sees `not_configured`.

- [ ] **Step 5: Add the Settings children and fix the links**

In `src/platform/capabilities/navigation.ts`, before the `items.push` for Settings:
```ts
  const settings: NavChild[] = [
    { href: "/settings/personal", label: "Personal" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/account", label: "Account" },
    { href: "/settings/integrations", label: "Integrations" },
  ];
  // Administration is the one area whose absence is correct rather than
  // discouraging: a member has nothing to do there.
  if (c.permissions.has("admin.users")) settings.push({ href: "/settings/admin", label: "Administration" });
  items.push({ href: "/settings", label: "Settings", iconKey: "settings", children: settings });
```
In `src/modules/home/cards.ts`, change the `accounts_sync` card's `href` to `/settings/integrations` and update the expectation in `cards.test.ts`.
In `src/app/(app)/finance/expenses/page.tsx` and `interests/page.tsx`, replace the empty state with one that says what is missing and where to fix it:
```tsx
      <div className="max-w-xl pt-6">
        <EmptyState
          title="Connect Budget Makers Wallet"
          description="Expenses are read from your Wallet transactions. Connect the integration and the first sync will fill this page."
          action={
            <Link
              href="/settings/integrations/wallet"
              className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Go to Integrations
            </Link>
          }
        />
      </div>
```
(the Interests page uses "Interest is accrued from a Wallet account's daily balance." as its description). Both pages remain unreachable from the navigation until Wallet is connected; the empty state is what a bookmarked URL shows.

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build`
Expected: PASS apart from the known OpenAPI drift failure.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(capabilities): resolve integration state from stored connections"
```

---
### Task 17: Split Settings into Personal, Security, Account and Administration

**Files:**
- Modify: `dashboard-app/src/app/(app)/settings/page.tsx` (becomes a redirect), delete `loading.tsx`
- Create: `dashboard-app/src/app/(app)/settings/personal/page.tsx`, `loading.tsx`
- Create: `dashboard-app/src/app/(app)/settings/security/page.tsx`
- Create: `dashboard-app/src/app/(app)/settings/account/page.tsx`
- Create: `dashboard-app/src/app/(app)/settings/admin/page.tsx`, `loading.tsx`
- Create: `dashboard-app/src/app/(app)/settings/_lib/load-settings.ts`, `load-settings.test.ts`
- Modify: `dashboard-app/src/app/(app)/finance/vacation/page.tsx` ("Set it up" → `/settings/personal`)
- Modify: `dashboard-app/src/app/(app)/settings/_components/SettingsForms.tsx` (unchanged exports; only its importers move)

**Interfaces:**
- Consumes: `requirePrincipalOrRedirect`, `assertPermission`, `db`, `recentRuns`/`lastSuccess` from `@/lib/repo/jobs`, `listFunds`, the vacation repo, `llmConfigStatus`, `SettingsSection`, `PageGrid`/`Panel`, `PageHeader`, `EmptyState`, `StaleBadge`, `ThemeToggle`.
- Produces:
```ts
// src/app/(app)/settings/_lib/load-settings.ts
export interface ProfileView {
  displayName: string; email: string | null; locale: string; timezone: string; currency: string;
  organizationName: string; roles: RoleCode[];
}
export function loadProfile(db: DbClient, principal: Principal): Promise<ProfileView>;

export interface AdminUserView {
  id: string; displayName: string; email: string | null; status: string; roles: string[]; createdAt: Date;
}
/** Read-only users list for the Administration area; asserts `admin.users`. */
export function loadUsers(db: DbClient, principal: Principal): Promise<AdminUserView[]>;

export interface SessionView { userAgent: string; ip: string | null; current: true }
export function describeCurrentSession(headers: Headers): SessionView;
```
Page map, matching spec §4 exactly:

| Route | Contents |
|---|---|
| `/settings` | `redirect("/settings/personal")` |
| `/settings/personal` | profile (read-only), theme, leave hours per day, Vacation fund setup |
| `/settings/security` | the current session, and what is not yet possible |
| `/settings/account` | organization, roles, permission list, data-export/deletion notice |
| `/settings/integrations` | Task 18 |
| `/settings/admin` | read-only users list, scheduled jobs, recent runs, Payslip AI |

- [ ] **Step 1: Write the failing loader test**

`src/app/(app)/settings/_lib/load-settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { describeCurrentSession, loadUsers } from "./load-settings";

describe("describeCurrentSession", () => {
  it("reads the user agent and the forwarded ip", () => {
    const session = describeCurrentSession(
      new Headers({ "user-agent": "Mozilla/5.0 Firefox/141.0", "x-forwarded-for": "10.0.0.4, 10.0.0.1" }),
    );
    expect(session).toEqual({ userAgent: "Mozilla/5.0 Firefox/141.0", ip: "10.0.0.4", current: true });
  });

  it("falls back to a readable placeholder when the headers say nothing", () => {
    expect(describeCurrentSession(new Headers())).toEqual({
      userAgent: "Unknown device",
      ip: null,
      current: true,
    });
  });
});

describe("loadUsers", () => {
  it("refuses a principal without admin.users before touching the database", async () => {
    await expect(loadUsers({} as never, testPrincipal({ roles: ["member"] }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- load-settings`
Expected: FAIL — `Cannot find module './load-settings'`.

- [ ] **Step 3: Write the loader**

`src/app/(app)/settings/_lib/load-settings.ts`:
```ts
import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { organizations, userRoles, users } from "@/lib/db/schema";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { RoleCode } from "@/platform/auth/permissions";

export interface ProfileView {
  displayName: string;
  email: string | null;
  locale: string;
  timezone: string;
  currency: string;
  organizationName: string;
  roles: RoleCode[];
}

export async function loadProfile(db: DbClient, principal: Principal): Promise<ProfileView> {
  const [row] = await db
    .select({
      displayName: users.displayName,
      email: users.email,
      locale: users.locale,
      timezone: users.timezone,
      currency: users.currency,
      organizationName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, principal.userId))
    .limit(1);
  return {
    displayName: row?.displayName ?? "",
    email: row?.email ?? null,
    locale: row?.locale ?? "en-GB",
    timezone: row?.timezone ?? "Europe/Rome",
    currency: row?.currency ?? "EUR",
    organizationName: row?.organizationName ?? "",
    roles: principal.roles,
  };
}

export interface AdminUserView {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  roles: string[];
  createdAt: Date;
}

/**
 * Read-only, by design: Phase 2 shows who exists, Phase 8 adds invitations,
 * role changes and suspension. The permission check comes first so a member
 * who guesses the URL never reaches a query.
 */
export async function loadUsers(db: DbClient, principal: Principal): Promise<AdminUserView[]> {
  assertPermission(principal, "admin.users");
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      createdAt: users.createdAt,
      roleCode: userRoles.roleCode,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .orderBy(asc(users.createdAt));

  const byId = new Map<string, AdminUserView>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      if (row.roleCode) existing.roles.push(row.roleCode);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
      roles: row.roleCode ? [row.roleCode] : [],
    });
  }
  return [...byId.values()];
}

export interface SessionView {
  userAgent: string;
  ip: string | null;
  current: true;
}

/**
 * The one session this app can describe today. Auth.js still issues JWT
 * sessions, so there is no `sessions` table to list or revoke from — that
 * arrives with database sessions in Phase 8. Reporting the request's own
 * device is honest and useful; inventing a list would not be.
 */
export function describeCurrentSession(headers: Headers): SessionView {
  const forwarded = headers.get("x-forwarded-for");
  return {
    userAgent: headers.get("user-agent") ?? "Unknown device",
    ip: forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null,
    current: true,
  };
}
```

- [ ] **Step 4: Write the four pages**

`src/app/(app)/settings/page.tsx` in full:
```tsx
import { redirect } from "next/navigation";

/** `/settings` is a group, not a page: its first area is the destination. */
export default function SettingsIndexPage() {
  redirect("/settings/personal");
}
```
Delete `src/app/(app)/settings/loading.tsx` and re-create it as `src/app/(app)/settings/personal/loading.tsx` with the skeleton trimmed to the sections Personal actually has (profile list, two narrow forms, the theme control).

`personal/page.tsx` renders `PageHeader title="Personal"` and one `Panel span={6}` holding, in order:
- `SettingsSection title="Profile"` — a definition list of display name, email, locale, timezone, currency from `loadProfile(db, principal)`, with the footnote "Editing your profile arrives with account management in a later release."
- `SettingsSection title="Vacation fund"` — the existing `VacationSetupForm`, moved verbatim from the old page with its `rates()`/`ledger()`/`balance()` loads. Footnote: "The vacation fund becomes a Budget in a later release; the figures carry over."
- `SettingsSection title="Leave"` — `HoursPerDayForm`.
- `SettingsSection title="Theme"` — `ThemeToggle variant="segmented"`.

`security/page.tsx` renders `PageHeader title="Security"` and a `SettingsSection title="Sessions"` listing exactly one row from `describeCurrentSession(await headers())` — device, IP, "Current session" — with the footnote: "This device is the only session this release can see. Listing and revoking every session, two-factor authentication and personal access tokens arrive with database sessions." Import `headers` from `next/headers`.

`account/page.tsx` renders `PageHeader title="Account"` and:
- `SettingsSection title="Organization"` — the organization name and the user id.
- `SettingsSection title="Your roles"` — the role codes, and under them the sorted permission codes from `principal.permissions`.
- `SettingsSection title="Your data"` — an `EmptyState` titled "Export and deletion are not available yet" describing that a full JSON + originals export and account deletion arrive with the security phase.

`admin/page.tsx` starts with:
```tsx
  const principal = await requirePrincipalOrRedirect();
  if (!principal.permissions.has("admin.users")) notFound();
```
(`notFound` from `next/navigation`: a member must not learn the page exists.) It then renders two panels — left `SettingsSection title="Users"` from `loadUsers(db, principal)` (display name, email, status, roles, joined date) plus `SettingsSection title="Payslip AI"` with the existing `LlmForm`; right the two operational sections moved verbatim from the old Settings page, `Scheduled jobs` and `Recent runs`, including their `JOBS`, `JOB_LABEL`, `STATUS_TONE` and `RUN_TIME` constants.

Update `src/app/(app)/finance/vacation/page.tsx`'s "Set it up" link from `/settings` to `/settings/personal`.

- [ ] **Step 5: Run the tests and look at the pages**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS apart from the known OpenAPI drift failure. In `npm run dev`, confirm `/settings` lands on Personal, the sidebar shows the five children under Settings for an owner, and `/settings/admin` 404s for a principal without `admin.users`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): split Settings into Personal, Security, Account and Administration"
```

---

### Task 18: Settings › Integrations

**Files:**
- Create: `dashboard-app/src/modules/integrations/ui/run.ts`
- Create: `dashboard-app/src/modules/integrations/ui/load-integrations.ts`
- Create: `dashboard-app/src/modules/integrations/ui/IntegrationsList.tsx`, `ConnectForm.tsx`, `DisconnectForm.tsx`, `SyncRunsTable.tsx`
- Create: `dashboard-app/src/app/actions/integrations.ts`, `integrations.test.ts`
- Create: `dashboard-app/src/app/(app)/settings/integrations/page.tsx`, `loading.tsx`, `[provider]/page.tsx`

**Interfaces:**
- Consumes: `listIntegrations`, `connectIntegration`, `testIntegrationConnection`, `runSync`, `disconnectIntegration`, `describeDisconnectPolicy`, `DISCONNECT_POLICIES`, `ensureProvidersRegistered`, `ActionResult`/`succeed`/`fail`/`text`/`errorMessage` from `@/app/actions/types`.
- Produces:
```ts
// src/modules/integrations/ui/run.ts — the mirror of the accounts module's run.ts
export function runIntegrationsForPrincipal<T>(
  fn: (deps: IntegrationDeps, principal: Principal) => Promise<T>,
): Promise<T>;
export function setIntegrationDepsFactoryForTests(factory: (() => IntegrationDeps) | null): void;
export function setIntegrationPrincipalForTests(principal: Principal | null): void;

// src/modules/integrations/ui/load-integrations.ts
export function loadIntegrations(): Promise<IntegrationSummary[]>;
export function loadIntegration(provider: string): Promise<IntegrationSummary | null>;

// src/app/actions/integrations.ts — every one returns ActionResult
export function connectIntegrationAction(formData: FormData): Promise<ActionResult<{ status: ConnectionStatus; message: string }>>;
export function testIntegrationAction(formData: FormData): Promise<ActionResult<{ ok: boolean; message: string }>>;
export function syncIntegrationAction(formData: FormData): Promise<ActionResult<{ runId: string; status: SyncRunStatus }>>;
export function disconnectIntegrationAction(formData: FormData): Promise<ActionResult<{ policy: DisconnectPolicy }>>;
```
Form fields: `provider` on all four; `credentials.<fieldName>` on connect (the action rebuilds the object by stripping the `credentials.` prefix); `kind` optional on sync; `policy` on disconnect.

- [ ] **Step 1: Write the failing action test**

`src/app/actions/integrations.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import {
  MemoryConnectionsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "@/modules/integrations/infrastructure/memory-repositories";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import {
  setIntegrationDepsFactoryForTests,
  setIntegrationPrincipalForTests,
} from "@/modules/integrations/ui/run";
import { connectIntegrationAction, disconnectIntegrationAction, syncIntegrationAction } from "./integrations";

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async (credentials) =>
      credentials.token === "good" ? { ok: true, message: "Reached." } : { ok: false, message: "Refused." },
    syncs: { accounts: async () => ({ created: 2 }) },
    onDisconnect: async () => {},
  };
}

let deps: IntegrationDeps;

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("integration server actions", () => {
  beforeEach(() => {
    const registry: ProviderRegistry = {
      get: (code) => (code === "wallet" ? provider() : null),
      list: () => [provider()],
    };
    deps = {
      connections: new MemoryConnectionsRepository(),
      runs: new MemorySyncRunsRepository(),
      deliveries: new MemoryWebhookDeliveriesRepository(),
      cipher: memoryCipher(),
      registry,
      db: {} as never,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async () => {},
    };
    setIntegrationDepsFactoryForTests(() => deps);
    setIntegrationPrincipalForTests(testPrincipal());
  });

  afterEach(() => {
    setIntegrationDepsFactoryForTests(null);
    setIntegrationPrincipalForTests(null);
  });

  it("connects from a form and reports the test outcome", async () => {
    const result = await connectIntegrationAction(
      form({ provider: "wallet", "credentials.token": "good" }),
    );
    expect(result).toEqual({ ok: true, data: { status: "connected", message: "Reached." } });
  });

  it("reports a rejected credential without failing the action", async () => {
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "bad" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.status).toBe("error");
  });

  it("refuses an empty credential with a readable message", async () => {
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "" }));
    expect(result).toEqual({ ok: false, error: "Check the fields and try again." });
  });

  it("syncs and disconnects", async () => {
    await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "good" }));
    const synced = await syncIntegrationAction(form({ provider: "wallet" }));
    expect(synced.ok && synced.data.status).toBe("success");
    const disconnected = await disconnectIntegrationAction(form({ provider: "wallet", policy: "archive" }));
    expect(disconnected).toEqual({ ok: true, data: { policy: "archive" } });
  });

  it("tells a viewer they may not change integrations", async () => {
    setIntegrationPrincipalForTests(testPrincipal({ roles: ["viewer"] }));
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "good" }));
    expect(result).toEqual({ ok: false, error: "You do not have permission to change integrations." });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- actions/integrations`
Expected: FAIL — `Cannot find module '@/modules/integrations/ui/run'`.

- [ ] **Step 3: Write the run helper and the loaders**

`src/modules/integrations/ui/run.ts` is `src/modules/accounts/ui/run.ts` with the integrations deps substituted — the same two `NODE_ENV === "test"` seams, the same dynamic `import("@/platform/auth/require-principal")`, and `ensureProvidersRegistered()` called before building the deps so a server component sees a populated registry:
```ts
export async function runIntegrationsForPrincipal<T>(
  fn: (deps: IntegrationDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  ensureProvidersRegistered();
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(integrationDeps(tx), principal));
}
```
`src/modules/integrations/ui/load-integrations.ts`:
```ts
export function loadIntegrations(): Promise<IntegrationSummary[]> {
  return runIntegrationsForPrincipal((deps, principal) => listIntegrations(deps)(principal));
}

export async function loadIntegration(provider: string): Promise<IntegrationSummary | null> {
  const all = await loadIntegrations();
  return all.find((i) => i.provider === provider) ?? null;
}
```

- [ ] **Step 4: Write the actions**

`src/app/actions/integrations.ts` opens with `"use server";` and follows `src/app/actions/accounts.ts`'s structure — a `mapError` and a `revalidateIntegrations()` that revalidates `/`, `/settings/integrations`, `/settings/integrations/${provider}`, `/finance`, `/finance/accounts` (a sync changes balances, and connecting changes the navigation):
```ts
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change integrations.";
  if (err instanceof UnknownProviderError) return "That integration does not exist.";
  if (err instanceof ConnectionNotFoundError) return "This integration is not connected yet.";
  if (err instanceof ConnectionNotUsableError) return err.message;
  if (err instanceof CredentialValidationError) return err.message;
  return errorMessage(err);
}

/** Form fields arrive as `credentials.<name>`; the prefix is stripped back off here. */
function credentialsFrom(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("credentials.") && typeof value === "string") {
      out[key.slice("credentials.".length)] = value.trim();
    }
  }
  return out;
}
```
`connectIntegrationAction` returns `succeed({ status: connection.status, message: test.message })` — a failed *test* is a successful action carrying bad news, which is what lets the form show the provider's own message without discarding what was typed. `syncIntegrationAction` returns `succeed({ runId: run.id, status: run.status })` and, when `run.status === "failed"`, `fail(run.error ?? "The sync failed.")`.

- [ ] **Step 5: Write the pages and components**

`settings/integrations/page.tsx`: `PageHeader title="Integrations"`, then `<IntegrationsList items={await loadIntegrations()} />`. Each row is a link to `/settings/integrations/{provider}` showing the label, a status chip (`Connected` positive / `Error` negative / `Not connected` muted / `Disabled` muted), the capability list, and `StaleBadge capturedAt={connection?.lastSyncAt ?? null} stale={connection === null}`. With no connection at all the page still lists both providers — there is no empty state, because the list *is* the call to action.

`settings/integrations/[provider]/page.tsx`: `notFound()` when `loadIntegration(params.provider)` returns null. Then:
- a status block: status, last test, last sync, `lastError` if any;
- `<ConnectForm provider={summary.provider} fields={summary.credentialFields} connected={summary.connection !== null} />` — a client component rendering one input per field (`type="password"` when `field.secret`), always **empty** on render (a stored secret is never sent to the browser), with the submit label "Connect" or "Replace credentials";
- Test and Sync buttons wired to `testIntegrationAction` / `syncIntegrationAction` through `useTransition`, showing the returned message in a `Toast`;
- `<DisconnectForm provider={...} current={summary.connection.disconnectPolicy} />` — a `<select>` over `DISCONNECT_POLICIES` whose helper text is `describeDisconnectPolicy(policy)` for the selected value, and a confirm step before submitting, since `purge` deletes accounts;
- `<SyncRunsTable runs={summary.recentRuns} />` — started, kind, trigger, status, duration, and the stats rendered as `key: value` pairs, or an `EmptyState` "No syncs yet" when the list is empty.

All four components are `"use client"` and use the existing `ErrorInline`, `Toast` and field classes from `settings/_components/SettingsForms.tsx`.

- [ ] **Step 6: Run the tests and use the page**

Run: `npm run typecheck && npm test -- actions/integrations && npm run build`
Expected: PASS. In `npm run dev`: connect Wallet with a real token, see the status turn Connected, press Sync now, see a run appear in the table, and confirm Expenses and Interests have appeared in the Finance navigation.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): Integrations area with connect, test, sync and disconnect"
```

---

### Task 19: Documentation, environment and deployment

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/api/README.md`; regenerate `docs/api/openapi.json`
- Create: `docs/integrations/README.md`
- Create: `docs/deploy/phase-2-runbook.md`
- Modify: `.env.example`, `docker-compose.yml`
- Modify: `dashboard-app/src/lib/env.ts` (remove the retired variables)
- Create: `dashboard-app/tests/e2e/settings.spec.ts`

- [ ] **Step 1: Retire the token-file environment**

Now that Task 13's import exists and Tasks 11–12 removed every reader, delete from `src/lib/env.ts`: `WALLET_TOKEN_FILE`, `TREK_TOKEN_FILE`, `walletToken()` and `trekConfig()`. Keep `WALLET_API_URL` (the base URL is configuration, not a credential) and keep `export interface TrekConfig` (the adapter builds one). Remove `TREK_URL` too — the Trek base URL is now part of the connection's credentials.
In `docker-compose.yml`, remove the `WALLET_TOKEN_FILE`, `TREK_URL` and `TREK_TOKEN_FILE` environment entries and both `./secrets/*-token` volume mounts, and add:
```yaml
      - APP_ENCRYPTION_KEY=${DASHBOARD_APP_ENCRYPTION_KEY}
```
In `.env.example`, delete the Trek token-file paragraph and add:
```
# Credential encryption for stored integration credentials (AES-256-GCM).
# Format: keyId:base64key[,keyId:base64key] — the FIRST entry is the active key,
# later entries exist only to decrypt credentials sealed before a rotation.
# Each key must be exactly 32 bytes once base64-decoded:
#   printf 'k1:%s' "$(openssl rand -base64 32)"
# Rotating: put the NEW key first, keep the old one, redeploy, then reconnect
# each integration from Settings > Integrations to re-seal under the new key,
# and only then drop the old entry.
DASHBOARD_APP_ENCRYPTION_KEY=
```
Note in the same file that the Wallet and Trek tokens are no longer files: they are entered in Settings › Integrations and stored encrypted.

- [ ] **Step 2: Regenerate the API document**

Run: `npm run openapi:generate && npm test -- openapi-drift`
Expected: `docs/api/openapi.json` rewritten with the six integration routes plus the webhook, and the drift test PASSES — clearing the known failure carried since Task 14.

- [ ] **Step 3: Write `docs/integrations/README.md`**

Sections, in order:
1. **What an integration is** — the `IntegrationProvider` contract, quoting the interface from `src/platform/integrations/types.ts`, and the rule that provider field names live only in `*-adapter.ts`.
2. **Credential storage** — the `APP_ENCRYPTION_KEY` format and the blob layout from Task 4, verbatim; that credentials live in `integration_connections.credentials_ciphertext` with `key_id`; that they are never returned by the API, never logged and never audited by value.
3. **Key rotation** — new key first, redeploy, reconnect each integration, drop the old entry. State that Phase 2 has no bulk re-seal job, so a key cannot be dropped until every connection has been reconnected.
4. **Connection lifecycle** — connect / test / sync / disconnect, the status machine (`disconnected → connected|error`, `disabled` is manual), and the three disconnect policies with the exact sentences `describeDisconnectPolicy` returns.
5. **Sync runs** — `sync_runs` columns, the four statuses, that a manual trigger joins a run already in flight, and where they surface (Settings › Integrations, `GET /api/v1/integrations/{provider}/sync-runs`).
6. **Inbound webhooks** — `POST /api/v1/webhooks/{provider}`, `X-Signature: sha256=<hex>` over the raw body under the connection's `webhookSecret`, 404 on any failure, one `webhook_deliveries` row either way, and a worked `curl` + `openssl dgst -sha256 -hmac` example.
7. **Adding a provider** — write `<name>-adapter.ts`, register it in `register-all.ts`, add its code to `ProviderCode` and to the `integration_providers` seed in a new migration.

- [ ] **Step 4: Update the architecture and API docs**

In `docs/architecture/overview.md`:
- add `platform/integrations/` and `modules/integrations/` to the module-layout block;
- add a "Integration framework" section pointing at `docs/integrations/README.md` and naming the sync engine as the single place a run is recorded;
- rewrite the "Capability-driven navigation" paragraph: `walletConfigured`/`trekConfigured` are gone and `connectionStates` reads `integration_connections`;
- **delete both entries under "Known deviations"** — RLS now covers `audit_events`, `idempotency_keys` and `rate_limit_windows` (Task 3), and the owner-only Wallet sync is gone (Task 14) because a connection has an owner of its own;
- move `integration_connections with encrypted, UI-managed credentials` out of "What's deferred to later phases" and add a new deferred entry: per-user sync schedules (the `sync_jobs` rows exist but the cron tiers still dispatch for the owner only).

In `docs/api/README.md`:
- add the six integration routes and the webhook to the endpoint table;
- add an **Integrations** section covering the write-only `credentials` object, that `POST /integrations/{provider}/sync` answers `{ run }` and is idempotent per running job, and that `POST /webhooks/{provider}` is the one unauthenticated route (HMAC instead of a session, so no `X-Requested-With`);
- add a **Breaking changes in Phase 2** note: `POST /api/v1/integrations/wallet/sync` keeps its path but now returns `{ run: SyncRun }` — the Phase-1 counts are under `run.stats` — and no longer requires the `owner` role, only `integrations.manage`.

- [ ] **Step 5: Write the deployment runbook**

`docs/deploy/phase-2-runbook.md`, in order, with the exact commands:
1. Pre-checks: `docker exec postgres pg_dump -U dashboard dashboard > .work/backups/pre-phase2-$(date +%F-%H%M).sql`; keep the current image as `dashboard:pre-phase2`.
2. Generate the key: `printf 'k1:%s' "$(openssl rand -base64 32)"` → `DASHBOARD_APP_ENCRYPTION_KEY` in `.env`. **Back this value up**: without it every stored credential is unrecoverable.
3. Deploy the new image with the token-file volumes **still mounted** and `APP_ENCRYPTION_KEY` set. Migrations `0008`–`0010` apply on boot.
4. Import the credentials: `docker exec dashboard-app node /app/import-file-credentials.mjs` (the bundled build of `scripts/import-file-credentials.ts`), expecting `{"imported":["wallet","trek"],"skipped":[]}`.
5. Verify in the UI: Settings › Integrations shows both as Connected; press Test on each; press Sync now on Wallet and confirm a `success` run whose stats match a normal daily sync.
6. Remove the token files: drop the two volume mounts and `WALLET_TOKEN_FILE`/`TREK_URL`/`TREK_TOKEN_FILE` from `docker-compose.yml`, `docker compose up -d --force-recreate dashboard-app`, and confirm the next hourly tick still syncs.
7. Verify the tick: `curl -H "X-Cron-Secret: $DASHBOARD_CRON_SECRET" -X POST http://dashboard-app:3000/api/jobs/tick?tier=daily` from inside the network, expecting `wallet_accounts_sync: success`.
8. Rollback: redeploy `dashboard:pre-phase2` with the volume mounts restored. Migrations 0008–0010 are additive — the old image ignores the new tables — **except** that the old image reads the token files, so they must not be deleted until step 6 has been verified for a full day.

- [ ] **Step 6: Write the e2e spec**

`tests/e2e/settings.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("the Settings areas and the webhook endpoint are gated", async ({ page, request }) => {
  for (const path of ["/settings", "/settings/personal", "/settings/security", "/settings/integrations"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  }
  // Signed out, the API refuses; the webhook is public but unsigned, so 404.
  expect((await request.get("/api/v1/integrations")).status()).toBe(401);
  expect((await request.post("/api/v1/webhooks/wallet", { data: { event: "x" } })).status()).toBe(404);
});
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build && npm run e2e`
Expected: PASS. Then `graphify update .` from the repo root.

- [ ] **Step 8: Commit**

```bash
git add -A . ../docs ../docker-compose.yml ../.env.example
git commit -m "docs: integration framework guide, Phase 2 runbook and env changes"
```

---

### Task 20: Exit criteria

**Files:**
- Modify: `docs/superpowers/handoff/` — create `2026-09-04-phase-2-checkpoint.md` and `2026-09-04-phase-2-ledger.md` if the executing process has not already been keeping them.

Spec §11 Phase 2 exit: *"integrations toggled from the UI; Expenses/Interests nav appears only when Wallet is connected (empty states ready)."*

- [ ] **Step 1: Run the full gate**

From `dashboard-app/`, in this order, and record each result:
```bash
npm run typecheck
npm test
npm run test:db:up && npm run test:integration
npm run build
npm run e2e
```
Expected: all five green. `npm test` must include the OpenAPI drift test passing — if it fails, `npm run openapi:generate` was not re-run after a route change.

- [ ] **Step 2: Walk the exit criteria by hand**

In `npm run dev`, signed in as the owner:
1. Settings › Integrations lists Wallet and Trek. Both start Not connected on a fresh database.
2. Finance navigation has no Expenses and no Interests entry.
3. Connect Wallet with a valid token → status Connected, `lastTestAt` set.
4. Reload: Finance navigation now shows Expenses and Interests; both open a setup empty state linking back to `/settings/integrations/wallet`.
5. Sync now → a `success` run appears in the runs table with non-empty stats, and `/finance/accounts` reflects it.
6. Test with a deliberately wrong token → status Error with the provider's message; the navigation loses Expenses and Interests on the next reload.
7. Reconnect, then Disconnect with policy `keep` → status Not connected, credential gone (`select credentials_ciphertext from integration_connections` is null), accounts and balances untouched.
8. Connect Trek; the Work page's leave sync still runs against the stored credential.
9. Sign in as a non-admin principal: `/settings/admin` 404s and the Administration nav entry is absent.

- [ ] **Step 3: Confirm nothing reads a token file**

Run: `grep -rn "WALLET_TOKEN_FILE\|TREK_TOKEN_FILE\|walletToken\|trekConfig(" dashboard-app/src dashboard-app/scripts docker-compose.yml`
Expected: no matches outside `scripts/import-file-credentials.ts`, which reads the two paths from `process.env` for the one-off migration.

- [ ] **Step 4: Record the checkpoint**

Write `docs/superpowers/handoff/2026-09-04-phase-2-checkpoint.md` in the shape of the Phase 0/1 checkpoint: state (branch, commit range, verification results), documents, decisions taken (the rulings below plus any made during execution), what is deferred, and how to start Phase 3.

- [ ] **Step 5: Commit**

```bash
git add -A ../docs
git commit -m "docs(handoff): Phase 2 checkpoint and exit criteria"
```

---

## Rulings

Spec §13's open questions do not block Phase 2. Where the spec states a default, it is adopted as written; the decisions this plan had to make on its own are listed with it.

- **Ruling P2-1: adopt spec §13.2's default — the dashboard only *analyses* interest in Phase 3, and posting to the provider stays behind a per-rule switch.** Phase 2 therefore declares `interest_posting` in the Wallet adapter's `capabilities` but ships no posting sync, and the `wallet-manager` container keeps running untouched — why: the spec names this as the default and Phase 2 has no interest rules to post from; cost if wrong: the capability string is declared a phase early, which is metadata only.
- **Ruling P2-2: adopt spec §13.4's default — all non-archived Wallet accounts count toward net worth, with the per-account toggle Phase 1 already ships.** Disconnecting does not change any account's `include_in_net_worth` — why: it is the spec's stated default and Phase 1 implemented it; cost if wrong: a per-connection default would have to be added later, a settings field and one migration.
- **Ruling P2-3: `APP_ENCRYPTION_KEY` is a list of `keyId:base64key` entries, active key first, and the sealed blob is `0x01 || iv(12) || tag(16) || ciphertext` with the key id as AEAD associated data.** The spec says only "32-byte, env, rotation supported via `key_id`" — why: a bare 32-byte value cannot express the retired keys that rotation needs, and authenticating the key id stops a blob being replayed under another key; cost if wrong: a different format would need a re-seal script, which is exactly the operation reconnecting each integration already performs.
- **Ruling P2-4: `sync_jobs.schedule` holds a dispatch tier (`hourly|daily|monthly`), not a cron expression.** Spec §5.2 says "schedule cron" — why: §3.4 replaced per-job cron with three tiered ticks, so a cron string would be a value nothing reads; cost if wrong: one migration widening the column and a parser, with no data loss.
- **Ruling P2-5: the inbound webhook is `POST /api/v1/webhooks/{provider}` and the receiving connection is found by trying each connected connection's own `webhookSecret`.** The path carries no connection id — why: spec §3.4 fixes the path shape at the provider level, and a per-connection secret is stronger than one deployment-wide secret; cost if wrong: with many users per provider the verification cost grows linearly, fixed later by putting a connection id in the path.
- **Ruling P2-6: a failed connection *test* does not abort a connect — the credential is stored and the connection lands in `error` with the provider's message.** Why: the common failure is a typo the person is about to fix, and discarding what they typed means retyping a secret; cost if wrong: a wrong credential sits encrypted in the database until it is replaced, unusable because `isUsable` refuses anything but `connected`.
- **Ruling P2-7: Rulings R10 and R18 (owner-only Wallet sync) are retired in Task 14.** Why: they existed only because one file-mounted token had no owner; a connection has a `user_id`, so `integrations.manage` on one's own connection is the whole check; cost if wrong: a member could sync their own connection, which is the intended behaviour.
- **Ruling P2-8: Settings › Security lists the current request's session only, and says so.** Why: Auth.js still issues JWT sessions and spec §8.1 moves them to the database in Phase 8, so there is no session table to list; cost if wrong: the page gains rows rather than changing shape when Phase 8 lands.
- **Ruling P2-9: the operational sections (scheduled jobs, recent runs) and the Payslip AI form move to Settings › Administration, gated on `admin.users`.** Why: spec §4 gives Administration to role admin/owner and these are deployment-wide operational controls, not personal preferences; cost if wrong: a member loses sight of the job log, which the Home freshness badges already summarise.
- **Ruling P2-10: the Vacation fund setup form moves to Settings › Personal until Phase 6 replaces it with a Budget.** Why: it is a per-user money preference and has no other home once Settings splits; cost if wrong: one link moves again in Phase 6, which is already planned.
- **Ruling P2-11: Trek's `onDisconnect` never deletes leave data under any policy.** Why: `leave_days` is written by the dashboard as much as by the sync, so it is the user's own record rather than the provider's; cost if wrong: a user wanting a clean slate deletes days by hand until Phase 7 models `timeoff_events` properly.

## Self-review against the Phase 2 scope

1. `integration_connections` + supporting tables, migration numbering → **Task 5** (tables, RLS, provider seed; migrations `0008`/`0009` are the two deferred minors, `0010` is the integration schema).
2. Encrypted credential storage with a documented key format → **Task 4**; the one-time import of the mounted Wallet and Trek tokens → **Task 13** (use case + `scripts/import-file-credentials.ts`), executed in **Task 19**'s runbook step 4.
3. Connection lifecycle — connect, test, manual sync trigger, disconnect with the spec's policies → **Task 9** (connect/test/disconnect/list) and **Task 10** (the trigger); the policies are applied by each adapter's `onDisconnect` (**Tasks 11, 12**).
4. Sync runs recorded with status/started/finished/error and surfaced in the UI → **Task 5** (table), **Task 10** (engine), **Task 14** (`GET .../sync-runs`), **Task 18** (`SyncRunsTable`).
5. Inbound webhook with signature verification → **Task 15**, on the shared helper from **Task 6**.
6. Wallet and Trek ported onto the framework, existing behaviour and tests green → **Task 11** and **Task 12**.
7. Settings split into Personal / Security / Account / Integrations / Administration → **Task 17** (four areas + nav children from **Task 16**) and **Task 18** (Integrations).
8. Expenses and Interests nav only when Wallet is connected, empty states ready → **Task 16**.
9. Deferred minors: Wallet fetched outside the user transaction → **Task 2**; `provider_links` unique key gains `user_id` → **Task 1**; RLS on `audit_events`/`idempotency_keys`/`rate_limit_windows` (R19) → **Task 3**.
10. Docs — architecture, API + regenerated `openapi.json`, integrations guide, env changes in the deployment doc and `.env.example` → **Task 19**.
11. Exit criteria as a verification task → **Task 20**.

Names used consistently across tasks: `ProviderCode`, `SyncKind`, `SyncTrigger`, `SyncRunStatus`, `ConnectionStatus`, `DisconnectPolicy`, `IntegrationConnection`, `SyncRun`, `TestResult`, `CredentialField`, `SyncContext`, `DisconnectContext`, `IntegrationProvider`, `ProviderRegistry`, `SealedCredential`, `CredentialCipher`, `IntegrationDeps`, `ConnectionsRepository`, `SyncRunsRepository`, `WebhookDeliveriesRepository`, `connectIntegration`, `testIntegrationConnection`, `disconnectIntegration`, `listIntegrations`, `runSync`, `runSyncForUser`, `handleWebhook`, `importFileCredentials`, `integrationDeps`, `runIntegrationsForPrincipal`, `ensureProvidersRegistered`, `providerRegistry`, `verifyHmacSignature`, `credentialCipher`, `ownerUserId`, `connectionProbes`, `stateForStatus`.

Deferred by design to later phases: transactions, categories and interest rules (Phase 3); the document store and payroll uploads (Phase 4); per-user sync schedules dispatched from `sync_jobs` rather than the owner-only tiers; outbound webhook endpoints and deliveries (Phase 9, reusing `webhook_deliveries.direction`); database sessions, MFA, personal access tokens and user administration beyond a read-only list (Phase 8); a bulk credential re-seal job for key rotation (reconnecting each integration is the Phase 2 procedure).

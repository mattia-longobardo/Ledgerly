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
- **Every integration use case receives `IntegrationDeps` bound to the connection pool and opens its own transactions through `deps.inUserContext(userId, fn)` / `deps.inSystemContext(fn)`.** A route, action or job therefore does *not* wrap a call to `connectIntegration`, `runSync`, `handleWebhook` or any of their siblings in `withUserContext`. This is what keeps Task 2's rule true everywhere: **no provider round trip ever happens inside an open database transaction** — a connection test, a Wallet `GET /accounts` or a Trek MCP conversation runs between two short transactions, never inside one.
- **Provider names appear only in `*-adapter.ts`.** `wallet-provider-adapter.ts` and `trek-provider-adapter.ts` are the only new files allowed to name Budget Makers Wallet or Trek fields. The framework, the use cases and the repositories speak `ProviderCode` and `SyncKind` only.
- Use cases take a `Principal` and assert a permission; RLS is the second wall. New tables carry `user_id` (directly or through their connection) and `FORCE ROW LEVEL SECURITY` with policies of the shape `app_is_system() OR user_id = app_current_user_id()`.
- New tables use `uuid` primary keys defaulting to `uuidv7()` and carry `created_at`/`updated_at` timestamptz. `integration_connections` carries `version integer not null default 1`; user-facing updates require the expected version and answer `version_mismatch` on conflict.
- **Secrets never leave the server.** A credential is never echoed back by an API response, never rendered into HTML, never logged, and never put in an audit `before`/`after` payload. Audit records the *fact* of a credential write, not its content (spec §3.2: "credentials metadata").
- Never invent financial data: a missing source renders an empty or setup state, never a zero.
- Migrations are generated with `npx drizzle-kit generate --name <name>` from `dashboard-app/`; RLS statements are appended to the generated file by hand, one per `--> statement-breakpoint`, exactly as `drizzle/0006_accounts.sql` does. **The next migration number is `0008`**; this plan adds `0008_provider_links_user_key`, `0009_platform_rls` and `0010_integrations`.
- **A hand-written migration must also ship a snapshot.** `drizzle-kit generate` walks `drizzle/meta/_journal.json` and loads `drizzle/meta/<idx>_snapshot.json` for every entry; a journal entry with no snapshot breaks the *next* generate. `0009_platform_rls` changes no table, so drizzle-kit emits nothing for it — Task 3 therefore writes the SQL, the journal entry **and** `drizzle/meta/0009_snapshot.json` (a copy of `0008_snapshot.json` with a fresh `id` and `prevId` set to `0008_snapshot.json`'s `id`).
- **`docs/api/openapi.json` is regenerated in the same task that changes a route** (`npm run openapi:generate`), so the OpenAPI drift test is green at every commit. No task ends on a knowingly-red suite.
- Integration tests get their environment from `dashboard-app/src/test/integration-setup.ts`, wired in as `setupFiles` in `vitest.integration.config.ts` (Task 4). It sets every variable `env()`'s schema requires — `APP_ENCRYPTION_KEY` included — before any module resolves `env()`. Unit tests keep setting what they need inline in a `vi.hoisted` block, as they do today.
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
  src/lib/env.ts                             (modify) add APP_ENCRYPTION_KEY and resetEnvCache(); remove WALLET_TOKEN_FILE, TREK_TOKEN_FILE, TREK_URL, walletToken(), trekConfig()
  src/test/db.ts                             (modify) resetDb keeps the static integration_providers catalogue
  src/test/integration-setup.ts              the integration suite's environment, in one place
  src/test/integration-deps.ts               testIntegrationDeps() + unusedDb — the one IntegrationDeps factory tests use
  vitest.integration.config.ts               (modify) setupFiles: ["./src/test/integration-setup.ts"]

  src/platform/clock.ts                      the shared `Clock` interface
  src/platform/auth/owner.ts                 ownerUserId(db) — the single owner a job acts for
  src/platform/db/context.ts                 (modify) UserContext.role gains "admin"
  src/platform/http/app.ts                   (modify) public path prefixes skip auth/CSRF/rate limit; register integration routes
  src/platform/http/rate-limit.ts            (modify) counts inside withUserContext so its RLS policy applies
  src/platform/http/idempotency.ts           (modify) reads and writes inside withUserContext
  src/platform/integrations/types.ts         ProviderCode, IntegrationProvider, SyncHandler, SyncFetchContext, SyncApplyContext, SyncRun, ...
  src/platform/integrations/crypto.ts        parseEncryptionKeys, createCredentialCipher, credentialCipher
  src/platform/integrations/registry.ts      registerProvider, providerRegistry, resetProviderRegistry
  src/platform/integrations/register-all.ts  ensureProvidersRegistered — wires the two adapters
  src/platform/integrations/webhook-signature.ts  verifyHmacSignature, hmacSignatureVerifier, webhookEventName (shared, provider-neutral)
  src/platform/capabilities/resolve.ts       (modify) probes report connection states
  src/platform/capabilities/probes.ts        (modify) connectionStates reads integration_connections
  src/platform/capabilities/navigation.ts    (modify) Settings gains its five children

  src/modules/integrations/domain/connection.ts        status transitions and disconnect-policy rules
  src/modules/integrations/application/ports.ts        ConnectionsRepository, SyncJobsRepository, SyncRunsRepository, WebhookDeliveriesRepository
  src/modules/integrations/application/deps.ts         IntegrationDeps (incl. inUserContext / inSystemContext)
  src/modules/integrations/application/errors.ts       ConnectionNotFoundError, UnknownProviderError, CredentialValidationError, ConnectionVersionMismatchError, SyncNotSupportedError, ConnectionNotUsableError, SyncDisabledError
  src/modules/integrations/application/open-connection.ts      openConnection — the one "resolve connection, open credential" helper
  src/modules/integrations/application/connect-integration.ts
  src/modules/integrations/application/test-integration-connection.ts
  src/modules/integrations/application/disconnect-integration.ts
  src/modules/integrations/application/list-integrations.ts
  src/modules/integrations/application/run-sync.ts             the sync engine
  src/modules/integrations/application/enqueue-sync.ts         a queued sync_runs row (the webhook path)
  src/modules/integrations/application/drain-sync-queue.ts     the tick that runs queued rows in their owner's context
  src/modules/integrations/application/handle-webhook.ts
  src/modules/integrations/application/import-file-credentials.ts
  src/modules/integrations/infrastructure/deps.ts               integrationDeps(root, requestId, bound?)
  src/modules/integrations/infrastructure/drizzle-connections-repository.ts
  src/modules/integrations/infrastructure/drizzle-sync-jobs-repository.ts
  src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts
  src/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository.ts
  src/modules/integrations/infrastructure/memory-repositories.ts
  src/modules/integrations/infrastructure/owner-connection.ts   openOwnerConnection(provider) — the jobs' single front door
  src/modules/integrations/infrastructure/wallet-provider-adapter.ts   the only new file naming Wallet fields
  src/modules/integrations/infrastructure/trek-provider-adapter.ts     the only new file naming Trek fields
  src/modules/integrations/api/schemas.ts, api/routes.ts
  src/modules/integrations/ui/run.ts                    runIntegrationsForPrincipal + test seams
  src/modules/integrations/ui/principal-connection.ts   openPrincipalConnection / isProviderConnectedForPrincipal
  src/modules/integrations/ui/load-integrations.ts      the Settings › Integrations loader
  src/modules/integrations/ui/IntegrationsList.tsx, ConnectForm.tsx, DisconnectForm.tsx, SyncRunsTable.tsx

  src/lib/clients/wallet.ts                  (modify) WalletCallOptions.token, required
  src/lib/clients/trek.ts                    (modify) TrekCallOptions.config, required
  src/lib/jobs/wallet-accounts-sync.ts       (modify) runs through the sync engine
  src/lib/jobs/wallet-refresh.ts             (modify) credential from the vault
  src/lib/jobs/trek-sync.ts                  (modify) TrekConfig threaded through RunTrekSyncInput
  src/lib/jobs/trek-sync-job.ts              (modify) runs through the sync engine
  src/lib/jobs/sync-queue.ts                 the hourly job that drains queued sync_runs
  src/lib/contracts.ts                       (modify) JobName gains "sync_queue"
  src/platform/jobs/register-all.ts          (modify) registers the sync_queue job on the hourly tier
  src/modules/accounts/application/sync-provider-accounts.ts  (modify) accepts pre-fetched accounts
  src/modules/accounts/infrastructure/wallet-adapter.ts       (modify) walletAccountsSource(clock, token)
  src/modules/accounts/api/routes.ts         (modify) the Phase-1 wallet sync route is removed
  src/app/actions/accounts.ts                (modify) syncWalletAction is superseded and removed
  src/app/actions/leave.ts                   (modify) resolves the Trek credential from the vault
  src/app/(app)/work/_lib/leave.ts           (modify) `configured` comes from the Trek connection, not a file
  src/modules/accounts/ui/AccountsToolbar.tsx (modify) the Wallet sync control moves to Settings › Integrations
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

The file's own factory is `harness()`, which returns `{ deps, audit }` (`sync-provider-accounts.test.ts:16`), and its user id constant is `USER_ID` (`:14`). `ProviderAccount` is already imported there; add `AccountsSource` to that same `import type { NewAccount, ProviderAccount } from "./ports";` line. Append inside the existing top-level `describe`:
```ts
  it("uses pre-fetched accounts and never calls the source", async () => {
    const { deps } = harness();
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
In `src/app/actions/accounts.ts`, apply the same shape inside `syncWalletAction`: build `walletAccountsSource({ now: () => new Date() })`, `await source.fetchAccounts()` before `runForPrincipal`, and pass the array as the second argument to the use case. (Task 11 later deletes this action outright — it is one of the last two `walletAccountsSource(clock)` call sites — and Task 18's `syncIntegrationAction` replaces it; fixing it here keeps the nine commits in between shippable.)

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

    // Drizzle 0.45 wraps the pg error, so the policy name is on `cause`, never
    // on the outer message (Phase 0/1 ledger, Task 2 note). `rejects.toThrow(
    // /row-level security/)` would fail against a CORRECT implementation.
    const forged = await withUserContext(db, { userId: a!.id }, (tx) =>
      tx.insert(auditEvents).values({ actorUserId: b!.id, action: "forged", entityType: "test" }),
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(forged).toBeInstanceOf(Error);
    expect((forged as { cause?: { message?: string } }).cause?.message ?? "").toMatch(
      /row-level security/,
    );
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
- [ ] **Step 4b: Register the migration AND its snapshot**

`0009` changes no table, so `drizzle-kit generate` emits nothing for it — which means the journal entry and the snapshot both have to be written by hand. Skipping the snapshot is the trap: `drizzle-kit generate` in Task 5 walks `_journal.json` and loads `drizzle/meta/<idx>_snapshot.json` for every entry, and a journal entry with no snapshot breaks that generate.

Run this from `dashboard-app/`:
```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// 1. The snapshot. 0009 adds only functions and policies, which drizzle-kit
//    does not model, so the schema state is byte-for-byte 0008 — only the
//    identity fields that chain the snapshots together change.
const prev = JSON.parse(readFileSync("drizzle/meta/0008_snapshot.json", "utf8"));
const next = { ...prev, id: randomUUID(), prevId: prev.id };
writeFileSync("drizzle/meta/0009_snapshot.json", JSON.stringify(next, null, 2) + "\n");

// 2. The journal entry, in the shape every other entry already has.
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
journal.entries.push({
  idx: journal.entries.length,
  version: "7",
  when: Date.now(),
  tag: "0009_platform_rls",
  breakpoints: true,
});
writeFileSync("drizzle/meta/_journal.json", JSON.stringify(journal, null, 2) + "\n");
'
```
Then confirm the chain is intact before moving on:
```bash
npx drizzle-kit generate --name noop_check
```
Expected: `No schema changes, nothing to migrate` and **no** new file — if it instead throws while reading the meta folder, the snapshot is wrong. Verify the SQL applies with `npm run test:integration -- platform-rls`, which re-applies every migration on an empty database.

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
- Create: `dashboard-app/src/test/integration-setup.ts`
- Modify: `dashboard-app/src/lib/env.ts`
- Modify: `dashboard-app/vitest.integration.config.ts`

**Interfaces:**
- Consumes: `env()` from `@/lib/env`.
- Produces:
```ts
// src/platform/clock.ts
export interface Clock { now(): Date }

// src/lib/env.ts
export function resetEnvCache(): void;   // test seam; env() memoises into a module-scope cache

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

- [ ] **Step 4: Add the env var and a reset seam**

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
and, next to `env()` itself:
```ts
/**
 * Test seam. `env()` memoises the parsed schema in a module-scope `cached`, so
 * a test that rewrites `process.env` after some earlier module already called
 * `env()` would otherwise keep reading the old values — silently, and with no
 * way to tell. Never called outside tests; the production process resolves its
 * environment once and keeps it.
 */
export function resetEnvCache(): void {
  cached = null;
}
```

- [ ] **Step 5: Give the integration suite a real environment (Ruling P2-C10)**

`env()` validates the *whole* schema, so the first integration test that reaches `credentialCipher()` — through `integrationDeps` in Tasks 8, 14 and 15 — fails with `Invalid environment configuration` unless `DATABASE_URL`, `AUTH_URL`, `AUTH_SECRET`, `OIDC_*`, `AUTHORIZED_SUB`, `PAPERLESS_*`, `CRON_SECRET`, `WEBHOOK_SECRET` and `APP_ENCRYPTION_KEY` are all present. Setting one variable per test file cannot fix that, and cannot beat the memoisation either. One setup file does both.

`src/test/integration-setup.ts`:
```ts
/**
 * The environment every integration test runs under.
 *
 * Loaded as vitest `setupFiles`, so it executes before the test file — and
 * therefore before any module in the graph calls `env()`. `resetEnvCache()`
 * runs after the assignment for the case where a setup file in the same worker
 * has already resolved the environment.
 *
 * `TEST_DATABASE_URL` is deliberately NOT set here: the vitest config already
 * supplies it, and `src/test/db.ts` refuses to run without it.
 */
import { resetEnvCache } from "@/lib/env";

const KEY = `itest:${Buffer.alloc(32, 11).toString("base64")}`;

Object.assign(process.env, {
  NODE_ENV: "test",
  TZ: "Europe/Rome",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://app_test@localhost:55432/dashboard_test",
  AUTH_URL: "https://dash.example.test",
  AUTH_SECRET: "a".repeat(40),
  OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  AUTHORIZED_SUB: "sub-123",
  PAPERLESS_URL: "https://paperless.example.test",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
  // Every itest that seals a credential without building its own cipher opens
  // it again under this key. A test that wants its own key sets
  // `process.env.APP_ENCRYPTION_KEY` and calls `resetCredentialCipher()`.
  APP_ENCRYPTION_KEY: KEY,
});

resetEnvCache();

export { KEY as ITEST_ENCRYPTION_KEY };
```
In `vitest.integration.config.ts`, add `setupFiles` next to `include`:
```ts
    include: ["src/**/*.itest.ts"],
    setupFiles: ["./src/test/integration-setup.ts"],
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test -- crypto && npm run test:integration`
Expected: PASS (6 new unit cases; the existing integration suite is unchanged and still green under the new setup file).

- [ ] **Step 7: Commit**

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
    /**
     * Spec §6's "cursor state", per (connection, kind). Opaque to the
     * framework: only the provider's own handler reads or writes it, through
     * `SyncApplyContext.cursor` / `setCursor`, and it is persisted only when the
     * run succeeds — a failed pass must not advance a cursor past rows it never
     * imported. Null until a handler sets one (Ruling P2-C5).
     */
    cursor: jsonb("cursor"),
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
    /** The `sync_jobs` row this run belongs to, when there is one (Ruling P2-C4). */
    jobId: uuid("job_id").references(() => syncJobs.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    trigger: text("trigger").notNull(),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    /**
     * `queued` is the state a webhook leaves behind (spec §3.4, Ruling P2-C3):
     * the delivery is verified inside the request, the work is not. The hourly
     * `sync_queue` job claims queued rows and runs them in their owner's user
     * context.
     */
    check("sync_runs_status_ck", sql`${t.status} IN ('queued','running','success','failed','skipped')`),
    check("sync_runs_trigger_ck", sql`${t.trigger} IN ('cron','manual','webhook','api')`),
    index("sync_runs_connection_started_idx").on(t.connectionId, t.startedAt.desc()),
    // Spec §5.10 asks for this one by name.
    index("sync_runs_job_started_idx").on(t.jobId, t.startedAt.desc()),
    // The queue drain's read: oldest queued row first, across every connection.
    index("sync_runs_queued_idx").on(t.status, t.startedAt),
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

`resetDb` clears every public table, which would take the provider catalogue with it. Do **not** re-insert the seed there: copying the migration's `INSERT` into `src/test/db.ts` gives the catalogue two sources, and a third provider would have to be added to both. `integration_providers` is a static catalogue owned by the migration, so exclude it and there is exactly one source.

In `src/test/db.ts`, replace `resetDb` with:
```ts
/**
 * Tables the migrations own outright. They hold no test data, no row a test
 * creates points at them, and clearing them would discard a catalogue only a
 * migration knows how to write — so a test needing it back would have to keep a
 * second copy of the migration's seed in sync by hand.
 */
const STATIC_TABLES = ["integration_providers"];

/** Clear everything except drizzle's own bookkeeping and the static catalogues. */
export async function resetDb(): Promise<void> {
  const d = await testDb();
  const res = await d.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE '__drizzle%'`);
  const names = res.rows
    .filter((r) => !STATIC_TABLES.includes(r.table_name))
    .map((r) => `"${r.table_name}"`);
  if (names.length) await d.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}
```
Nothing references `integration_providers` except `integration_connections.provider`, and `CASCADE` only follows references *into* the listed tables, so the catalogue survives while its dependent rows still go.

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

  it("accepts a queued run and a job carrying a cursor", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();

    const { run, job } = await withSystemContext(db, async (tx) => {
      const [connection] = await tx
        .insert(integrationConnections)
        .values({ userId: user!.id, provider: "wallet", status: "connected" })
        .returning();
      const [createdJob] = await tx
        .insert(syncJobs)
        .values({ connectionId: connection!.id, kind: "accounts", schedule: "daily", cursor: { page: 3 } })
        .returning();
      const [createdRun] = await tx
        .insert(syncRuns)
        .values({
          connectionId: connection!.id,
          jobId: createdJob!.id,
          kind: "accounts",
          status: "queued",
          trigger: "webhook",
        })
        .returning();
      return { run: createdRun!, job: createdJob! };
    });

    expect(run.status).toBe("queued");
    expect(run.jobId).toBe(job.id);
    expect(job.cursor).toEqual({ page: 3 });
    expect(job.enabled).toBe(true);
  });
});
```
Add `syncJobs` to the `@/lib/db/schema` import at the top of the file.

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
- Produces the whole framework vocabulary, used verbatim by Tasks 7–18. The full file is in Step 3; this is its shape:
```ts
export type ProviderCode = "wallet" | "trek";                       // Ruling P2-C6
export type IntegrationCapability = "accounts" | "transactions" | "interest_posting" | "leave" | "documents";
export type ConnectionStatus = "disconnected" | "connected" | "error" | "disabled";
export type DisconnectPolicy = "keep" | "archive" | "purge";
export type SyncKind = "accounts" | "leave";
export type SyncTrigger = "cron" | "manual" | "webhook" | "api";
export type SyncRunStatus = "queued" | "running" | "success" | "failed" | "skipped";
export type SyncSchedule = "hourly" | "daily" | "monthly";          // Ruling P2-4
export interface IntegrationConnection { … }
export interface SyncRun { … }                                       // carries jobId
export interface SyncFetchContext { … }                              // NO db handle
export interface SyncApplyContext { … }                              // db, cursor, setCursor
export interface SyncHandler<P = unknown> { schedule; fetch(ctx); apply(ctx, payload) }
export interface IntegrationProvider { … }
export interface ProviderRegistry { get(code): IntegrationProvider | null; list(): IntegrationProvider[] }
// registry.ts
export function registerProvider(p: IntegrationProvider): void;
export const providerRegistry: ProviderRegistry;
export function resetProviderRegistry(): void;
// webhook-signature.ts
export function verifyHmacSignature(input: { rawBody: string; presented: string | null; secret: string }): boolean;
export function hmacSignatureVerifier(headerName?: string): (req: WebhookRequest, secret: string) => boolean;
export function webhookEventName(payload: unknown): string;
```

**Why `SyncHandler` is two phases.** Task 2 exists to keep a provider round trip out of the database transaction that writes its results. A single-function handler cannot honour that: it is handed one `db` and does both. Splitting it means the engine can call `fetch` with no database handle at all — the type makes the rule unbreakable rather than merely documented — and then open a transaction for `apply`. `fetch` is where the network is; `apply` is where the writes are; neither can do the other's job.

**Assignability note.** `syncs` is `Partial<Record<SyncKind, SyncHandler>>`, i.e. `SyncHandler<unknown>`. A `SyncHandler<ProviderAccount[]>` is assignable to it because `fetch`/`apply` are declared with **method** syntax, which TypeScript keeps bivariant even under `strictFunctionTypes`. Declaring them as properties with arrow types would break that, so do not.

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
import { hmacSignatureVerifier, verifyHmacSignature, webhookEventName } from "./webhook-signature";

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

describe("hmacSignatureVerifier", () => {
  it("reads the signature off the header and verifies the raw body", () => {
    const verify = hmacSignatureVerifier();
    const headers = new Headers({ "x-signature": GOOD });
    expect(verify({ rawBody: BODY, headers }, SECRET)).toBe(true);
    expect(verify({ rawBody: BODY, headers }, "other")).toBe(false);
    expect(verify({ rawBody: BODY, headers: new Headers() }, SECRET)).toBe(false);
  });

  it("can be pointed at a different header name", () => {
    const verify = hmacSignatureVerifier("x-hub-signature-256");
    expect(verify({ rawBody: BODY, headers: new Headers({ "x-hub-signature-256": GOOD }) }, SECRET)).toBe(true);
    expect(verify({ rawBody: BODY, headers: new Headers({ "x-signature": GOOD }) }, SECRET)).toBe(false);
  });
});

describe("webhookEventName", () => {
  it("reads a string event and falls back to \"unknown\" for anything else", () => {
    expect(webhookEventName({ event: "accounts.changed" })).toBe("accounts.changed");
    expect(webhookEventName({ event: 7 })).toBe("unknown");
    expect(webhookEventName({})).toBe("unknown");
    expect(webhookEventName(null)).toBe("unknown");
    expect(webhookEventName([{ event: "x" }])).toBe("unknown");
    expect(webhookEventName("accounts.changed")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- integrations/registry integrations/webhook-signature`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write `types.ts`**

`src/platform/integrations/types.ts`, in full:
```ts
/**
 * The integration framework's vocabulary (spec §6). Provider-neutral by
 * construction: nothing in this file names Wallet or Trek, and nothing in it
 * imports a module that does.
 */

import type { ZodType } from "zod";
import type { DbClient } from "@/lib/db/client";
import type { AuditInput } from "@/platform/audit/record";
import type { Clock } from "@/platform/clock";

/** Ruling P2-C6: `payroll_silo` joins in Phase 4, with the document store it needs. */
export type ProviderCode = "wallet" | "trek";

export type IntegrationCapability =
  | "accounts"
  | "transactions"
  | "interest_posting"
  | "leave"
  | "documents";

export type ConnectionStatus = "disconnected" | "connected" | "error" | "disabled";
export type DisconnectPolicy = "keep" | "archive" | "purge";
export type SyncKind = "accounts" | "leave";
export type SyncTrigger = "cron" | "manual" | "webhook" | "api";

/**
 * `queued` is a run a webhook created and nobody has executed yet (spec §3.4,
 * Ruling P2-C3). `skipped` is a run that was started and deliberately did
 * nothing.
 */
export type SyncRunStatus = "queued" | "running" | "success" | "failed" | "skipped";

/** The dispatch tier a sync's `sync_jobs` row is created with (Ruling P2-4). */
export type SyncSchedule = "hourly" | "daily" | "monthly";

export interface IntegrationConnection {
  id: string;
  userId: string;
  provider: ProviderCode;
  status: ConnectionStatus;
  settings: Record<string, unknown>;
  lastTestAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  disconnectPolicy: DisconnectPolicy;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  /** The `sync_jobs` row this run belongs to, or null when there is none. */
  jobId: string | null;
  kind: SyncKind;
  status: SyncRunStatus;
  trigger: SyncTrigger;
  stats: Record<string, number>;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

/**
 * The first half of a sync: talking to the provider.
 *
 * It carries the credential and NO database handle, on purpose. The engine
 * calls `fetch` with no transaction open, so a slow provider cannot hold one of
 * the pool's eight connections for the length of an HTTP conversation — the
 * defect Task 2 removed from the Wallet path, made unrepeatable by the type.
 */
export interface SyncFetchContext {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
  runId: string;
  clock: Clock;
  /** The `sync_jobs.cursor` value for this (connection, kind), or null. */
  cursor: unknown;
}

/**
 * The second half: writing what `fetch` brought back.
 *
 * It carries the database handle and NO credential — an `apply` that wanted to
 * call the provider would have nothing to call it with. `setCursor` records
 * where the next pass should resume; the engine persists it only if the run
 * ends `success` (Ruling P2-C5).
 */
export interface SyncApplyContext {
  connection: IntegrationConnection;
  runId: string;
  db: DbClient;
  clock: Clock;
  cursor: unknown;
  setCursor(next: unknown): void;
  audit(e: AuditInput): Promise<void>;
}

export interface SyncHandler<P = unknown> {
  /** The tier the `sync_jobs` row for this kind is created on. */
  schedule: SyncSchedule;
  /** Provider I/O only. No transaction is open while this runs. */
  fetch(ctx: SyncFetchContext): Promise<P>;
  /** Database work only, inside one user-scoped transaction. Returns the run's stats. */
  apply(ctx: SyncApplyContext, payload: P): Promise<Record<string, number>>;
}

export interface DisconnectContext {
  connection: IntegrationConnection;
  policy: DisconnectPolicy;
  db: DbClient;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
}

export interface SyncRequest {
  kind: SyncKind;
  event: string;
}

/**
 * One provider, in the framework's terms (spec §6).
 *
 * `verify(req, secret)` and `toSyncRequests(payload)` deviate from the spec's
 * illustrative sketch (`verify(req)`, `toJobs(payload)`) — Ruling P2-C8: the
 * secret is per connection, so a verifier cannot resolve it itself, and what
 * comes back is a sync request, not a job row.
 */
export interface IntegrationProvider {
  code: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialSchema: ZodType<Record<string, string>>;
  credentialFields: readonly CredentialField[];
  testConnection(
    credentials: Record<string, string>,
    settings: Record<string, unknown>,
  ): Promise<TestResult>;
  syncs: Partial<Record<SyncKind, SyncHandler>>;
  webhook?: {
    verify(req: WebhookRequest, secret: string): boolean;
    toSyncRequests(payload: unknown): SyncRequest[];
  };
  onDisconnect(ctx: DisconnectContext): Promise<void>;
}

export interface ProviderRegistry {
  get(code: string): IntegrationProvider | null;
  list(): IntegrationProvider[];
}
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
import type { WebhookRequest } from "./types";

/** The header every adapter reads its signature from, unless it says otherwise. */
const DEFAULT_SIGNATURE_HEADER = "x-signature";

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

/**
 * The `webhook.verify` every adapter uses. It lives here, not in each
 * `*-adapter.ts`, because the two adapters were otherwise character-for-
 * character identical — and a verifier duplicated per provider is a verifier
 * that can be fixed in one place and left broken in the other. Nothing
 * provider-specific is expressed here beyond the header name, which each
 * adapter may override.
 */
export function hmacSignatureVerifier(
  headerName: string = DEFAULT_SIGNATURE_HEADER,
): (req: WebhookRequest, secret: string) => boolean {
  return (req, secret) =>
    verifyHmacSignature({ rawBody: req.rawBody, presented: req.headers.get(headerName), secret });
}

/**
 * The event name out of a decoded webhook payload, or `"unknown"`.
 *
 * Also shared for the same reason: both adapters need exactly one field out of
 * an untrusted `unknown`, and the narrowing that does it safely is six lines
 * nobody should write twice. An array is refused deliberately — `["event"]` has
 * an `event` property in JavaScript's eyes and must not read as an event name.
 */
export function webhookEventName(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "unknown";
  const event = (payload as { event?: unknown }).event;
  return typeof event === "string" && event !== "" ? event : "unknown";
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npm test -- integrations/registry integrations/webhook-signature`
Expected: PASS (8 cases: 2 registry + 3 signature + 2 verifier + 1 event name).

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
- Create: `dashboard-app/src/test/integration-deps.ts`

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

// application/ports.ts — the full file is in Step 5
export interface ConnectionsRepository { list; get; getById; getByProvider; create; update;
  recordState; delete; readCredentials; writeCredentials; candidatesForWebhook }
export interface SyncJobsRepository { ensure; find; listForConnection; setCursor }
export interface SyncRunsRepository { start; enqueue; claim; finish; running; recent; queued }
export interface WebhookDeliveriesRepository { record }

// application/deps.ts
export interface IntegrationDeps {
  connections; jobs; runs; deliveries; cipher; registry; db; clock; audit;
  /** Opens a user-scoped transaction and rebuilds the bag inside it. */
  inUserContext<T>(userId: string, fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
  /** The same, with `app.role = 'system'`, for the paths that have no principal. */
  inSystemContext<T>(fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
}

// application/errors.ts
export class UnknownProviderError extends Error {}          // no adapter under that code
export class ConnectionNotFoundError extends Error {}       // no connection, or somebody else's
export class CredentialValidationError extends Error { readonly issues?: unknown }
export class ConnectionVersionMismatchError extends Error {} // thrown by connectIntegration (Ruling P2-C9)
export class SyncNotSupportedError extends Error {}          // added here rather than in Task 10
export class ConnectionNotUsableError extends Error {}
export class SyncDisabledError extends Error {}              // the sync_jobs row says enabled = false

// infrastructure/memory-repositories.ts
export class MemoryConnectionsRepository implements ConnectionsRepository {}
export class MemorySyncJobsRepository implements SyncJobsRepository {}
export class MemorySyncRunsRepository implements SyncRunsRepository {}
export class MemoryWebhookDeliveriesRepository implements WebhookDeliveriesRepository {}
export function memoryCipher(): CredentialCipher;   // reversible, in-process, never touches the environment

// src/test/integration-deps.ts
export const unusedDb: DbClient;                    // a real client that fails loudly if a test uses it
export function testIntegrationDeps(over?: Partial<IntegrationDeps>): IntegrationDeps;
```

**Why `inUserContext` is on the deps bag.** Every integration use case receives deps bound to the pool and opens its own transactions (see Global Constraints). Putting the opener on the bag rather than importing `withUserContext` inside each use case is what keeps the use cases free of `@/lib/db`: a unit test passes `(_userId, fn) => fn(deps)` and the memory repositories carry on as before, while production passes the real thing. `recordState` and the run bookkeeping therefore always run under a context whose RLS policy accepts them.

**Two names the Task 7 draft carried are gone.** `SyncRunsRepository.recentForUser` and `MemorySyncRunsRepository.setOwner` had no caller anywhere in the phase; `recent(connectionId, limit)` is what `listIntegrations` and `GET …/sync-runs` use. They are deleted rather than shipped as dead API surface. `ConnectionVersionMismatchError` stays, because Ruling P2-C9 gives it a thrower in Task 9.

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

  it("describes all three disconnect policies, each saying what happens to the data", () => {
    expect(DISCONNECT_POLICIES).toEqual(["keep", "archive", "purge"]);
    // Every sentence has to say the credential goes — that is the one promise
    // shared by all three (spec §8.4) and the UI shows this text verbatim.
    for (const policy of DISCONNECT_POLICIES) {
      expect(describeDisconnectPolicy(policy)).toMatch(/credential is deleted/);
    }
    expect(describeDisconnectPolicy("keep")).toMatch(/history stay/);
    expect(describeDisconnectPolicy("archive")).toMatch(/archived/);
    expect(describeDisconnectPolicy("purge")).toMatch(/deleted\.$/);
    // Three distinct sentences, not one repeated.
    expect(new Set(DISCONNECT_POLICIES.map(describeDisconnectPolicy)).size).toBe(3);
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
    // Narrowed, not cast: the three-way return IS the contract, and a cast
    // would keep passing if `update` started answering something else.
    if (updated === null || updated === "version_mismatch") {
      throw new Error(`expected the updated connection, got ${String(updated)}`);
    }
    expect(updated.version).toBe(2);
    expect(updated.disconnectPolicy).toBe("archive");
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
      jobId: null,
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

  it("queues a run, hands it out once, and never twice", async () => {
    const runs = new MemorySyncRunsRepository();
    const queued = await runs.enqueue({
      connectionId: "c1",
      jobId: null,
      kind: "accounts",
      trigger: "webhook",
      queuedAt: new Date("2026-09-04T08:00:00Z"),
    });
    expect(queued.status).toBe("queued");
    // A queued run is not a running one: it must not make the next trigger join it.
    expect(await runs.running("c1", "accounts")).toBeNull();
    expect((await runs.queued(10)).map((r) => r.id)).toEqual([queued.id]);

    const claimed = await runs.claim(queued.id, new Date("2026-09-04T08:01:00Z"));
    expect(claimed?.status).toBe("running");
    expect(await runs.queued(10)).toEqual([]);
    // A second tick that raced the first gets nothing rather than a double run.
    expect(await runs.claim(queued.id, new Date("2026-09-04T08:01:01Z"))).toBeNull();
  });
});

describe("memory sync jobs repository", () => {
  it("creates a job once per (connection, kind) and remembers its cursor", async () => {
    const jobs = new MemorySyncJobsRepository();
    const first = await jobs.ensure({ connectionId: "c1", kind: "accounts", schedule: "daily" });
    const again = await jobs.ensure({ connectionId: "c1", kind: "accounts", schedule: "daily" });
    expect(again.id).toBe(first.id);
    expect(await jobs.listForConnection("c1")).toHaveLength(1);
    expect(first.enabled).toBe(true);
    expect(first.cursor).toBeNull();

    await jobs.setCursor(first.id, { page: 2 });
    expect((await jobs.find("c1", "accounts"))?.cursor).toEqual({ page: 2 });
    expect(await jobs.find("c1", "leave")).toBeNull();
  });
});
```
Add `MemorySyncJobsRepository` to the import at the top of the file, and one line to the connections case:
```ts
    // `getById` is the system paths' lookup: no user id, because the webhook
    // and the queue drain do not have one.
    expect((await repo.getById(created.id))?.userId).toBe(USER);
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

`src/modules/integrations/application/ports.ts`, in full:
```ts
import type { SealedCredential } from "@/platform/integrations/crypto";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  SyncRun,
  SyncRunStatus,
  SyncSchedule,
  SyncTrigger,
} from "@/platform/integrations/types";

export interface NewConnection {
  userId: string;
  provider: ProviderCode;
  status: ConnectionStatus;
  settings: Record<string, unknown>;
  disconnectPolicy: DisconnectPolicy;
}

export type ConnectionPatch = Partial<Pick<IntegrationConnection, "settings" | "disconnectPolicy">>;

export interface ConnectionStatePatch {
  status?: ConnectionStatus;
  lastTestAt?: Date | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
}

export interface ConnectionsRepository {
  list(userId: string): Promise<IntegrationConnection[]>;
  get(userId: string, id: string): Promise<IntegrationConnection | null>;
  /**
   * By id alone. Only the two paths with no principal use it — the webhook and
   * the queue drain — and both run in the system context, which is why it
   * carries no `userId` to check against.
   */
  getById(id: string): Promise<IntegrationConnection | null>;
  getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null>;
  create(input: NewConnection): Promise<IntegrationConnection>;
  update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null>;
  /**
   * Lifecycle stamps — status, last test, last sync, last error — written by
   * the engine itself. Deliberately not version-checked: a sync finishing must
   * not lose a race with a person editing the connection's settings, and
   * neither write can invalidate the other.
   */
  recordState(id: string, patch: ConnectionStatePatch): Promise<void>;
  delete(userId: string, id: string): Promise<boolean>;
  readCredentials(userId: string, id: string): Promise<SealedCredential | null>;
  writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void>;
  /** Every connected connection for a provider, across users. The webhook resolver's read. */
  candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]>;
}

/**
 * One schedulable unit of sync per (connection, kind) — spec §5.2's
 * `sync_jobs`. It is what makes a kind switchable off without disconnecting the
 * whole provider, and where the cursor lives (Rulings P2-C4, P2-C5).
 */
export interface SyncJob {
  id: string;
  connectionId: string;
  kind: SyncKind;
  schedule: SyncSchedule;
  enabled: boolean;
  cursor: unknown;
}

export interface SyncJobsRepository {
  /** Idempotent: one row per (connection, kind). Called on every connect. */
  ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob>;
  find(connectionId: string, kind: SyncKind): Promise<SyncJob | null>;
  listForConnection(connectionId: string): Promise<SyncJob[]>;
  setCursor(id: string, cursor: unknown): Promise<void>;
}

export interface NewSyncRun {
  connectionId: string;
  jobId: string | null;
  kind: SyncKind;
  trigger: SyncTrigger;
}

export interface SyncRunsRepository {
  /** A run that starts `running` right now. */
  start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun>;
  /** A run that starts `queued`, for somebody else to execute (spec §3.4). */
  enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun>;
  /**
   * Moves a `queued` run to `running`, atomically. Null when it is no longer
   * queued — which is exactly how two ticks racing the same row end up running
   * it once.
   */
  claim(id: string, startedAt: Date): Promise<SyncRun | null>;
  finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void>;
  running(connectionId: string, kind: SyncKind): Promise<SyncRun | null>;
  recent(connectionId: string, limit: number): Promise<SyncRun[]>;
  /** Oldest queued runs first, across every connection. Read in the system context. */
  queued(limit: number): Promise<SyncRun[]>;
}

export interface WebhookDelivery {
  connectionId: string | null;
  provider: ProviderCode;
  event: string;
  payloadHash: string;
  status: "accepted" | "rejected";
  error: string | null;
  receivedAt: Date;
}

export interface WebhookDeliveriesRepository {
  record(input: WebhookDelivery): Promise<void>;
}
```

`src/modules/integrations/application/deps.ts`, in full:
```ts
import type { DbClient } from "@/lib/db/client";
import type { AuditInput } from "@/platform/audit/record";
import type { Clock } from "@/platform/clock";
import type { CredentialCipher } from "@/platform/integrations/crypto";
import type { ProviderRegistry } from "@/platform/integrations/types";
import type {
  ConnectionsRepository,
  SyncJobsRepository,
  SyncRunsRepository,
  WebhookDeliveriesRepository,
} from "./ports";

/**
 * Everything an integration use case is allowed to touch.
 *
 * The bag handed to a use case is bound to the **pool**, not to a transaction:
 * a use case opens its own, through `inUserContext`, around the database work
 * and around nothing else. That is what keeps a provider round trip — a
 * connection test, a Wallet page fetch, a Trek MCP conversation — outside every
 * transaction, which is the rule Task 2 established and this phase must not
 * quietly undo.
 */
export interface IntegrationDeps {
  connections: ConnectionsRepository;
  jobs: SyncJobsRepository;
  runs: SyncRunsRepository;
  deliveries: WebhookDeliveriesRepository;
  cipher: CredentialCipher;
  registry: ProviderRegistry;
  /** The client the repositories above are bound to. */
  db: DbClient;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
  /**
   * Opens a transaction carrying `userId`, and rebuilds this bag inside it, so
   * RLS applies to every statement the callback makes.
   */
  inUserContext<T>(userId: string, fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
  /**
   * The same with `app.role = 'system'`, for the two paths that have no
   * principal at all: verifying an inbound webhook, and draining the sync
   * queue. Neither may be used to write a user's domain data — both hand the
   * work back to `inUserContext` under the connection owner's id.
   */
  inSystemContext<T>(fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
}
```

`src/modules/integrations/application/errors.ts`, in full:
```ts
/** No adapter is registered under that code. */
export class UnknownProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownProviderError";
  }
}

/** No such connection, or it belongs to somebody else — the two are one answer on purpose. */
export class ConnectionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionNotFoundError";
  }
}

/** The provider's own `credentialSchema` refused what was typed. Mirrors `InvalidInputError`. */
export class CredentialValidationError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "CredentialValidationError";
  }
}

/**
 * Spec §3.2: a mutation that carried an expected version lost the race.
 * Thrown by `connectIntegration` (Ruling P2-C9) rather than swallowed — a
 * connect that silently dropped the settings it was asked to apply would leave
 * the person looking at a page that disagrees with the database.
 */
export class ConnectionVersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionVersionMismatchError";
  }
}

/** The provider implements no handler for that `SyncKind`. */
export class SyncNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNotSupportedError";
  }
}

/** The connection exists but is not `connected`, so nothing may be synced through it. */
export class ConnectionNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionNotUsableError";
  }
}

/** The `sync_jobs` row for this (connection, kind) is switched off (Ruling P2-C4). */
export class SyncDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncDisabledError";
  }
}
```

- [ ] **Step 6: Write the memory repositories**

`src/modules/integrations/infrastructure/memory-repositories.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { SealedCredential, CredentialCipher } from "@/platform/integrations/crypto";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  SyncRun,
  SyncRunStatus,
  SyncSchedule,
} from "@/platform/integrations/types";
import type {
  ConnectionPatch,
  ConnectionStatePatch,
  ConnectionsRepository,
  NewConnection,
  NewSyncRun,
  SyncJob,
  SyncJobsRepository,
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

  async getById(id: string): Promise<IntegrationConnection | null> {
    return this.rows.find((r) => r.connection.id === id)?.connection ?? null;
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
      id: randomUUID(),
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

export class MemorySyncJobsRepository implements SyncJobsRepository {
  private rows: SyncJob[] = [];

  async ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob> {
    const existing = this.rows.find((r) => r.connectionId === input.connectionId && r.kind === input.kind);
    if (existing) return existing;
    const job: SyncJob = { id: randomUUID(), ...input, enabled: true, cursor: null };
    this.rows.push(job);
    return job;
  }

  async find(connectionId: string, kind: SyncKind): Promise<SyncJob | null> {
    return this.rows.find((r) => r.connectionId === connectionId && r.kind === kind) ?? null;
  }

  async listForConnection(connectionId: string): Promise<SyncJob[]> {
    return this.rows.filter((r) => r.connectionId === connectionId);
  }

  async setCursor(id: string, cursor: unknown): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index !== -1) this.rows[index] = { ...this.rows[index]!, cursor };
  }
}

export class MemorySyncRunsRepository implements SyncRunsRepository {
  private rows: SyncRun[] = [];

  private add(input: NewSyncRun, status: "running" | "queued", at: Date): SyncRun {
    const run: SyncRun = {
      id: randomUUID(),
      connectionId: input.connectionId,
      jobId: input.jobId,
      kind: input.kind,
      status,
      trigger: input.trigger,
      stats: {},
      error: null,
      startedAt: at,
      finishedAt: null,
    };
    this.rows.unshift(run);
    return run;
  }

  async start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun> {
    return this.add(input, "running", input.startedAt);
  }

  async enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun> {
    return this.add(input, "queued", input.queuedAt);
  }

  /** Conditional on purpose: the second claimant of the same row gets null, not a second run. */
  async claim(id: string, startedAt: Date): Promise<SyncRun | null> {
    const index = this.rows.findIndex((r) => r.id === id && r.status === "queued");
    if (index === -1) return null;
    const claimed: SyncRun = { ...this.rows[index]!, status: "running", startedAt };
    this.rows[index] = claimed;
    return claimed;
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

  async queued(limit: number): Promise<SyncRun[]> {
    return this.rows
      .filter((r) => r.status === "queued")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(0, limit);
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

- [ ] **Step 7: Write the one test deps factory**

`makeDeps()` would otherwise be copied verbatim into five test files, each with a `db: {} as never` cast. One factory, one real value.

`src/test/integration-deps.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import {
  MemoryConnectionsRepository,
  MemorySyncJobsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "@/modules/integrations/infrastructure/memory-repositories";
import type { ProviderRegistry } from "@/platform/integrations/types";

/**
 * A real, correctly typed `DbClient` that is not connected to anything.
 *
 * `db: {} as never` was the alternative, and it is worse in both directions: it
 * type-checks a value that has none of the shape, and a test that accidentally
 * touched it would die on `undefined is not a function` rather than saying what
 * happened. This one is a genuine Drizzle client over a pool pointed at a port
 * nothing listens on — constructing it opens no socket, and a test that does
 * reach for the database fails loudly with a connection error naming this host.
 * Every use case in this module is expected to run entirely on the memory
 * repositories.
 */
export const unusedDb: DbClient = drizzle(
  new Pool({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused", max: 1 }),
  { schema },
);

const EMPTY_REGISTRY: ProviderRegistry = { get: () => null, list: () => [] };

/**
 * `IntegrationDeps` on the memory repositories. Pass `registry` (and anything
 * else) to override.
 *
 * The memory repositories have no transactions, so both context openers hand
 * back the very same bag — which is also what makes a use case's
 * `deps.inUserContext(...)` a no-op wrapper in a unit test rather than
 * something the test has to fake.
 */
export function testIntegrationDeps(over: Partial<IntegrationDeps> = {}): IntegrationDeps {
  const deps: IntegrationDeps = {
    connections: over.connections ?? new MemoryConnectionsRepository(),
    jobs: over.jobs ?? new MemorySyncJobsRepository(),
    runs: over.runs ?? new MemorySyncRunsRepository(),
    deliveries: over.deliveries ?? new MemoryWebhookDeliveriesRepository(),
    cipher: over.cipher ?? memoryCipher(),
    registry: over.registry ?? EMPTY_REGISTRY,
    db: over.db ?? unusedDb,
    clock: over.clock ?? { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: over.audit ?? (async () => {}),
    inUserContext: over.inUserContext ?? ((_userId, fn) => fn(deps)),
    inSystemContext: over.inSystemContext ?? ((fn) => fn(deps)),
  };
  return deps;
}
```

- [ ] **Step 8: Run the tests**

Run: `npm run typecheck && npm test -- integrations`
Expected: PASS — **23 cases** across the five files whose path contains `integrations`: `platform/integrations/crypto.test.ts` 6, `platform/integrations/registry.test.ts` 2, `platform/integrations/webhook-signature.test.ts` 6, `modules/integrations/domain/connection.test.ts` 4, `modules/integrations/infrastructure/memory-repositories.test.ts` 5.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(integrations): connection domain, ports, in-memory repositories and the shared test deps"
```

---

### Task 8: Drizzle repositories and the production deps bag

**Files:**
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-connections-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-sync-jobs-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/deps.ts`
- Test: `dashboard-app/src/modules/integrations/infrastructure/repositories.itest.ts`

**Interfaces:**
- Consumes: the ports from Task 7, the Drizzle tables from Task 5, `recordAudit`, `credentialCipher`, `providerRegistry`.
- Produces:
```ts
export class DrizzleConnectionsRepository implements ConnectionsRepository { constructor(db: DbClient) }
export class DrizzleSyncJobsRepository implements SyncJobsRepository { constructor(db: DbClient) }
export class DrizzleSyncRunsRepository implements SyncRunsRepository { constructor(db: DbClient) }
export class DrizzleWebhookDeliveriesRepository implements WebhookDeliveriesRepository { constructor(db: DbClient) }

/**
 * `root` is the POOL — the client `inUserContext` / `inSystemContext` open
 * their transactions on. `bound` is set only by those two when they rebuild the
 * bag inside a transaction they just opened; no caller passes it.
 */
export function integrationDeps(root: DbClient, requestId?: string | null, bound?: DbClient): IntegrationDeps;
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
    // Narrowed, not cast — same reason as the memory repository's test.
    if (bumped === null || bumped === "version_mismatch") {
      throw new Error(`expected the updated connection, got ${String(bumped)}`);
    }
    expect(bumped.version).toBe(2);
    expect(bumped.disconnectPolicy).toBe("archive");
    const stale = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).update(user!.id, created.id, 1, { disconnectPolicy: "purge" }),
    );
    expect(stale).toBe("version_mismatch");

    const jobId = await withUserContext(db, { userId: user!.id }, async (tx) => {
      const jobs = new DrizzleSyncJobsRepository(tx);
      const job = await jobs.ensure({ connectionId: created.id, kind: "accounts", schedule: "daily" });
      // Idempotent: connecting twice must not create a second job row.
      expect((await jobs.ensure({ connectionId: created.id, kind: "accounts", schedule: "daily" })).id).toBe(job.id);
      expect(job.enabled).toBe(true);
      await jobs.setCursor(job.id, { since: "2026-09-01" });
      expect((await jobs.find(created.id, "accounts"))?.cursor).toEqual({ since: "2026-09-01" });
      return job.id;
    });

    await withUserContext(db, { userId: user!.id }, async (tx) => {
      const runs = new DrizzleSyncRunsRepository(tx);
      const run = await runs.start({
        connectionId: created.id,
        jobId,
        kind: "accounts",
        trigger: "manual",
        startedAt: new Date("2026-09-04T08:00:00Z"),
      });
      expect(run.jobId).toBe(jobId);
      expect((await runs.running(created.id, "accounts"))?.id).toBe(run.id);
      await runs.finish(run.id, {
        status: "success",
        stats: { created: 3 },
        error: null,
        finishedAt: new Date("2026-09-04T08:00:02Z"),
      });
      expect(await runs.running(created.id, "accounts")).toBeNull();
      expect((await runs.recent(created.id, 5))[0]?.stats).toEqual({ created: 3 });

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

    // The three system-context reads: no principal exists on the webhook and
    // queue-drain paths, so they are exercised the way those paths run them.
    await withSystemContext(db, async (tx) => {
      const connections = new DrizzleConnectionsRepository(tx);
      expect((await connections.candidatesForWebhook("wallet")).map((c) => c.id)).toEqual([created.id]);
      expect((await connections.getById(created.id))?.userId).toBe(user!.id);

      const runs = new DrizzleSyncRunsRepository(tx);
      const queued = await runs.enqueue({
        connectionId: created.id,
        jobId,
        kind: "accounts",
        trigger: "webhook",
        queuedAt: new Date("2026-09-04T08:02:00Z"),
      });
      expect(queued.status).toBe("queued");
      // A queued run is not in flight: it must not make the next trigger join it.
      expect(await runs.running(created.id, "accounts")).toBeNull();
      expect((await runs.queued(10)).map((r) => r.id)).toEqual([queued.id]);

      const claimed = await runs.claim(queued.id, new Date("2026-09-04T08:03:00Z"));
      expect(claimed?.status).toBe("running");
      expect(await runs.queued(10)).toEqual([]);
      // The losing tick of a race gets nothing, so the row runs exactly once.
      expect(await runs.claim(queued.id, new Date("2026-09-04T08:03:01Z"))).toBeNull();
    });
  });
});
```
The imports at the top gain `withSystemContext` from `@/platform/db/context` and `DrizzleSyncJobsRepository` from `./drizzle-sync-jobs-repository`.

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

  /**
   * By id alone, with no user predicate: the webhook resolver and the sync
   * queue drain have no principal to check against, and both call this inside
   * `inSystemContext`. Every other read carries the user id.
   */
  async getById(id: string): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id))
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

- [ ] **Step 4: Write the jobs, runs and deliveries repositories**

`src/modules/integrations/infrastructure/drizzle-sync-jobs-repository.ts`:
```ts
import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { syncJobs, type SyncJobRow } from "@/lib/db/schema";
import type { SyncKind, SyncSchedule } from "@/platform/integrations/types";
import type { SyncJob, SyncJobsRepository } from "../application/ports";

function toJob(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind as SyncKind,
    schedule: row.schedule as SyncSchedule,
    enabled: row.enabled,
    cursor: row.cursor,
  };
}

export class DrizzleSyncJobsRepository implements SyncJobsRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * One row per (connection, kind), created on connect and never duplicated —
   * `ON CONFLICT DO NOTHING` against `sync_jobs_connection_kind_uq`, then a
   * read, so a reconnect keeps whatever `enabled` and `cursor` the existing
   * row has. Re-enabling a kind somebody switched off is not a side effect of
   * reconnecting.
   */
  async ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob> {
    await this.db
      .insert(syncJobs)
      .values({ connectionId: input.connectionId, kind: input.kind, schedule: input.schedule })
      .onConflictDoNothing({ target: [syncJobs.connectionId, syncJobs.kind] });
    const existing = await this.find(input.connectionId, input.kind);
    if (!existing) throw new Error(`sync_jobs row for ${input.connectionId}/${input.kind} did not persist`);
    return existing;
  }

  async find(connectionId: string, kind: SyncKind): Promise<SyncJob | null> {
    const [row] = await this.db
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.connectionId, connectionId), eq(syncJobs.kind, kind)))
      .limit(1);
    return row ? toJob(row) : null;
  }

  async listForConnection(connectionId: string): Promise<SyncJob[]> {
    const rows = await this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.connectionId, connectionId))
      .orderBy(asc(syncJobs.kind));
    return rows.map(toJob);
  }

  async setCursor(id: string, cursor: unknown): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ cursor: cursor ?? null, updatedAt: new Date() })
      .where(eq(syncJobs.id, id));
  }
}
```

`src/modules/integrations/infrastructure/drizzle-sync-runs-repository.ts`:
```ts
import { and, asc, desc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { syncRuns, type SyncRunRow } from "@/lib/db/schema";
import type { SyncKind, SyncRun, SyncRunStatus, SyncTrigger } from "@/platform/integrations/types";
import type { NewSyncRun, SyncRunsRepository } from "../application/ports";

function toRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    connectionId: row.connectionId,
    jobId: row.jobId,
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

  private async insert(input: NewSyncRun, status: "running" | "queued", at: Date): Promise<SyncRun> {
    const [row] = await this.db
      .insert(syncRuns)
      .values({
        connectionId: input.connectionId,
        jobId: input.jobId,
        kind: input.kind,
        status,
        trigger: input.trigger,
        startedAt: at,
      })
      .returning();
    return toRun(row!);
  }

  async start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun> {
    return this.insert(input, "running", input.startedAt);
  }

  /** Spec §3.4: the webhook leaves the work behind as a row, not as an open request. */
  async enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun> {
    return this.insert(input, "queued", input.queuedAt);
  }

  /**
   * The whole reason the drain is safe to run from more than one tick: the
   * `status = 'queued'` predicate is part of the UPDATE, so Postgres decides
   * the race and the loser gets no row back rather than a second execution.
   */
  async claim(id: string, startedAt: Date): Promise<SyncRun | null> {
    const [row] = await this.db
      .update(syncRuns)
      .set({ status: "running", startedAt })
      .where(and(eq(syncRuns.id, id), eq(syncRuns.status, "queued")))
      .returning();
    return row ? toRun(row) : null;
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

  /** Oldest first, so a queue that briefly outruns the tick still drains in order. */
  async queued(limit: number): Promise<SyncRun[]> {
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "queued"))
      .orderBy(asc(syncRuns.startedAt))
      .limit(limit);
    return rows.map(toRun);
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
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { credentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import type { IntegrationDeps } from "../application/deps";
import { DrizzleConnectionsRepository } from "./drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "./drizzle-sync-jobs-repository";
import { DrizzleSyncRunsRepository } from "./drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "./drizzle-webhook-deliveries-repository";

/**
 * The production assembly of `IntegrationDeps` — the mirror of `accountDeps`
 * in the accounts module, and split from `ui/` for the same reason: the API
 * layer must be able to build it without dragging Auth.js (and through it
 * `next/server`) into the import graph.
 *
 * `root` is the CONNECTION POOL, not a transaction. That is the difference
 * from `accountDeps`, and it is deliberate: an integration use case decides
 * for itself where its transactions begin and end, because it also has to talk
 * to a provider over the network and must not do that inside one. `bound` is
 * set only by the two openers below, which rebuild the bag against the
 * transaction they have just opened.
 */
export function integrationDeps(
  root: DbClient,
  requestId?: string | null,
  bound?: DbClient,
): IntegrationDeps {
  const client = bound ?? root;
  return {
    connections: new DrizzleConnectionsRepository(client),
    jobs: new DrizzleSyncJobsRepository(client),
    runs: new DrizzleSyncRunsRepository(client),
    deliveries: new DrizzleWebhookDeliveriesRepository(client),
    cipher: credentialCipher(),
    registry: providerRegistry,
    db: client,
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(client, { ...e, requestId: requestId ?? null }),
    // Always on `root`: nesting a transaction inside `bound` would take a
    // second pool connection while the first is still held, which is how a
    // pool of eight deadlocks under load.
    inUserContext: (userId, fn) =>
      withUserContext(root, { userId }, (tx) => fn(integrationDeps(root, requestId, tx))),
    inSystemContext: (fn) => withSystemContext(root, (tx) => fn(integrationDeps(root, requestId, tx))),
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
- Create: `dashboard-app/src/modules/integrations/application/open-connection.ts`
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

// open-connection.ts
export interface OpenedConnection {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
}
/** The connection and its decrypted credential, or null when there is nothing usable. */
export function openConnection(deps: IntegrationDeps): (
  userId: string, provider: ProviderCode,
) => Promise<OpenedConnection | null>;
```
Every one of the four asserts `integrations.manage` except `listIntegrations`, which asserts `accounts.read` — reading which integrations exist is not a privileged act, and Settings › Integrations must render for a viewer with a "you cannot change this" state rather than a 403 page.

`openConnection` is the extraction of a block that would otherwise appear four times — in `wallet-accounts-sync.ts`, `wallet-refresh.ts`, `trek-sync-job.ts` and `actions/leave.ts`, each spelling out "get the connection, check it is `connected`, read the sealed credential, open it" slightly differently. One of those four spellings would eventually forget the status check. Tasks 11 and 12 build their front doors on it.

- [ ] **Step 1: Write the failing test**

`src/modules/integrations/application/lifecycle.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type { IntegrationProvider, ProviderRegistry, TestResult } from "@/platform/integrations/types";
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { disconnectIntegration } from "./disconnect-integration";
import { listIntegrations } from "./list-integrations";
import { openConnection } from "./open-connection";
import { testIntegrationConnection } from "./test-integration-connection";
import {
  ConnectionNotFoundError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  UnknownProviderError,
} from "./errors";

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
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => [],
        apply: async () => ({}),
      },
    },
    onDisconnect: async (ctx) => {
      disconnects.push(ctx.policy);
    },
  };
}

/** Only the registry differs per test file; everything else comes from the shared factory. */
function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return testIntegrationDeps({ registry });
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

  it("creates one enabled sync job per implemented kind, and does not reset it on reconnect", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
    });
    const job = await deps.jobs.find(connection.id, "accounts");
    expect(job?.schedule).toBe("daily");
    expect(job?.enabled).toBe(true);
    expect(await deps.jobs.find(connection.id, "leave")).toBeNull();

    await deps.jobs.setCursor(job!.id, { since: "2026-09-01" });
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t2" } });
    const after = await deps.jobs.find(connection.id, "accounts");
    // Reconnecting replaces the credential, not the schedule state.
    expect(after?.id).toBe(job!.id);
    expect(after?.cursor).toEqual({ since: "2026-09-01" });
  });

  it("refuses to apply settings onto a connection somebody else has changed (Ruling P2-C9)", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
      settings: { note: "first" },
    });
    // Somebody else's write lands between the read and the update.
    await deps.connections.update(principal.userId, connection.id, connection.version, {
      settings: { note: "theirs" },
    });
    // Hand the use case the version it read a moment ago, which is now stale.
    Object.assign(deps.connections, { getByProvider: async () => connection });
    await expect(
      connectIntegration(deps)(principal, {
        provider: "wallet",
        credentials: { token: "t" },
        settings: { note: "mine" },
      }),
    ).rejects.toBeInstanceOf(ConnectionVersionMismatchError);
    // The losing write left nothing behind: the stored settings are still theirs.
    expect((await deps.connections.get(principal.userId, connection.id))?.settings).toEqual({
      note: "theirs",
    });
  });

  it("openConnection answers null until the connection is usable and credentialled", async () => {
    const deps = makeDeps();
    expect(await openConnection(deps)(principal.userId, "wallet")).toBeNull();

    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
    });
    expect((await openConnection(deps)(principal.userId, "wallet"))?.credentials).toEqual({ token: "t" });

    await deps.connections.recordState(connection.id, { status: "disabled" });
    expect(await openConnection(deps)(principal.userId, "wallet")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- integrations/application/lifecycle`
Expected: FAIL — `Cannot find module './connect-integration'`.

- [ ] **Step 3: Write `open-connection.ts` and `connect-integration.ts`**

`src/modules/integrations/application/open-connection.ts`:
```ts
import type { IntegrationConnection, ProviderCode } from "@/platform/integrations/types";
import { isUsable } from "../domain/connection";
import type { IntegrationDeps } from "./deps";

export interface OpenedConnection {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
}

/**
 * "Is this provider connected, and what is its credential?" — asked in one
 * place instead of four.
 *
 * Both jobs, the Trek server actions and the Work page need exactly this, and
 * each of them spelling it out separately is how one of them ends up checking
 * `status !== "disconnected"` and syncing through a broken credential. `null`
 * covers all three not-usable cases — no connection, not `connected`, no stored
 * credential — because every caller treats them identically: the integration is
 * off, which is a state to report, not an error to raise.
 */
export function openConnection(deps: IntegrationDeps) {
  return async (userId: string, provider: ProviderCode): Promise<OpenedConnection | null> =>
    deps.inUserContext(userId, async (d) => {
      const connection = await d.connections.getByProvider(userId, provider);
      if (!connection || !isUsable(connection)) return null;
      const sealed = await d.connections.readCredentials(userId, connection.id);
      if (!sealed) return null;
      return { connection, credentials: d.cipher.open(sealed) };
    });
}
```

`src/modules/integrations/application/connect-integration.ts`:
```ts
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type {
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  TestResult,
} from "@/platform/integrations/types";
import { statusAfterTest } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import {
  ConnectionVersionMismatchError,
  CredentialValidationError,
  UnknownProviderError,
} from "./errors";

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
 * A failed test does NOT abort the connect (Ruling P2-6). The credential is
 * still stored and the connection lands in `error` with the provider's own
 * message, because the common failure is a typo the person is about to fix —
 * losing what they typed would make them retype the whole secret.
 *
 * Three phases, and the middle one is the point: read what exists, call the
 * provider with NO transaction open, then write. A `testConnection` inside a
 * transaction would hold a pool connection for as long as the provider takes to
 * answer.
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

    // ── 1. What is there now.
    const existing = await deps.inUserContext(principal.userId, (d) =>
      d.connections.getByProvider(principal.userId, input.provider),
    );

    // ── 2. The provider round trip, outside every transaction.
    const test = await provider.testConnection(parsed.data, settings);
    const status = statusAfterTest(test);

    // ── 3. One transaction for every write.
    const connection = await deps.inUserContext(principal.userId, async (d) => {
      const now = d.clock.now();
      let row = existing;

      if (row) {
        const updated = await d.connections.update(principal.userId, row.id, row.version, {
          settings,
          ...(input.disconnectPolicy ? { disconnectPolicy: input.disconnectPolicy } : {}),
        });
        // Ruling P2-C9. Swallowing this would store the new credential while
        // silently dropping the settings that were meant to go with it, and
        // hand back a connection object that disagrees with the database.
        if (updated === "version_mismatch") {
          throw new ConnectionVersionMismatchError(
            `${input.provider} was changed by somebody else; reload and try again`,
          );
        }
        if (updated === null) {
          // The row disappeared between the read and the write — a disconnect
          // that deleted it. Fall through and create a fresh one.
          row = null;
        } else {
          row = updated;
        }
      }

      if (!row) {
        row = await d.connections.create({
          userId: principal.userId,
          provider: input.provider,
          status,
          settings,
          disconnectPolicy: input.disconnectPolicy ?? "keep",
        });
      }

      await d.connections.writeCredentials(principal.userId, row.id, d.cipher.seal(parsed.data));
      await d.connections.recordState(row.id, {
        status,
        lastTestAt: now,
        lastError: test.ok ? null : test.message,
      });

      // Ruling P2-C4: a connection's schedulable work is its `sync_jobs` rows,
      // one per kind the adapter implements. `ensure` keeps whatever `enabled`
      // and `cursor` an existing row has, so reconnecting never silently
      // re-enables a kind somebody switched off.
      for (const [kind, handler] of Object.entries(provider.syncs)) {
        if (!handler) continue;
        await d.jobs.ensure({ connectionId: row.id, kind: kind as SyncKind, schedule: handler.schedule });
      }

      // The credential itself is never audited — only that one was written, and
      // under which key (spec §3.2 "credentials metadata").
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.connect",
        entityType: "integration_connection",
        entityId: row.id,
        after: { provider: input.provider, status, keyId: d.cipher.activeKeyId, testOk: test.ok },
      });

      return (
        (await d.connections.get(principal.userId, row.id)) ?? {
          ...row,
          status,
          lastTestAt: now,
          lastError: test.ok ? null : test.message,
        }
      );
    });

    return { connection, test };
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

/**
 * "Does this credential still work?", answered without changing anything but
 * the stamps. Read, call the provider with nothing open, write.
 */
export function testIntegrationConnection(deps: IntegrationDeps) {
  return async (principal: Principal, providerCode: ProviderCode): Promise<TestResult> => {
    assertPermission(principal, "integrations.manage");
    const provider = deps.registry.get(providerCode);
    if (!provider) throw new UnknownProviderError(`No integration named ${providerCode}`);

    const opened = await deps.inUserContext(principal.userId, async (d) => {
      const connection = await d.connections.getByProvider(principal.userId, providerCode);
      if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);
      const sealed = await d.connections.readCredentials(principal.userId, connection.id);
      if (!sealed) throw new ConnectionNotFoundError(`${providerCode} has no stored credential`);
      return { connection, credentials: d.cipher.open(sealed) };
    });

    const result = await provider.testConnection(opened.credentials, opened.connection.settings);

    await deps.inUserContext(principal.userId, async (d) => {
      await d.connections.recordState(opened.connection.id, {
        status: statusAfterTest(result),
        lastTestAt: d.clock.now(),
        lastError: result.ok ? null : result.message,
      });
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.test",
        entityType: "integration_connection",
        entityId: opened.connection.id,
        after: { provider: providerCode, ok: result.ok },
      });
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
 *
 * All of it is one transaction, deliberately: `onDisconnect` archives or
 * deletes accounts, and that must not be half-applied if destroying the
 * credential fails. `onDisconnect` is the one provider hook that does no
 * network I/O — it operates on local data the provider owned — so holding a
 * transaction across it is safe.
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

    return deps.inUserContext(principal.userId, async (d) => {
      const connection = await d.connections.getByProvider(principal.userId, providerCode);
      if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);

      const effective = policy ?? connection.disconnectPolicy;

      await provider.onDisconnect({
        connection,
        policy: effective,
        db: d.db,
        clock: d.clock,
        audit: d.audit,
      });

      await d.connections.writeCredentials(principal.userId, connection.id, null);
      await d.connections.recordState(connection.id, { status: "disconnected", lastError: null });
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.disconnect",
        entityType: "integration_connection",
        entityId: connection.id,
        after: { provider: providerCode, policy: effective },
      });

      return { policy: effective };
    });
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
    return deps.inUserContext(principal.userId, async (d) => {
      const connections = await d.connections.list(principal.userId);
      const byProvider = new Map(connections.map((c) => [c.provider, c]));

      return Promise.all(
        d.registry.list().map(async (provider) => {
          const connection = byProvider.get(provider.code) ?? null;
          return {
            provider: provider.code,
            label: provider.label,
            capabilities: provider.capabilities,
            credentialFields: provider.credentialFields,
            connection,
            recentRuns: connection ? await d.runs.recent(connection.id, 10) : [],
          };
        }),
      );
    });
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test -- integrations/application/lifecycle`
Expected: PASS (13 cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): connect, test, list and disconnect use cases"
```

---

### Task 10: The sync engine

**Files:**
- Create: `dashboard-app/src/modules/integrations/application/run-sync.ts`
- Create: `dashboard-app/src/modules/integrations/application/enqueue-sync.ts`
- Create: `dashboard-app/src/modules/integrations/application/drain-sync-queue.ts`
- Create: `dashboard-app/src/lib/jobs/sync-queue.ts`, `sync-queue.test.ts`
- Modify: `dashboard-app/src/lib/contracts.ts` (`JobName` gains `"sync_queue"`)
- Modify: `dashboard-app/src/platform/jobs/register-all.ts`
- Test: `dashboard-app/src/modules/integrations/application/run-sync.test.ts`

**Interfaces:**
- Consumes: `IntegrationDeps`, `isUsable`/`nextStatusAfterSync` from the domain, the errors from Task 7.
- Produces:
```ts
export interface RunSyncInput {
  provider: ProviderCode;
  /** Defaults to the provider's first implemented sync — the ONE place that defaulting lives. */
  kind?: SyncKind;
  trigger: SyncTrigger;
}
export function runSync(deps: IntegrationDeps): (principal: Principal, input: RunSyncInput) => Promise<SyncRun>;
/** The same engine without a principal, for the cron path. Asserts nothing; the caller has already decided. */
export function runSyncForUser(deps: IntegrationDeps): (userId: string, input: RunSyncInput) => Promise<SyncRun>;
/** Executes a run that is already `queued`. Null when another tick claimed it first. */
export function resumeQueuedSync(deps: IntegrationDeps): (
  userId: string, input: RunSyncInput, runId: string,
) => Promise<SyncRun | null>;

// enqueue-sync.ts — runs in whatever context the caller has open
export function enqueueSync(deps: IntegrationDeps): (
  connection: IntegrationConnection, kind: SyncKind, trigger: SyncTrigger,
) => Promise<SyncRun>;

// drain-sync-queue.ts
export function drainSyncQueue(deps: IntegrationDeps): (limit?: number) => Promise<SyncRun[]>;

// src/lib/jobs/sync-queue.ts
export const JOB_NAME = "sync_queue";
export function runSyncQueue(input?: { trigger?: "cron" | "manual" }): Promise<JobResult>;
```

Three things this engine owns, and each is a spec line:

1. **`kind` defaulting lives here, not in the route.** `POST /integrations/{provider}/sync` with no body and `syncIntegrationAction` with no `kind` field both reach the same rule, so they cannot disagree.
2. **Idempotent per running job** (spec §6): a second trigger for the same `(connection, kind)` joins the run in flight instead of doubling the work against the provider. A `queued` run is *not* in flight — it has not started — so it does not absorb a manual trigger.
3. **`sync_jobs` is consulted** (Ruling P2-C4): the run is stamped with its `job_id`, a kind whose job row says `enabled = false` is refused with `SyncDisabledError`, and the job's `cursor` is handed to the handler and written back **only** when the run succeeds (Ruling P2-C5).

- [ ] **Step 1: Write the failing test**

`src/modules/integrations/application/run-sync.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import type {
  IntegrationProvider,
  ProviderRegistry,
  SyncApplyContext,
  SyncFetchContext,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { drainSyncQueue } from "./drain-sync-queue";
import { enqueueSync } from "./enqueue-sync";
import { runSync } from "./run-sync";
import { ConnectionNotUsableError, SyncDisabledError, SyncNotSupportedError } from "./errors";

const principal = testPrincipal();
let fetched: SyncFetchContext[] = [];
let applied: SyncApplyContext[] = [];
let fetchImpl: (ctx: SyncFetchContext) => Promise<unknown>;
let applyImpl: (ctx: SyncApplyContext, payload: unknown) => Promise<Record<string, number>>;

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: (ctx) => {
          fetched.push(ctx);
          return fetchImpl(ctx);
        },
        apply: (ctx, payload) => {
          applied.push(ctx);
          return applyImpl(ctx, payload);
        },
      },
    },
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return testIntegrationDeps({ registry });
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
    fetched = [];
    applied = [];
    fetchImpl = async () => ["row-a", "row-b"];
    applyImpl = async () => ({ created: 2, updated: 1 });
  });

  it("fetches with the credential, applies with the database, and records the stats", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });

    expect(run.status).toBe("success");
    expect(run.stats).toEqual({ created: 2, updated: 1 });
    expect(run.finishedAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(run.jobId).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);

    // The credential reaches `fetch` and only `fetch`; `apply` has no field for it.
    expect(fetched[0]!.credentials).toEqual({ token: "t" });
    expect(fetched[0]!.connection.id).toBe(connection.id);
    expect(fetched[0]!.runId).toBe(run.id);
    expect(applied[0]!.runId).toBe(run.id);
    expect(Object.keys(applied[0]!)).not.toContain("credentials");

    const fresh = await deps.connections.getByProvider(principal.userId, "wallet");
    expect(fresh?.lastSyncAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(fresh?.status).toBe("connected");
  });

  it("hands `apply` exactly what `fetch` returned", async () => {
    const deps = makeDeps();
    await connected(deps);
    let seenPayload: unknown = null;
    fetchImpl = async () => ({ page: 1, rows: ["x"] });
    applyImpl = async (_ctx, payload) => {
      seenPayload = payload;
      return { created: 1 };
    };
    await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(seenPayload).toEqual({ page: 1, rows: ["x"] });
  });

  it("records a thrown fetch as a failed run and moves the connection to error", async () => {
    const deps = makeDeps();
    await connected(deps);
    fetchImpl = async () => {
      throw new Error("provider said no");
    };
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "cron" });
    expect(run.status).toBe("failed");
    expect(run.error).toBe("provider said no");
    expect(applied).toHaveLength(0);
    expect((await deps.connections.getByProvider(principal.userId, "wallet"))?.status).toBe("error");
  });

  it("persists a cursor on success and leaves it alone on failure", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const job = await deps.jobs.find(connection.id, "accounts");

    applyImpl = async (ctx) => {
      expect(ctx.cursor).toBeNull();
      ctx.setCursor({ since: "2026-09-04" });
      return { created: 1 };
    };
    await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect((await deps.jobs.find(connection.id, "accounts"))?.cursor).toEqual({ since: "2026-09-04" });

    // The next pass sees it…
    let saw: unknown = "not called";
    applyImpl = async (ctx) => {
      saw = ctx.cursor;
      ctx.setCursor({ since: "2026-09-05" });
      throw new Error("upstream fell over");
    };
    const failed = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(saw).toEqual({ since: "2026-09-04" });
    expect(failed.status).toBe("failed");
    // …and a failed pass must not advance it past rows it never imported.
    expect((await deps.jobs.find(connection.id, "accounts"))?.cursor).toEqual({ since: "2026-09-04" });
    expect(job!.id).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);
  });

  it("returns the running run instead of starting a second one", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const inFlight = await deps.runs.start({
      connectionId: connection.id,
      jobId: null,
      kind: "accounts",
      trigger: "cron",
      startedAt: new Date("2026-09-04T08:59:00Z"),
    });
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.id).toBe(inFlight.id);
    expect(run.status).toBe("running");
    expect(fetched).toHaveLength(0);
  });

  it("defaults the kind to the provider's only sync", async () => {
    const deps = makeDeps();
    await connected(deps);
    const run = await runSync(deps)(principal, { provider: "wallet", trigger: "manual" });
    expect(run.kind).toBe("accounts");
    expect(run.status).toBe("success");
  });

  it("refuses a kind the provider does not implement, a disabled job and a connection that is not connected", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "leave", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncNotSupportedError);

    const job = await deps.jobs.find(connection.id, "accounts");
    Object.assign(deps.jobs, { find: async () => ({ ...job!, enabled: false }) });
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncDisabledError);
    Object.assign(deps.jobs, { find: async () => job });

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

describe("the sync queue", () => {
  beforeEach(() => {
    fetched = [];
    applied = [];
    fetchImpl = async () => ["row-a"];
    applyImpl = async () => ({ created: 1 });
  });

  it("enqueues without doing the work, then drains it in the owner's context", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);

    const queued = await enqueueSync(deps)(connection, "accounts", "webhook");
    expect(queued.status).toBe("queued");
    expect(queued.trigger).toBe("webhook");
    expect(queued.jobId).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);
    // Nothing ran: that is the whole point of spec §3.4.
    expect(fetched).toHaveLength(0);

    const drained = await drainSyncQueue(deps)(10);
    expect(drained.map((r) => r.id)).toEqual([queued.id]);
    expect(drained[0]!.status).toBe("success");
    expect(fetched).toHaveLength(1);
    // The same row, executed — not a second one.
    expect(await deps.runs.queued(10)).toEqual([]);
    expect((await deps.runs.recent(connection.id, 10)).filter((r) => r.trigger === "webhook")).toHaveLength(1);
  });

  it("refuses to enqueue a disabled kind", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const job = await deps.jobs.find(connection.id, "accounts");
    Object.assign(deps.jobs, { find: async () => ({ ...job!, enabled: false }) });
    await expect(enqueueSync(deps)(connection, "accounts", "webhook")).rejects.toBeInstanceOf(
      SyncDisabledError,
    );
  });

  it("drops a queued run whose connection has gone, without failing the tick", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    await enqueueSync(deps)(connection, "accounts", "webhook");
    await deps.connections.delete(principal.userId, connection.id);
    // The run row outlives the connection only in memory; in Postgres the
    // cascade removes it. Either way the tick reports nothing and moves on.
    await expect(drainSyncQueue(deps)(10)).resolves.toEqual([]);
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
import type {
  IntegrationConnection,
  IntegrationProvider,
  ProviderCode,
  SyncHandler,
  SyncKind,
  SyncRun,
  SyncTrigger,
} from "@/platform/integrations/types";
import { isUsable, nextStatusAfterSync } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  SyncDisabledError,
  SyncNotSupportedError,
  UnknownProviderError,
} from "./errors";

export interface RunSyncInput {
  provider: ProviderCode;
  /**
   * Optional, and defaulted HERE rather than in each caller: the REST route,
   * the server action and the cron jobs all omit it in the single-sync case,
   * and three separate defaults would eventually disagree.
   */
  kind?: SyncKind;
  trigger: SyncTrigger;
}

interface Resolved {
  provider: IntegrationProvider;
  handler: SyncHandler;
  kind: SyncKind;
}

function resolve(deps: IntegrationDeps, input: RunSyncInput): Resolved {
  const provider = deps.registry.get(input.provider);
  if (!provider) throw new UnknownProviderError(`No integration named ${input.provider}`);
  const kind = input.kind ?? (Object.keys(provider.syncs)[0] as SyncKind | undefined);
  if (!kind) throw new SyncNotSupportedError(`${input.provider} has no sync to run`);
  const handler = provider.syncs[kind];
  if (!handler) throw new SyncNotSupportedError(`${input.provider} has no ${kind} sync`);
  return { provider, handler, kind };
}

interface Prepared {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
  jobId: string | null;
  cursor: unknown;
  run: SyncRun;
}

/**
 * Everything the provider call needs, gathered in ONE short transaction, plus
 * the `sync_runs` row that says the work has begun.
 *
 * `claimRunId` is set only by `resumeQueuedSync`: instead of inserting a new
 * run it moves an existing `queued` one to `running`, conditionally, so two
 * ticks racing the same queued row execute it once. It returns `null` when it
 * loses that race, and `{ joined }` when a run for this (connection, kind) is
 * already in flight.
 */
async function prepare(
  d: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  claimRunId: string | null,
): Promise<Prepared | { joined: SyncRun } | null> {
  const connection = await d.connections.getByProvider(userId, input.provider);
  if (!connection) throw new ConnectionNotFoundError(`${input.provider} is not connected`);
  if (!isUsable(connection)) {
    throw new ConnectionNotUsableError(`${input.provider} is ${connection.status}; reconnect it first`);
  }

  // Ruling P2-C4: `sync_jobs` is where a kind is switched off without
  // disconnecting the provider, and where its cursor lives.
  const job = await d.jobs.find(connection.id, kind);
  if (job && !job.enabled) {
    throw new SyncDisabledError(`${input.provider}'s ${kind} sync is switched off`);
  }

  // Idempotent per running job (spec §6): a second trigger joins the run in
  // flight rather than doubling the work against the provider. A `queued` run
  // is not in flight — nothing has started — so it does not absorb a trigger.
  const inFlight = await d.runs.running(connection.id, kind);
  if (inFlight) return { joined: inFlight };

  const sealed = await d.connections.readCredentials(userId, connection.id);
  if (!sealed) throw new ConnectionNotFoundError(`${input.provider} has no stored credential`);

  const startedAt = d.clock.now();
  const run = claimRunId
    ? await d.runs.claim(claimRunId, startedAt)
    : await d.runs.start({
        connectionId: connection.id,
        jobId: job?.id ?? null,
        kind,
        trigger: input.trigger,
        startedAt,
      });
  if (!run) return null;

  return {
    connection,
    credentials: d.cipher.open(sealed),
    jobId: job?.id ?? null,
    cursor: job?.cursor ?? null,
    run,
  };
}

/**
 * The provider round trip and then the write — in that order, and with nothing
 * open in between.
 *
 * `fetch` runs with no transaction at all, which is the rule Task 2 introduced
 * and the two-phase `SyncHandler` makes structural. `apply` gets one
 * transaction, and it also carries the bookkeeping: the run row, the
 * connection's stamps, the cursor and the audit line all commit or none of them
 * do. A handler that throws still produces a finished `sync_runs` row and a
 * connection in `error` — a run that vanished without a row would be
 * indistinguishable from one that never started.
 */
async function execute(
  deps: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  handler: SyncHandler,
  prepared: Prepared,
): Promise<SyncRun> {
  let payload: unknown;
  try {
    payload = await handler.fetch({
      connection: prepared.connection,
      credentials: prepared.credentials,
      runId: prepared.run.id,
      clock: deps.clock,
      cursor: prepared.cursor,
    });
  } catch (err) {
    return recordFailure(deps, userId, input, kind, prepared, err);
  }

  try {
    return await deps.inUserContext(userId, async (d) => {
      let cursor = prepared.cursor;
      const stats = await handler.apply(
        {
          connection: prepared.connection,
          runId: prepared.run.id,
          db: d.db,
          clock: d.clock,
          cursor,
          setCursor: (next) => {
            cursor = next;
          },
          audit: d.audit,
        },
        payload,
      );
      const finishedAt = d.clock.now();
      await d.runs.finish(prepared.run.id, { status: "success", stats, error: null, finishedAt });
      // Ruling P2-C5: the cursor advances only on success.
      if (prepared.jobId && cursor !== prepared.cursor) await d.jobs.setCursor(prepared.jobId, cursor);
      await d.connections.recordState(prepared.connection.id, {
        status: nextStatusAfterSync(false),
        lastSyncAt: finishedAt,
        lastError: null,
      });
      await d.audit({
        actorUserId: userId,
        action: "integration.sync",
        entityType: "sync_run",
        entityId: prepared.run.id,
        after: { provider: input.provider, kind, trigger: prepared.run.trigger, ...stats },
      });
      return { ...prepared.run, status: "success" as const, stats, finishedAt };
    });
  } catch (err) {
    return recordFailure(deps, userId, input, kind, prepared, err);
  }
}

/** One place decides what a failed run looks like, so the two catch sites cannot drift. */
async function recordFailure(
  deps: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  prepared: Prepared,
  err: unknown,
): Promise<SyncRun> {
  const error = err instanceof Error ? err.message : String(err);
  return deps.inUserContext(userId, async (d) => {
    const finishedAt = d.clock.now();
    await d.runs.finish(prepared.run.id, { status: "failed", stats: {}, error, finishedAt });
    await d.connections.recordState(prepared.connection.id, {
      status: nextStatusAfterSync(true),
      lastError: error,
    });
    await d.audit({
      actorUserId: userId,
      action: "integration.sync_failed",
      entityType: "sync_run",
      entityId: prepared.run.id,
      after: { provider: input.provider, kind, trigger: prepared.run.trigger, error },
    });
    return { ...prepared.run, status: "failed" as const, error, finishedAt };
  });
}

export function runSyncForUser(deps: IntegrationDeps) {
  return async (userId: string, input: RunSyncInput): Promise<SyncRun> => {
    const { handler, kind } = resolve(deps, input);
    const prepared = await deps.inUserContext(userId, (d) => prepare(d, userId, input, kind, null));
    // `prepare` only answers null when it lost a claim, and nothing is claimed
    // on this path — `runs.start` always returns a row.
    if (prepared === null) throw new ConnectionNotFoundError(`${input.provider} sync could not be started`);
    if ("joined" in prepared) return prepared.joined;
    return execute(deps, userId, input, kind, handler, prepared);
  };
}

/**
 * Executes a run that already exists as `queued` (spec §3.4). Null when another
 * tick claimed it first, or when a manual sync for the same kind is already
 * running — both mean "somebody else is doing it", which is not an error.
 */
export function resumeQueuedSync(deps: IntegrationDeps) {
  return async (userId: string, input: RunSyncInput, runId: string): Promise<SyncRun | null> => {
    const { handler, kind } = resolve(deps, input);
    const prepared = await deps.inUserContext(userId, (d) => prepare(d, userId, input, kind, runId));
    if (prepared === null || "joined" in prepared) return null;
    return execute(deps, userId, input, kind, handler, prepared);
  };
}

export function runSync(deps: IntegrationDeps) {
  return async (principal: Principal, input: RunSyncInput): Promise<SyncRun> => {
    assertPermission(principal, "integrations.manage");
    return runSyncForUser(deps)(principal.userId, input);
  };
}
```

- [ ] **Step 4: Write the queue: enqueue and drain**

`src/modules/integrations/application/enqueue-sync.ts`:
```ts
import type {
  IntegrationConnection,
  SyncKind,
  SyncRun,
  SyncTrigger,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { SyncDisabledError } from "./errors";

/**
 * Spec §3.4: an inbound webhook "enqueues a job row rather than doing work
 * inline" (Ruling P2-C3). This is that row.
 *
 * It runs in whatever context the caller already has open — the webhook route's
 * system context — because it writes nothing but a `sync_runs` row against a
 * connection the caller has just verified. The work itself is deliberately NOT
 * done here: a webhook request must not hold open a database transaction while
 * a provider is called back, and it must not run a user's sync under
 * `app.role = 'system'`.
 */
export function enqueueSync(deps: IntegrationDeps) {
  return async (
    connection: IntegrationConnection,
    kind: SyncKind,
    trigger: SyncTrigger,
  ): Promise<SyncRun> => {
    const job = await deps.jobs.find(connection.id, kind);
    if (job && !job.enabled) {
      throw new SyncDisabledError(`${connection.provider}'s ${kind} sync is switched off`);
    }
    return deps.runs.enqueue({
      connectionId: connection.id,
      jobId: job?.id ?? null,
      kind,
      trigger,
      queuedAt: deps.clock.now(),
    });
  };
}
```

`src/modules/integrations/application/drain-sync-queue.ts`:
```ts
import type { SyncRun } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { resumeQueuedSync } from "./run-sync";

/**
 * Runs the syncs a webhook queued, each in its own connection owner's user
 * context.
 *
 * This is the half of Ruling P2-C3 that makes the webhook safe. The queue is
 * *read* in the system context — a tick has no principal, and a queued row may
 * belong to anybody — but nothing is *written* there: the connection's
 * `user_id` is looked up and the sync runs under it, so RLS applies to every
 * row the sync touches and the audit trail names the person, not the system.
 *
 * One failed run never stops the tick: the run row already records what went
 * wrong, and a queue that stalls on its first bad entry is a queue that never
 * drains again.
 */
export function drainSyncQueue(deps: IntegrationDeps) {
  return async (limit = 20): Promise<SyncRun[]> => {
    const queued = await deps.inSystemContext((d) => d.runs.queued(limit));
    const done: SyncRun[] = [];

    for (const row of queued) {
      const connection = await deps.inSystemContext((d) => d.connections.getById(row.connectionId));
      if (!connection) continue;
      const run = await resumeQueuedSync(deps)(
        connection.userId,
        { provider: connection.provider, kind: row.kind, trigger: row.trigger },
        row.id,
      );
      if (run) done.push(run);
    }

    return done;
  };
}
```

- [ ] **Step 5: Register the tick that drains it**

`src/lib/jobs/sync-queue.ts`:
```ts
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { drainSyncQueue } from "@/modules/integrations/application/drain-sync-queue";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";

export const JOB_NAME = "sync_queue" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunSyncQueueInput {
  trigger?: "cron" | "manual";
}

/**
 * Drains the `sync_runs` rows a webhook queued (spec §3.4).
 *
 * Deliberately quiet and deliberately un-alerting: an empty queue is the normal
 * state, and a run that failed has already recorded why on its own row — the
 * Integrations page shows it, and alerting here would duplicate that hourly.
 * The advisory lock is belt and braces: `runs.claim` already makes a double
 * execution impossible, so a second tick would simply find nothing.
 */
export async function runSyncQueue(input: RunSyncQueueInput = {}): Promise<JobResult> {
  ensureProvidersRegistered();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });
  try {
    const drained = await withJobLock(LOCK_KEY, () => drainSyncQueue(integrationDeps(db))(20));
    if (drained === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    if (drained.length === 0) {
      const skipped = { reason: "queue_empty" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const detail = {
      drained: drained.length,
      failed: drained.filter((r) => r.status === "failed").length,
    };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
```
In `src/lib/contracts.ts`, add `| "sync_queue"` to `JobName`. In `src/platform/jobs/register-all.ts`, add:
```ts
  registerJob({ name: "sync_queue", tier: "hourly", run: (i) => runSyncQueue({ trigger: i.trigger }) });
```

`src/lib/jobs/sync-queue.test.ts` — mock `@/lib/repo/jobs` the way `wallet-accounts-sync.test.ts` does, mock `@/modules/integrations/application/drain-sync-queue`, and assert the three outcomes:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
    APP_ENCRYPTION_KEY: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  });
  return { runs: [] as { id: number; status: string; detail: unknown; error: string | null }[], nextId: 1, lockHeld: false, drained: [] as { status: string }[] };
});

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => {
    const row = { id: store.nextId++, status: "running", detail: null, error: null };
    store.runs.push(row);
    return row;
  }),
  finishRun: vi.fn(async (id: number, status: string, extra?: { detail?: unknown; error?: string }) => {
    const row = store.runs.find((r) => r.id === id)!;
    row.status = status;
    row.detail = extra?.detail ?? null;
    row.error = extra?.error ?? null;
  }),
  withJobLock: vi.fn(async <T,>(_k: string, fn: () => Promise<T>) => (store.lockHeld ? null : fn())),
}));
vi.mock("@/modules/integrations/application/drain-sync-queue", () => ({
  drainSyncQueue: () => async () => store.drained,
}));
vi.mock("@/platform/integrations/register-all", () => ({ ensureProvidersRegistered: () => {} }));

import { runSyncQueue } from "./sync-queue";

describe("runSyncQueue", () => {
  beforeEach(() => {
    store.runs = [];
    store.nextId = 1;
    store.lockHeld = false;
    store.drained = [];
  });

  it("reports an empty queue as already_done", async () => {
    const result = await runSyncQueue();
    expect(result.status).toBe("already_done");
    expect(result.detail).toEqual({ reason: "queue_empty" });
    expect(store.runs[0]!.status).toBe("already_done");
  });

  it("counts what it drained, failures included", async () => {
    store.drained = [{ status: "success" }, { status: "failed" }];
    const result = await runSyncQueue();
    expect(result.status).toBe("success");
    expect(result.detail).toEqual({ drained: 2, failed: 1 });
  });

  it("stands down when another tick holds the lock", async () => {
    store.lockHeld = true;
    const result = await runSyncQueue();
    expect(result.detail).toEqual({ reason: "lock_not_acquired" });
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test -- integrations sync-queue`
Expected: PASS — 14 new cases: `run-sync.test.ts` 11 (8 under `describe("runSync")`, 3 under `describe("the sync queue")`) and `sync-queue.test.ts` 3.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): sync engine, queued runs and the tick that drains them"
```

---
### Task 11: Port the Wallet adapter onto the framework

**Files:**
- Modify: `dashboard-app/src/lib/clients/wallet.ts`, `wallet.test.ts`
- Modify: `dashboard-app/src/modules/accounts/infrastructure/wallet-adapter.ts`, `wallet-adapter.test.ts`
- Create: `dashboard-app/src/platform/auth/owner.ts`, `owner.itest.ts`
- Create: `dashboard-app/src/platform/integrations/register-all.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/wallet-provider-adapter.ts`, `wallet-provider-adapter.test.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/owner-connection.ts`
- Modify: `dashboard-app/src/lib/jobs/wallet-accounts-sync.ts`, `wallet-accounts-sync.test.ts`
- Modify: `dashboard-app/src/lib/jobs/wallet-refresh.ts`, `wallet-refresh.test.ts`
- Modify: `dashboard-app/src/modules/accounts/api/routes.ts`, `api/schemas.ts`, `routes.itest.ts` (the Phase-1 wallet route goes)
- Modify: `dashboard-app/src/modules/accounts/application/sync-provider-accounts.ts`, `sync-provider-accounts.test.ts` (`assertWalletSyncAllowed` goes)
- Modify: `dashboard-app/src/app/actions/accounts.ts`, `accounts.test.ts` (`syncWalletAction` goes)
- Modify: `dashboard-app/src/modules/accounts/ui/AccountsToolbar.tsx`
- Modify: `docs/api/openapi.json` (regenerated — a route is removed)

**Why the Phase-1 wallet sync route and action are deleted *here*.** `walletAccountsSource(clock)` gains a `token` parameter in this task, and its two remaining call sites — `accounts/api/routes.ts` and `actions/accounts.ts` — have no credential to give it: the vault needs a connection, and neither has any connection-resolution code. Leaving them for Task 14 would mean this task's own `npm run typecheck` step could not pass. They are removed in the same commit as the signature change, so every commit type-checks and the "sync now" affordance points at Settings until Task 18 wires the new action. Ruling P2-7 (retiring R10/R18) is therefore discharged here rather than in Task 14.

**Interfaces:**
- Consumes: `IntegrationProvider`/`SyncHandler`/`SyncFetchContext`/`SyncApplyContext` from `@/platform/integrations/types`, `openConnection` from `@/modules/integrations/application/open-connection`, `runSyncForUser` from `@/modules/integrations/application/run-sync`, `integrationDeps` from `@/modules/integrations/infrastructure/deps`, `syncProviderAccounts` and `walletAccountsSource` from the accounts module.
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

// src/modules/integrations/infrastructure/owner-connection.ts
export interface OwnerConnection extends OpenedConnection { userId: string }
/** The owner's connection for a provider, with its credential open. Null when it is not usable. */
export function openOwnerConnection(provider: ProviderCode): Promise<OwnerConnection | null>;

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

  it("has a daily accounts sync in two phases, and no leave sync", () => {
    const accounts = walletProvider.syncs.accounts;
    expect(accounts?.schedule).toBe("daily");
    expect(typeof accounts?.fetch).toBe("function");
    expect(typeof accounts?.apply).toBe("function");
    expect(walletProvider.syncs.leave).toBeUndefined();
  });

  it("fetches with the credential and nothing else", async () => {
    const rows = await walletProvider.syncs.accounts!.fetch({
      connection: connectionFixture(),
      credentials: { token: "good" },
      runId: "r1",
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      cursor: null,
    });
    // One `ProviderAccount`, already mapped out of Wallet's own shape — the
    // apply phase never sees a Wallet field. (`mapWalletAccount` itself is
    // exhaustively covered by `wallet-adapter.test.ts`; this asserts only that
    // `fetch` maps and does not hand the raw payload on.)
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "w1",
      name: "ING - Salary",
      currency: "EUR",
      archived: false,
      balance: "1234.50",
      asOf: "2026-09-04",
    });
    expect(rows[0]).not.toHaveProperty("accountType");
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
    expect(walletProvider.webhook!.toSyncRequests({})).toEqual([{ kind: "accounts", event: "unknown" }]);
  });
});
```
with, above the `describe`, the one fixture the fetch case needs:
```ts
import type { IntegrationConnection } from "@/platform/integrations/types";

function connectionFixture(): IntegrationConnection {
  return {
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
}
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
There are exactly four call sites, and all four are settled in this task:
- `wallet-adapter.test.ts` — passes `"test-token"`.
- `wallet-provider-adapter.ts` (Step 6) — passes `ctx.credentials.token`.
- `src/modules/accounts/api/routes.ts` and `src/app/actions/accounts.ts` — **deleted** in Step 5b, because neither has a credential to pass and neither has any way to get one.

Also export the token-free variant the apply phase needs:
```ts
/**
 * An `AccountsSource` over accounts that have already been fetched.
 *
 * The sync engine's apply phase has the rows but, by design, no credential —
 * and `syncProviderAccounts` still needs a `source` for its `provider` field.
 * This is that source: it names the provider and hands back what it was given.
 */
export function prefetchedWalletSource(accounts: readonly ProviderAccount[]): AccountsSource {
  return {
    provider: WALLET_PROVIDER,
    fetchAccounts: async () => [...accounts],
  };
}
```

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
import { hmacSignatureVerifier, webhookEventName } from "@/platform/integrations/webhook-signature";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncApplyContext,
  SyncFetchContext,
  SyncHandler,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { deletionDecision } from "@/modules/accounts/domain/account";
import type { ProviderAccount } from "@/modules/accounts/application/ports";
import { syncProviderAccounts } from "@/modules/accounts/application/sync-provider-accounts";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import {
  prefetchedWalletSource,
  walletAccountsSource,
  WALLET_PROVIDER,
} from "@/modules/accounts/infrastructure/wallet-adapter";

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

/**
 * The accounts sync, split where the network is.
 *
 * `fetch` is one Wallet round trip and runs with no transaction open; `apply`
 * is the whole reconciliation and runs inside one. That is the shape Task 2
 * established for this exact call — a Wallet that takes twelve seconds must not
 * hold a pool connection (and, in a job, an advisory lock) for twelve seconds.
 *
 * Wallet's accounts API is a full listing with no pagination, so there is
 * nothing to carry between passes and this handler never sets a cursor.
 */
const accountsSync: SyncHandler<ProviderAccount[]> = {
  schedule: "daily",

  async fetch(ctx: SyncFetchContext): Promise<ProviderAccount[]> {
    return walletAccountsSource(ctx.clock, ctx.credentials.token!).fetchAccounts();
  },

  async apply(ctx: SyncApplyContext, incoming: ProviderAccount[]): Promise<Record<string, number>> {
    const deps = accountDeps(ctx.db);
    const source = prefetchedWalletSource(incoming);
    const result = await syncProviderAccounts({ ...deps, source })(ctx.connection.userId, incoming);
    return { ...result };
  },
};

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

  // `purge` marks every link missing FIRST, so the loop below really is looking
  // at accounts with no live provider link — which is what lets it pass
  // `hasLiveProviderLink: false` to `deletionDecision` and mean it. An empty
  // seen list marks them all.
  if (ctx.policy === "purge") {
    await deps.links.markMissing(ctx.connection.userId, WALLET_PROVIDER, "account", [], now);
  }

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

  // Through `ctx.audit`, not `recordAudit(ctx.db, …)`: the port exists so a
  // test can observe the line, and Trek's adapter already uses it.
  await ctx.audit({
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
  syncs: { accounts: accountsSync },
  webhook: {
    // Both shared, because both were identical in the Trek adapter: see
    // `src/platform/integrations/webhook-signature.ts`.
    verify: hmacSignatureVerifier(),
    toSyncRequests: (payload): SyncRequest[] => [
      { kind: "accounts", event: webhookEventName(payload) },
    ],
  },
  onDisconnect,
};
```
`credentialSchema`'s inferred output has `webhookSecret: string`, which satisfies `ZodType<Record<string, string>>`.

- [ ] **Step 7: Register the provider and add the owner front door**

`src/modules/integrations/infrastructure/owner-connection.ts`:
```ts
import { db } from "@/lib/db";
import { ownerUserId } from "@/platform/auth/owner";
import type { ProviderCode } from "@/platform/integrations/types";
import {
  openConnection,
  type OpenedConnection,
} from "@/modules/integrations/application/open-connection";
import { integrationDeps } from "./deps";

export interface OwnerConnection extends OpenedConnection {
  userId: string;
}

/**
 * The household owner's connection for a provider, with its credential open.
 *
 * The three scheduled jobs all begin the same way — find the owner, find their
 * connection, check it is usable, open the credential — and this is that
 * sequence, once. `null` means "this integration is not set up", which every
 * caller records as a skipped run rather than a failure.
 *
 * Still owner-only because the cron tiers are process-wide: per-user schedules
 * arrive when `sync_jobs` becomes dispatchable in a later phase.
 */
export async function openOwnerConnection(provider: ProviderCode): Promise<OwnerConnection | null> {
  const userId = await ownerUserId(db);
  if (!userId) return null;
  const opened = await openConnection(integrationDeps(db))(userId, provider);
  return opened ? { userId, ...opened } : null;
}
```

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
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { runSyncForUser } from "@/modules/integrations/application/run-sync";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openOwnerConnection } from "@/modules/integrations/infrastructure/owner-connection";

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
  const run = await runSyncForUser(integrationDeps(db))(userId, {
    provider: "wallet",
    kind: "accounts",
    trigger: "cron",
  });
  if (run.status === "failed") throw new Error(run.error ?? "wallet accounts sync failed");
  return { runId: run.id, status: run.status, ...run.stats };
}

/** Never throws. Every path ends in a `job_runs` row and a `JobResult`. */
export async function runWalletAccountsSync(input: RunWalletAccountsSyncInput = {}): Promise<JobResult> {
  ensureProvidersRegistered();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });

  try {
    // No owner, no connection, an unusable connection and a missing credential
    // are all the same answer: nothing to sync. A configuration state, not a
    // failure — recorded so the run log explains the silence, never alerted on.
    const owner = await openOwnerConnection("wallet");
    if (!owner) {
      const skipped = { reason: "wallet_not_connected" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = await withJobLock(LOCK_KEY, () => syncOwner(owner.userId));
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
`src/lib/jobs/wallet-refresh.ts` — `refresh(now)` becomes `refresh(now, token)` and calls `getBalances({ token })`; `runWalletRefresh` resolves the owner's credential through the same front door, before taking the lock:
```ts
    const owner = await openOwnerConnection("wallet");
    const token = owner?.credentials.token;
    if (!token) {
      const skipped = { reason: "wallet_not_connected" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
```
then `withJobLock(LOCK_KEY, () => refresh(now, token))`.

**The two job tests.** Both already mock `@/lib/clients/wallet` and `@/lib/repo/jobs`. Mock **two more modules and no others** — `@/modules/integrations/infrastructure/owner-connection` and, for the accounts sync, `@/modules/integrations/application/run-sync`. Mocking `integrationDeps` instead would drag `credentialCipher()` and the whole environment into a unit test; mocking the owner helper and the engine keeps the test about what this file owns, which is the `job_runs` bookkeeping.

Add `APP_ENCRYPTION_KEY: \`k1:${Buffer.alloc(32, 1).toString("base64")}\`` to the `vi.hoisted` env block in both files — `integrationDeps(db)` is still *constructed* as an argument even when `runSyncForUser` is mocked, and constructing it calls `credentialCipher()`.

In `wallet-accounts-sync.test.ts`:
```ts
vi.mock("@/modules/integrations/infrastructure/owner-connection", () => ({
  openOwnerConnection: vi.fn(async () =>
    store.connected
      ? {
          userId: "00000000-0000-7000-8000-000000000001",
          connection: { id: "c1", provider: "wallet", status: "connected" },
          credentials: { token: "test-token" },
        }
      : null,
  ),
}));
vi.mock("@/modules/integrations/application/run-sync", () => ({
  runSyncForUser: () => async () => store.syncRun,
}));
vi.mock("@/platform/integrations/register-all", () => ({ ensureProvidersRegistered: () => {} }));
```
with `connected: true` and `syncRun: { id: "r1", status: "success", stats: { created: 2 }, error: null }` on the hoisted `store`. Keep every existing assertion about `job_runs` states, and replace the old `tokenConfigured: false` case with `store.connected = false`, still expecting `already_done` — its `reason` is now `wallet_not_connected` rather than `wallet_not_configured`. Add one case asserting that a `failed` sync run makes the job `failed` and calls `alertJobFailure`.

`wallet-refresh.test.ts` mocks only `owner-connection` (it calls `getBalances` directly, which is already mocked) and asserts that the token reaches `getBalances({ token: "test-token" })`.

- [ ] **Step 9: Delete the Phase-1 wallet sync route and action**

These are the last two `walletAccountsSource(clock)` call sites, and Ruling P2-7 retires the rulings that shaped them.

In `src/modules/accounts/api/routes.ts`, delete `walletSyncRoute`, its `app.openapi(walletSyncRoute, …)` handler, and the imports that become unused: `walletToken` from `@/lib/env`, `assertWalletSyncAllowed`, `syncProviderAccounts`, `walletAccountsSource`, `UseCaseDeps`, `WalletSyncResultSchema`, and `UpstreamError` **only if** nothing else in the file still names it (`toApiError` does — keep it). Delete `WalletSyncResultSchema` from `src/modules/accounts/api/schemas.ts`.

In `src/modules/accounts/api/routes.itest.ts`, delete the two wallet-sync cases — the happy path and `"wallet sync answers 503 integration_unavailable when Wallet has no token configured"` (`routes.itest.ts:227`). The replacement coverage is Task 14's own `integrations/api/routes.itest.ts`.

In `src/modules/accounts/application/sync-provider-accounts.ts`, delete `assertWalletSyncAllowed` and its now-unused `assertPermission`/`PermissionDeniedError`/`Principal` imports; delete the cases covering it from `sync-provider-accounts.test.ts` along with the `testPrincipal`/`PermissionDeniedError` imports. A connection has an owner of its own now, and `integrations.manage` on it is the whole check.

In `src/app/actions/accounts.ts`, delete `syncWalletAction`, the `walletToken` and `walletAccountsSource` imports and the `SyncProviderAccountsResult` type import; delete its cases from `accounts.test.ts`.

In `src/modules/accounts/ui/AccountsToolbar.tsx`, drop the `syncWalletAction` import, the `sync()` function, the `pending` transition and the `error` state, and render the same link in both variants:
```tsx
        <Link href="/settings" className={SECONDARY}>
          {variant === "header" ? "Manage Budget Makers Wallet" : "Connect Budget Makers Wallet"}
        </Link>
```
Task 18 points both at `/settings/integrations/wallet` and gives the header variant a real "Sync now" again, once there is an action to call.

Then regenerate the API document, because a route has gone:
```bash
npm run openapi:generate
```

- [ ] **Step 10: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration && grep -rn "walletToken(" src`
Expected: tests PASS — including the OpenAPI drift test, which is green because Step 9 regenerated the document in this same commit. `wallet.test.ts`, `wallet-adapter.test.ts`, `wallet-accounts-sync.test.ts` and `wallet-refresh.test.ts` still assert the same behaviour; only their credential plumbing changed. The grep matches **only** `src/lib/env.ts`, where the function is still declared until Task 19 removes it.

- [ ] **Step 11: Commit**

```bash
git add -A ../docs
git commit -m "feat(integrations): Budget Makers Wallet on the integration framework"
```

---

### Task 12: Port the Trek adapter onto the framework

**Files:**
- Modify: `dashboard-app/src/lib/clients/trek.ts`, `trek.test.ts`
- Modify: `dashboard-app/src/lib/jobs/trek-sync.ts`, `trek-sync.test.ts`
- Modify: `dashboard-app/src/lib/jobs/trek-sync-job.ts`, `trek-sync-job.test.ts`
- Create: `dashboard-app/src/modules/integrations/infrastructure/trek-provider-adapter.ts`, `trek-provider-adapter.test.ts`
- Create: `dashboard-app/src/modules/integrations/ui/principal-connection.ts`
- Modify: `dashboard-app/src/platform/integrations/register-all.ts`
- Modify: `dashboard-app/src/app/actions/leave.ts`, `leave.test.ts`
- Modify: `dashboard-app/src/app/(app)/work/_lib/leave.ts`, `leave.test.ts`

**Every live user of the three symbols this task deletes.** `trekConfigured()`, `TrekNotConfiguredError` and `isTrekNotConfigured()` are read in ten files, and each gets an explicit edit below. Confirm the list before starting and again after:
```bash
grep -rn "trekConfigured\|isTrekNotConfigured\|TrekNotConfiguredError" src
```

| File | Line(s) today | What this task does |
|---|---|---|
| `src/lib/clients/trek.ts` | 107–125 | Step 3 deletes all three plus the private `config()` |
| `src/lib/clients/trek.test.ts` | 37, 429 | Step 3 drops the import and the `expect(trekConfigured()).toBe(false)` case |
| `src/lib/jobs/trek-sync.ts` | 25–26, 117, 211 | Step 4 removes the import, the guard and the `isTrekNotConfigured(err)` catch branch |
| `src/lib/jobs/trek-sync.test.ts` | 13, 17, 89–90, 139, 149, 159, 170 | Step 4 removes the two mock entries and the four unconfigured cases |
| `src/lib/jobs/trek-sync-job.ts` | 31, 68 | Step 6 replaces the guard with `openOwnerConnection("trek")` |
| `src/lib/jobs/trek-sync-job.test.ts` | 63, 72, 95, 113 | Step 6 swaps the mock for `owner-connection` |
| `src/app/actions/leave.ts` | 6, 180 | Step 7 resolves the connection instead |
| `src/app/actions/leave.test.ts` | 17, 55 | Step 7 swaps the mock for `principal-connection` |
| `src/app/(app)/work/_lib/leave.ts` | 1, 139 | Step 7 sets `configured` from the connection |
| `src/app/(app)/work/_lib/leave.test.ts` | 21 | Step 7 swaps the mock for `principal-connection` |

`src/platform/capabilities/probes.ts:52` and `resolve.ts:23` also carry the *name* `trekConfigured`, but they are a different symbol — a method on `CapabilityProbes`, backed by `trekConfig()` from `@/lib/env`. Task 16 replaces those; this task must not touch them.

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
/** The result a caller with no Trek connection reports. Keeps `TrekSyncStatus["disabled"]` alive with a real caller. */
export function disabledTrekSync(year: number): TrekSyncResult;

// src/modules/integrations/ui/principal-connection.ts
export function openPrincipalConnection(provider: ProviderCode): Promise<OpenedConnection | null>;
export function isProviderConnectedForPrincipal(provider: ProviderCode): Promise<boolean>;

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

  it("runs a leave sync in the fetch phase and reports the pass counts as stats", async () => {
    // Trek's sync owns its own advisory lock and its own database connection
    // (see `trek-sync.ts`), so ALL of it belongs to `fetch`; `apply` only reads
    // the counts off the result and never touches `ctx.db`.
    const leave = trekProvider.syncs.leave!;
    expect(leave.schedule).toBe("hourly");
    const pass = await leave.fetch({
      connection: connectionFixture(),
      credentials: { baseUrl: "https://trek.example", token: "trek_good" },
      runId: "r1",
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      cursor: null,
    });
    const stats = await leave.apply(
      {
        connection: connectionFixture(),
        runId: "r1",
        db: unusedDb,
        clock: { now: () => new Date("2026-09-04T09:00:00Z") },
        cursor: null,
        setCursor: () => {
          throw new Error("the leave sync has no cursor to set");
        },
        audit: async () => {},
      },
      pass,
    );
    expect(stats).toEqual({ pulled: 3, deleted: 0, pushed: 1 });
  });

  it("fails the run when the pass was partial, so the last-sync stamp cannot stay green", async () => {
    const leave = trekProvider.syncs.leave!;
    const partial = {
      status: "partial" as const,
      year: 2026,
      pulled: 1,
      deleted: 0,
      pushed: 0,
      weekendBlocked: [],
      stillPending: ["2026-09-10"],
      stats: null,
      errors: ["Trek refused 2026-09-10"],
    };
    await expect(
      leave.apply(
        {
          connection: connectionFixture(),
          runId: "r1",
          db: unusedDb,
          clock: { now: () => new Date("2026-09-04T09:00:00Z") },
          cursor: null,
          setCursor: () => {},
          audit: async () => {},
        },
        partial,
      ),
    ).rejects.toThrow(/Trek refused 2026-09-10/);
  });

  it("leaves leave data alone on every disconnect policy", async () => {
    const audits: string[] = [];
    await trekProvider.onDisconnect({
      connection: { ...connectionFixture(), disconnectPolicy: "purge" },
      policy: "purge",
      db: unusedDb,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async (e) => {
        audits.push(e.action);
      },
    });
    expect(audits).toEqual(["integration.disconnect_applied"]);
  });
});
```
with, above the `describe`, the shared fixture and the shared unusable client:
```ts
import { unusedDb } from "@/test/integration-deps";
import type { IntegrationConnection } from "@/platform/integrations/types";

function connectionFixture(): IntegrationConnection {
  return {
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
  };
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- trek-provider-adapter`
Expected: FAIL — `Cannot find module './trek-provider-adapter'`.

- [ ] **Step 3: Make the Trek client take its credential**

In `src/lib/clients/trek.ts`:
- Add `config: TrekConfig;` as the first member of `TrekCallOptions`, with the same doc comment shape as the Wallet client's `token`.
- Delete `function config()` (line 122), `trekConfigured()` (118), `TrekNotConfiguredError` (107) and `isTrekNotConfigured()` (114), and change the import on line 66 from `import { trekConfig, type TrekConfig } from "@/lib/env";` to `import type { TrekConfig } from "@/lib/env";`.
- In `getEntries`, `getStats` and `applyDesiredState`, replace `const cfg = config();` with `const cfg = opts.config;`.
- Update the module doc comment: the transport paragraph still says the token comes from `TREK_TOKEN_FILE`. It comes from the connection's credential now.
- In `trek.test.ts`, drop `trekConfigured` from the import on line 37 and delete the case at line 429 that asserts `expect(trekConfigured()).toBe(false)` — the question it asked is now asked of `integration_connections`, and Task 16's capability test asks it. Replace the token-file/env fixture with a literal `const CONFIG = { baseUrl: "https://trek.example", token: "trek_test" };` and pass `{ config: CONFIG, ... }` at every call site. The `resetTrekAuthCache()` calls stay: the session cache is still per credential fingerprint.

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

/**
 * The result a caller reports when there is no Trek connection at all.
 *
 * `runTrekSync` used to answer this itself, from `trekConfigured()`. It cannot
 * any more — "is Trek set up" is a question about `integration_connections`,
 * which this module knows nothing about — so the answer moved to the callers
 * that *can* ask it, and this is the shape they hand back. `TrekSyncStatus`
 * keeps its `"disabled"` member and the Work page keeps rendering "Trek sync is
 * off" from it; only the place the decision is taken has changed.
 */
export function disabledTrekSync(year: number): TrekSyncResult {
  return empty("disabled", year);
}
```
Delete the `trekConfigured()` guard on line 117, the `isTrekNotConfigured` import (line 25) and `trekConfigured` (line 26), **and** the `if (isTrekNotConfigured(err)) return empty("disabled", year);` branch in `syncPass`'s catch at line 211 — that error class no longer exists, and a caller with no connection never reaches this function. Inside `syncPass`, `const opts = input.call;` (no `?? {}`).

Update `trek-sync.test.ts`: drop `trekConfigured` (line 13) and `isTrekNotConfigured` (line 17) from the `@/lib/clients/trek` mock factory and the two `mockReturnValue` lines in `beforeEach` (89–90); delete the four cases that drove them (the `disabled` assertions at 139/149/153, 159, and 170/173). Every remaining `runTrekSync({...})` gains `call: { config: CONFIG, sleep: async () => {} }`. Add one case for the new export:
```ts
  it("disabledTrekSync describes an untouched year", () => {
    expect(disabledTrekSync(2026)).toEqual({
      status: "disabled",
      year: 2026,
      pulled: 0,
      deleted: 0,
      pushed: 0,
      weekendBlocked: [],
      stillPending: [],
      stats: null,
      errors: [],
    });
  });
```

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
import { runTrekSync, type TrekSyncResult } from "@/lib/jobs/trek-sync";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncApplyContext,
  SyncFetchContext,
  SyncHandler,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { hmacSignatureVerifier, webhookEventName } from "@/platform/integrations/webhook-signature";

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

/**
 * The leave sync.
 *
 * All of the work is in `fetch`, which looks odd until you read `trek-sync.ts`:
 * a pass is a read → diff → toggle conversation that takes its OWN advisory
 * lock on its OWN database connection, and it must not run inside somebody
 * else's transaction. Putting it in `fetch` — the phase the engine runs with
 * nothing open — is what keeps that true. `apply` reads the counts off the
 * result and never touches `ctx.db`.
 *
 * Trek's pass is a full-year reconciliation with nothing to carry forward, so
 * there is no cursor.
 */
const leaveSync: SyncHandler<TrekSyncResult> = {
  schedule: "hourly",

  fetch: (ctx: SyncFetchContext) =>
    runTrekSync({
      now: ctx.clock.now(),
      call: { config: configOf(ctx.credentials) },
    }),

  async apply(_ctx: SyncApplyContext, result: TrekSyncResult): Promise<Record<string, number>> {
    if (result.status === "failed" || result.status === "partial") {
      // A partial pass means a local edit has not reached Trek. Recording it as
      // a success would let the last-sync stamp stay green while the two
      // calendars drift apart, so the engine is told it failed.
      throw new Error(result.errors.join("; ") || "Trek sync did not complete");
    }
    return { pulled: result.pulled, deleted: result.deleted, pushed: result.pushed };
  },
};

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
  syncs: { leave: leaveSync },
  webhook: {
    // Both shared with the Wallet adapter, which is where they were duplicated
    // character-for-character: see `src/platform/integrations/webhook-signature.ts`.
    verify: hmacSignatureVerifier(),
    toSyncRequests: (payload): SyncRequest[] => [{ kind: "leave", event: webhookEventName(payload) }],
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
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun } from "@/lib/repo/jobs";
import { runSyncForUser } from "@/modules/integrations/application/run-sync";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openOwnerConnection } from "@/modules/integrations/infrastructure/owner-connection";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { type TrekSyncResult } from "./trek-sync";

export async function runTrekSyncJob(input: RunTrekSyncJobInput = {}): Promise<JobResult> {
  const { trigger = "cron" } = input;
  ensureProvidersRegistered();

  // Checked before opening a run row, so an install with no Trek connection
  // writes nothing: an hourly job logging "not connected" 24 times a day would
  // push every other job off the Administration page's 20-row log.
  const owner = await openOwnerConnection("trek");
  if (!owner) {
    return { job: JOB_NAME, status: "already_done", detail: { reason: "not_connected" } };
  }

  const run = await startRun({ jobName: JOB_NAME, trigger });
  try {
    const syncRun = await runSyncForUser(integrationDeps(db))(owner.userId, {
      provider: "trek",
      kind: "leave",
      trigger: "cron",
    });
    if (syncRun.status === "failed") {
      const error = syncRun.error ?? "trek sync failed";
      await finishRun(run.id, "failed", { error, detail: syncRun.stats });
      return { job: JOB_NAME, status: "failed", error, detail: syncRun.stats };
    }
    // Reachable when a "Sync now" from the Work page is still in flight: the
    // engine hands back the run already going rather than starting a second
    // conversation with Trek, whose toggle is its own inverse.
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
`RunTrekSyncJobInput` must stop extending `RunTrekSyncInput`: that interface now *requires* `call`, and this job no longer passes anything through to `runTrekSync` — the engine builds the call options from the connection. It becomes:
```ts
export interface RunTrekSyncJobInput {
  trigger?: "cron" | "manual";
}
```
Keep `summarize()` exported and tested — the Work page still formats a pass with it — so the `TrekSyncResult` type import stays.

In `trek-sync-job.test.ts`, replace the `@/lib/clients/trek` mock (line 63) and its `trekConfigured` import (72) with:
```ts
vi.mock("@/modules/integrations/infrastructure/owner-connection", () => ({
  openOwnerConnection: vi.fn(async () =>
    store.connected
      ? { userId: "u1", connection: { id: "c1", provider: "trek", status: "connected" }, credentials: {} }
      : null,
  ),
}));
vi.mock("@/modules/integrations/application/run-sync", () => ({
  runSyncForUser: () => async () => store.syncRun,
}));
vi.mock("@/platform/integrations/register-all", () => ({ ensureProvidersRegistered: () => {} }));
```
`store.connected = true` in `beforeEach` (replacing line 95's `vi.mocked(trekConfigured).mockReturnValue(true)`), and line 113's "not configured" case becomes `store.connected = false`, still expecting `already_done` with `{ reason: "not_connected" }` and no `job_runs` row.

- [ ] **Step 7: Give the two leave call sites the credential**

`src/modules/integrations/ui/principal-connection.ts` — the signed-in user's front door, the mirror of Step 7's `openOwnerConnection`:
```ts
import { db } from "@/lib/db";
import type { ProviderCode } from "@/platform/integrations/types";
import {
  openConnection,
  type OpenedConnection,
} from "@/modules/integrations/application/open-connection";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";

/**
 * The signed-in user's connection for a provider, with its credential open, or
 * null when they have not connected it. Every caller treats null as "the
 * integration is off" rather than an error — the same contract the deleted
 * `trekConfig()` had.
 *
 * `require-principal` is imported dynamically, exactly as
 * `modules/accounts/ui/run.ts` does it: a static import drags in `@/auth` and
 * through it `next/server`, which vitest's unit environment cannot resolve, and
 * would make every unit test of a caller unrunnable.
 */
export async function openPrincipalConnection(provider: ProviderCode): Promise<OpenedConnection | null> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return openConnection(integrationDeps(db))(principal.userId, provider);
}

/** "Is this provider set up for me?" — for a page that must not decrypt anything to render. */
export async function isProviderConnectedForPrincipal(provider: ProviderCode): Promise<boolean> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return integrationDeps(db).inUserContext(principal.userId, async (d) => {
    const connection = await d.connections.getByProvider(principal.userId, provider);
    return connection?.status === "connected";
  });
}
```

In `src/app/actions/leave.ts`, replace the `trekConfigured` import (line 6) with the two below, and add one helper the three `runTrekSync` call sites share:
```ts
import { isWeekendBlocked } from "@/lib/clients/trek";
import { disabledTrekSync, runTrekSync, type TrekSyncResult } from "@/lib/jobs/trek-sync";
import { openPrincipalConnection } from "@/modules/integrations/ui/principal-connection";
import type { TrekCallOptions } from "@/lib/clients/trek";

/** The signed-in user's Trek credential as call options, or null when Trek is not connected. */
async function trekCall(): Promise<TrekCallOptions | null> {
  const opened = await openPrincipalConnection("trek");
  if (!opened) return null;
  return { config: { baseUrl: opened.credentials.baseUrl!, token: opened.credentials.token! } };
}
```
At each of `setLeaveDay`, `removeLeaveDay` and `syncLeaveNow`, resolve it once and fall back to the disabled result rather than an error — this is the behaviour `runTrekSync` used to provide itself, and it is why `TrekSyncStatus["disabled"]` still exists:
```ts
  const call = await trekCall();
  const sync = call
    ? await runTrekSync({ year: yearOf(date), withStats: false, call })
    : disabledTrekSync(yearOf(date));
```
`describe()` already renders `"disabled"` as "…Trek sync is off.", so the message the owner sees is unchanged. `noopSync(date)` loses its `trekConfigured()` call (line 180) and becomes `disabledTrekSync(yearOf(date))` when there is no connection and an `ok` result otherwise — pass the resolved `call` into it rather than re-resolving.

In `src/app/(app)/work/_lib/leave.ts`, replace the import on line 1 and the `configured` field on line 139:
```ts
import type { LeaveFraction, LeaveKind } from "@/lib/clients/trek";
import { isProviderConnectedForPrincipal } from "@/modules/integrations/ui/principal-connection";
```
```ts
    configured: await isProviderConnectedForPrincipal("trek"),
```
`LeaveCalendarView.configured` keeps its meaning and `LeaveCalendar.tsx` is untouched — only the question behind the boolean changed, from "is a file mounted" to "is there a connection".

Update both tests' mocks: `src/app/actions/leave.test.ts` (lines 17, 55) and `src/app/(app)/work/_lib/leave.test.ts` (line 21) drop their `@/lib/clients/trek` `trekConfigured` mock and gain
```ts
vi.mock("@/modules/integrations/ui/principal-connection", () => ({
  openPrincipalConnection: vi.fn(async () =>
    store.connected ? { connection: { id: "c1" }, credentials: { baseUrl: "https://trek.example", token: "trek_t" } } : null,
  ),
  isProviderConnectedForPrincipal: vi.fn(async () => store.connected),
}));
```
`leave.test.ts` asserts that `runTrekSync` is called with `call: { config: { baseUrl: "https://trek.example", token: "trek_t" } }`, and gains one case: with `store.connected = false`, `setLeaveDay` still succeeds, the day is staged, and the message ends "Trek sync is off."

- [ ] **Step 8: Run the tests**

Run:
```bash
npm run typecheck && npm test && npm run test:integration
grep -rn "trekConfigured\|isTrekNotConfigured\|TrekNotConfiguredError" src
```
Expected: tests PASS; the grep prints **nothing**.

Two greps this task deliberately does **not** run, because they would match for reasons this task does not own:
- `grep -rn "trekConfig(" src` still matches `src/lib/env.ts` (the declaration, removed in Task 19) and `src/platform/capabilities/probes.ts:52` (its last caller, replaced in Task 16).
- `grep -rn "walletToken(" src` still matches `src/lib/env.ts` alone; Task 11 removed its last caller and Task 19 removes the declaration.

Task 19 runs both gates once they can be clean, and Task 20 re-runs them as an exit check.

- [ ] **Step 9: Commit**

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
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
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
  return testIntegrationDeps({ registry });
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
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { createCredentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { recordAudit } from "@/platform/audit/record";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import { DrizzleConnectionsRepository } from "@/modules/integrations/infrastructure/drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-jobs-repository";
import { DrizzleSyncRunsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "@/modules/integrations/infrastructure/drizzle-webhook-deliveries-repository";
import {
  importFileCredentials,
  type FileCredentials,
} from "@/modules/integrations/application/import-file-credentials";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * A mounted secret, or null when there is genuinely no file there.
 *
 * "Missing" and "unreadable" are deliberately NOT the same answer. A file that
 * exists but cannot be read — wrong owner, wrong mode, a directory where a file
 * was expected — is a deployment mistake, and swallowing it would report
 * `skipped: no_file` in the runbook's success check while the credential
 * silently failed to migrate. Only ENOENT is a legitimate "not mounted".
 */
function readTrimmed(path: string | undefined): string | null {
  if (!path) return null;
  let value: string;
  try {
    value = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
        "Fix the mount or its permissions and re-run; do not treat this as 'not configured'.",
    );
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

    // The deps bag is assembled by hand rather than through `integrationDeps`,
    // because that calls `credentialCipher()` → `env()`, and Ruling R16 keeps
    // one-off scripts off the full application environment. It is the same
    // shape, built around a cipher made from `APP_ENCRYPTION_KEY` alone.
    const cipher = createCredentialCipher(encryptionKey);
    const buildDeps = (client: DbClient): IntegrationDeps => ({
      connections: new DrizzleConnectionsRepository(client),
      jobs: new DrizzleSyncJobsRepository(client),
      runs: new DrizzleSyncRunsRepository(client),
      deliveries: new DrizzleWebhookDeliveriesRepository(client),
      cipher,
      registry: providerRegistry,
      db: client,
      clock: { now: () => new Date() },
      audit: (e) => recordAudit(client, e),
      inUserContext: (userId, fn) => withUserContext(db, { userId }, (tx) => fn(buildDeps(tx))),
      inSystemContext: (fn) => withSystemContext(db, (tx) => fn(buildDeps(tx))),
    });

    const result = await importFileCredentials(buildDeps(db))(
      {
        userId: owner,
        organizationId: row!.organizationId,
        roles: ["owner"],
        permissions: permissionsForRoles(["owner"]),
      },
      files,
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
```
Add to `package.json`: `"migrate:credentials": "tsx scripts/import-file-credentials.ts"`.

The runbook execs this inside the container, so it also has to ship in the image. `dashboard-app/Dockerfile` already has three esbuild blocks (`src/lib/db/migrate.ts`, `scripts/migrate-teable.ts`, `scripts/validate-teable-migration.ts`) and three matching `COPY --from=builder` lines; this is the **fourth** of each. Copy the `migrate-teable.ts` block exactly, with the input and output changed:
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
and a fourth copy line next to the existing three:
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
- Modify: `dashboard-app/src/app/api/v1/[[...route]]/route.ts`
- Modify: `docs/api/openapi.json` (regenerated — six routes are added)

The Phase-1 wallet sync route, `syncWalletAction` and `assertWalletSyncAllowed` are **already gone**: Task 11 removed them, because it is the task that changed `walletAccountsSource`'s signature and they were its last two call sites.

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

`POST /api/v1/integrations/wallet/sync` keeps working — the Phase-1 route's path is a special case of the new one — but its **response shape changes** from the raw reconciliation counts to `{ run: SyncRun }`, with the counts under `run.stats`. That is the one breaking API change in Phase 2 and Task 19 documents it. Every route answers `503 integration_unavailable` where Phase 1 did, via the same `errorResponses` map.

The handlers pass `integrationDeps(deps.db, c.get("requestId"))` straight to the use case and do **not** wrap it in `withUserContext`: each use case opens its own transactions (Global Constraints), which is what keeps `provider.testConnection` and a sync's provider fetch out of one.

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
import { ITEST_ENCRYPTION_KEY } from "@/test/integration-setup";
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
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => ["one"],
        apply: async () => ({ created: 1 }),
      },
    },
    onDisconnect: async () => {},
  };
}

describe("integration routes", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    // The suite's own key comes from `src/test/integration-setup.ts`; this file
    // uses a different one to prove the cipher really is re-read, so the cache
    // has to be dropped first.
    resetCredentialCipher();
    process.env.APP_ENCRYPTION_KEY = KEY;
    registerProvider(fakeProvider());
  });
  afterAll(async () => {
    process.env.APP_ENCRYPTION_KEY = ITEST_ENCRYPTION_KEY;
    resetCredentialCipher();
    await closeDb();
  });

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
  /** The `sync_jobs` row this run belongs to, or null. */
  jobId: z.string().nullable(),
  kind: z.enum(["accounts", "leave"]),
  /** `queued` is a webhook-created run the hourly `sync_queue` job has not reached yet. */
  status: z.enum(["queued", "running", "success", "failed", "skipped"]),
  trigger: z.enum(["cron", "manual", "webhook", "api"]),
  stats: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const SyncRunsPageSchema = z.object({ items: z.array(SyncRunSchema) });
export const SyncResponseSchema = z.object({ run: SyncRunSchema });
export const SyncRunsQuerySchema = z.object({
  limit: z.string().optional().openapi({ param: { name: "limit", in: "query" }, example: "20" }),
});

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
```

- [ ] **Step 4: Write the routes**

`src/modules/integrations/api/routes.ts`, in full. It follows `src/modules/accounts/api/routes.ts`'s shape: one `createRoute` per endpoint, a `toApiError` mapper, DTOs that serialise dates with `toISOString()`.
```ts
import { createRoute } from "@hono/zod-openapi";
import { UpstreamError } from "@/lib/contracts";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { providerRegistry } from "@/platform/integrations/registry";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncRun,
} from "@/platform/integrations/types";
import { connectIntegration } from "@/modules/integrations/application/connect-integration";
import { disconnectIntegration } from "@/modules/integrations/application/disconnect-integration";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  SyncDisabledError,
  SyncNotSupportedError,
  UnknownProviderError,
} from "@/modules/integrations/application/errors";
import { listIntegrations, type IntegrationSummary } from "@/modules/integrations/application/list-integrations";
import { runSync } from "@/modules/integrations/application/run-sync";
import { testIntegrationConnection } from "@/modules/integrations/application/test-integration-connection";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  ConnectRequestSchema,
  ConnectResponseSchema,
  DisconnectRequestSchema,
  DisconnectResponseSchema,
  IntegrationListResponseSchema,
  ProviderParamSchema,
  SyncRequestBodySchema,
  SyncResponseSchema,
  SyncRunsPageSchema,
  SyncRunsQuerySchema,
  TestResultSchema,
} from "./schemas";

/**
 * Maps a use-case error to the `ApiError` the brief pins down, and rethrows
 * anything else unchanged so `app.onError` turns it into a 500.
 *
 * `UpstreamError` comes from `@/lib/contracts`, not from the HTTP client
 * module — the clients throw it, `contracts.ts` declares it.
 */
function toApiError(err: unknown): ApiError {
  if (err instanceof UnknownProviderError) return new ApiError(404, "not_found", err.message);
  if (err instanceof ConnectionNotFoundError) return new ApiError(409, "conflict", err.message);
  if (err instanceof ConnectionNotUsableError) return new ApiError(409, "conflict", err.message);
  if (err instanceof SyncDisabledError) return new ApiError(409, "conflict", err.message);
  if (err instanceof SyncNotSupportedError) return new ApiError(422, "validation_failed", err.message);
  if (err instanceof CredentialValidationError) {
    return new ApiError(422, "validation_failed", err.message, err.issues);
  }
  if (err instanceof ConnectionVersionMismatchError) {
    return new ApiError(409, "version_mismatch", err.message);
  }
  if (err instanceof UpstreamError) return new ApiError(503, "integration_unavailable", err.message);
  throw err;
}

function connectionDto(c: IntegrationConnection) {
  return {
    id: c.id,
    provider: c.provider,
    status: c.status,
    settings: c.settings,
    lastTestAt: c.lastTestAt ? c.lastTestAt.toISOString() : null,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    lastError: c.lastError,
    disconnectPolicy: c.disconnectPolicy,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function summaryDto(s: IntegrationSummary) {
  return {
    provider: s.provider,
    label: s.label,
    capabilities: [...s.capabilities],
    credentialFields: s.credentialFields.map((f) => ({
      name: f.name,
      label: f.label,
      secret: f.secret,
      ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
    })),
    connection: s.connection ? connectionDto(s.connection) : null,
  };
}

function runDto(r: SyncRun) {
  return {
    id: r.id,
    connectionId: r.connectionId,
    jobId: r.jobId,
    kind: r.kind,
    status: r.status,
    trigger: r.trigger,
    stats: r.stats,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse(
    "Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`).",
  ),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

const notFound = errorResponse("No integration under that code (`not_found`).");
const conflict = errorResponse("Not connected, not usable, switched off, or a lost version race (`conflict`, `version_mismatch`).");
const unprocessable = errorResponse("The credential or the requested sync was refused (`validation_failed`).");
const unavailable = errorResponse("The upstream integration is unavailable (`integration_unavailable`).");

/**
 * Narrows a free-text path segment to a `ProviderCode` by asking the registry,
 * which is the only thing that actually knows. No cast: an unregistered code
 * leaves here as a 404, so the value handed to a use case is always one the
 * registry vouched for.
 */
function providerCodeOf(code: string): ProviderCode {
  const provider = providerRegistry.get(code);
  if (!provider) throw new ApiError(404, "not_found", `No integration named ${code}`);
  return provider.code;
}

const listRoute = createRoute({
  method: "get",
  path: "/integrations",
  tags: ["Integrations"],
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Every registered provider, with its connection when there is one.",
      content: { "application/json": { schema: IntegrationListResponseSchema } },
    },
    ...commonErrorResponses,
  },
});

const connectRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/connect",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description:
    "Stores the credential and tests it. A failed test is still a 200: the connection lands in `error` with the provider's own message. The credential is never echoed back.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: ConnectRequestSchema } } },
  },
  responses: {
    200: { description: "The connection and the test result.", content: { "application/json": { schema: ConnectResponseSchema } } },
    404: notFound,
    409: conflict,
    422: unprocessable,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const testRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/test",
  tags: ["Integrations"],
  security: [{ session: [] }],
  request: { params: ProviderParamSchema },
  responses: {
    200: { description: "Whether the stored credential still works.", content: { "application/json": { schema: TestResultSchema } } },
    404: notFound,
    409: conflict,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const syncRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/sync",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description:
    "Idempotent per running job: a second call while a run is in flight returns that run. `kind` defaults to the provider's only sync.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: SyncRequestBodySchema } } },
  },
  responses: {
    200: { description: "The run, finished or already in flight.", content: { "application/json": { schema: SyncResponseSchema } } },
    404: notFound,
    409: conflict,
    422: unprocessable,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const disconnectRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/disconnect",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description: "Destroys the credential and applies the disconnect policy. `policy` overrides the stored one for this call only.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: DisconnectRequestSchema } } },
  },
  responses: {
    200: { description: "The policy that was applied.", content: { "application/json": { schema: DisconnectResponseSchema } } },
    404: notFound,
    409: conflict,
    ...commonErrorResponses,
  },
});

const syncRunsRoute = createRoute({
  method: "get",
  path: "/integrations/{provider}/sync-runs",
  tags: ["Integrations"],
  security: [{ session: [] }],
  request: { params: ProviderParamSchema, query: SyncRunsQuerySchema },
  responses: {
    200: { description: "Most recent runs first.", content: { "application/json": { schema: SyncRunsPageSchema } } },
    404: notFound,
    ...commonErrorResponses,
  },
});

/** 1–200, default 20; anything else is a 422 rather than a silent clamp. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new ApiError(422, "validation_failed", "limit must be an integer between 1 and 200");
  }
  return n;
}

export function registerIntegrationRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const items = await listIntegrations(integrationDeps(deps.db, c.get("requestId")))(principal);
      return c.json({ items: items.map(summaryDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(connectRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const result = await connectIntegration(integrationDeps(deps.db, c.get("requestId")))(principal, {
        provider: providerCodeOf(provider),
        credentials: body.credentials,
        ...(body.settings !== undefined ? { settings: body.settings } : {}),
        ...(body.disconnectPolicy !== undefined ? { disconnectPolicy: body.disconnectPolicy } : {}),
      });
      // `connectionDto` has no field for a credential, so the response cannot
      // carry one back however the handler is later edited.
      return c.json({ connection: connectionDto(result.connection), test: result.test }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(testRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    try {
      const result = await testIntegrationConnection(integrationDeps(deps.db, c.get("requestId")))(
        principal,
        providerCodeOf(provider),
      );
      return c.json(result, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(syncRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      // No `kind` defaulting here: `runSync` owns that rule, so this route and
      // `syncIntegrationAction` cannot end up disagreeing about it.
      const run = await runSync(integrationDeps(deps.db, c.get("requestId")))(principal, {
        provider: providerCodeOf(provider),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        trigger: "api",
      });
      return c.json({ run: runDto(run) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(disconnectRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const result = await disconnectIntegration(integrationDeps(deps.db, c.get("requestId")))(
        principal,
        providerCodeOf(provider),
        body.policy,
      );
      return c.json(result, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(syncRunsRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const code = providerCodeOf(provider);
      const limit = parseLimit(query.limit);
      const summaries = await listIntegrations(integrationDeps(deps.db, c.get("requestId")))(principal);
      const summary = summaries.find((s) => s.provider === code);
      return c.json({ items: (summary?.recentRuns ?? []).slice(0, limit).map(runDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });
}
```
Task 15 adds one more route to this file and, with it, `z` to the `@hono/zod-openapi` import and `WebhookResponseSchema` to the `./schemas` one — the webhook body is `z.unknown()`, since only the adapter knows its shape.

- [ ] **Step 5: Wire it in**

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
In `src/app/api/v1/[[...route]]/route.ts`, call `ensureProvidersRegistered()` before `createApiApp(...)`, so a request that arrives before any page render still finds a populated registry.

- [ ] **Step 6: Regenerate the API document and run the tests**

Six routes are new, so the document changes in this commit and is regenerated in it:
```bash
npm run openapi:generate
npm run typecheck && npm test && npm run test:integration
```
Expected: PASS, the OpenAPI drift test included. If it is red, `openapi:generate` was not re-run.

- [ ] **Step 7: Commit**

```bash
git add -A ../docs
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
- Consumes: `IntegrationDeps`, `enqueueSync`, `verifyHmacSignature` (through each provider's `webhook.verify`).
- Produces:
```ts
export interface WebhookOutcome {
  accepted: boolean;
  connectionId: string | null;
  /** The `sync_runs` rows queued by this delivery. Empty on a rejection. */
  runIds: string[];
}
export function handleWebhook(deps: IntegrationDeps): (input: {
  provider: string; rawBody: string; headers: Headers;
}) => Promise<WebhookOutcome>;
```

**Ruling P2-C3: the request verifies and enqueues; it does not sync.** Spec §3.4 says an inbound webhook endpoint "enqueues a job row rather than doing work inline", and there are two independent reasons this matters here. The obvious one: a provider's callback must not wait out a full sync, and the delivery is recorded whether or not the sync later succeeds. The one that actually forces the design: a webhook has **no principal**, so its lookups run in the system context — and running a user's sync there would write every row with RLS bypassed and stamp every audit line `app.role = 'system'`. Queueing hands the work to the hourly `sync_queue` job (Task 10), which resolves the connection's owner and runs it in *their* user context.

So the request does exactly four things: find the connection whose own `webhookSecret` verifies the body, record the delivery, enqueue one `queued` `sync_runs` row per `SyncRequest`, and answer `202`.

Route: `POST /api/v1/webhooks/{provider}`. It carries **no session**, so `createApiApp` must skip authentication, the CSRF check and the per-principal rate limiter for it. Step 4 gives the exact edit — the three middlewares are not all the same shape, and the rate limiter in particular is a returned handler rather than an inline arrow.

Verification, per spec §6: the body's HMAC-SHA256 must match `X-Signature: sha256=<hex>` under **the receiving connection's own `webhookSecret`**. Since the path names only the provider, every `connected` connection for that provider is tried and the first whose secret verifies wins; a connection whose stored `webhookSecret` is empty can never match. No match ⇒ `404` and a `rejected` delivery row, mirroring `src/lib/auth/machine.ts`'s "a machine endpoint must not confirm it exists".

- [ ] **Step 1: Write the failing use-case test**

`src/modules/integrations/application/handle-webhook.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import { hmacSignatureVerifier } from "@/platform/integrations/webhook-signature";
import type { MemoryWebhookDeliveriesRepository } from "../infrastructure/memory-repositories";
import { connectIntegration } from "./connect-integration";
import type { IntegrationDeps } from "./deps";
import { drainSyncQueue } from "./drain-sync-queue";
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
      accounts: {
        schedule: "daily",
        fetch: async () => {
          syncs += 1;
          return ["row"];
        },
        apply: async () => ({ created: 1 }),
      },
    },
    webhook: {
      verify: hmacSignatureVerifier(),
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
  return testIntegrationDeps({ registry });
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

  it("accepts a correctly signed body, queues the sync and does NOT run it", async () => {
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
    // Spec §3.4: the request enqueues, it does not do the work.
    expect(syncs).toBe(0);
    const queued = await deps.runs.queued(10);
    expect(queued.map((r) => r.id)).toEqual(outcome.runIds);
    expect(queued[0]!.status).toBe("queued");
    expect(queued[0]!.trigger).toBe("webhook");

    const deliveries = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows;
    expect(deliveries[0]!.status).toBe("accepted");
    expect(deliveries[0]!.event).toBe("accounts.changed");
    expect(deliveries[0]!.connectionId).toBe(outcome.connectionId);

    // …and the tick is what actually runs it.
    const drained = await drainSyncQueue(deps)(10);
    expect(drained.map((r) => r.id)).toEqual(outcome.runIds);
    expect(drained[0]!.status).toBe("success");
    expect(syncs).toBe(1);
  });

  it("rejects a body that is signed but not JSON, with a reason on the delivery", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const raw = "not json at all";
    const headers = new Headers({
      "x-signature": `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`,
    });
    const outcome = await handleWebhook(deps)({ provider: "wallet", rawBody: raw, headers });
    expect(outcome.accepted).toBe(false);
    expect(outcome.runIds).toEqual([]);
    expect(await deps.runs.queued(10)).toEqual([]);
    const delivery = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows[0]!;
    expect(delivery.status).toBe("rejected");
    expect(delivery.event).toBe("malformed_json");
    expect(delivery.error).toMatch(/JSON/);
    // The connection IS known here — the signature verified — so the row says which.
    expect(delivery.connectionId).not.toBeNull();
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
    expect(await deps.runs.queued(10)).toEqual([]);
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
import type { IntegrationConnection } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { enqueueSync } from "./enqueue-sync";

export interface WebhookOutcome {
  accepted: boolean;
  connectionId: string | null;
  /** The `sync_runs` rows this delivery queued. Empty on a rejection. */
  runIds: string[];
}

/**
 * Spec §3.4: an inbound webhook validates its signature and **enqueues** the
 * sync work rather than doing it inline (Ruling P2-C3). Nothing here calls a
 * provider or writes a user's domain data; the hourly `sync_queue` job claims
 * the queued rows and runs each one in its connection owner's user context.
 *
 * Everything below runs in the SYSTEM context, because a webhook has no
 * principal: it must be able to look across users to find whose secret signs
 * this body. That is also precisely why the sync itself cannot run here — it
 * would write every row with RLS bypassed and attribute every audit line to
 * the system rather than to the person.
 *
 * The path names only the provider, so the receiving connection is discovered
 * by trying each connected one's own webhook secret. That is O(connections),
 * which is one or two here, and it keeps the secret per connection rather than
 * making one deployment-wide secret speak for every user.
 *
 * Nothing in the payload is trusted beyond the event name, and the payload is
 * decoded only AFTER the signature verifies, so an unsigned body never reaches
 * `JSON.parse`.
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

    const webhook = provider.webhook;
    const code = provider.code;
    const payloadHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");

    return deps.inSystemContext(async (d) => {
      const receivedAt = d.clock.now();

      let matched: IntegrationConnection | null = null;
      for (const connection of await d.connections.candidatesForWebhook(code)) {
        const sealed = await d.connections.readCredentials(connection.userId, connection.id);
        if (!sealed) continue;
        const secret = d.cipher.open(sealed).webhookSecret ?? "";
        if (!secret) continue;
        if (!webhook.verify({ rawBody: input.rawBody, headers: input.headers }, secret)) continue;
        matched = connection;
        break;
      }

      if (!matched) {
        await d.deliveries.record({
          connectionId: null,
          provider: code,
          event: "unverified",
          payloadHash,
          status: "rejected",
          error: "No connected connection verified this signature",
          receivedAt,
        });
        return rejected;
      }

      // A body that verified but is not JSON is a REAL problem — somebody
      // holding the right secret is sending something this adapter cannot
      // read — so it is recorded with its reason and refused, not quietly
      // turned into an `unknown` event that queues a sync anyway.
      let payload: unknown;
      try {
        payload = JSON.parse(input.rawBody);
      } catch (err) {
        await d.deliveries.record({
          connectionId: matched.id,
          provider: code,
          event: "malformed_json",
          payloadHash,
          status: "rejected",
          error: `Signed body was not JSON: ${err instanceof Error ? err.message : String(err)}`,
          receivedAt,
        });
        return { accepted: false, connectionId: matched.id, runIds: [] };
      }

      const requests = webhook.toSyncRequests(payload);
      const runIds: string[] = [];
      for (const request of requests) {
        const run = await enqueueSync(d)(matched, request.kind, "webhook");
        runIds.push(run.id);
      }

      await d.deliveries.record({
        connectionId: matched.id,
        provider: code,
        event: requests[0]?.event ?? "unknown",
        payloadHash,
        status: "accepted",
        error: null,
        receivedAt,
      });
      return { accepted: true, connectionId: matched.id, runIds };
    });
  };
}
```

- [ ] **Step 4: Open the public path and add the route**

In `src/platform/http/app.ts`, add above `createApiApp`:
```ts
/**
 * Paths that authenticate themselves. Only the inbound webhook qualifies
 * today: it carries no cookie and no token, and proves itself with an HMAC
 * over the raw body under the receiving connection's own secret.
 *
 * `c.req.path` is the full request pathname, basePath included, so these are
 * absolute.
 */
const PUBLIC_PREFIXES = ["/api/v1/webhooks/"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}
```
Then guard the three middlewares that assume a principal. The **request-id** middleware stays unguarded — a webhook still gets a request id, and the response header is useful for tracing a delivery.

The authentication middleware:
```ts
  app.use("*", async (c, next) => {
    if (isPublic(c.req.path)) return next();
    const authenticated = await deps.authenticate(c.req.raw);
    if (!authenticated) throw new ApiError(401, "unauthorized", "Sign in to use the API");
    c.set("principal", authenticated.principal);
    c.set("authMethod", authenticated.method);
    await next();
  });
```
The CSRF middleware — note it reads `c.get("authMethod")`, which is now unset on a public path, so the guard is not merely an optimisation:
```ts
  app.use("*", async (c, next) => {
    if (isPublic(c.req.path)) return next();
    if (
      UNSAFE_METHODS.has(c.req.method.toUpperCase()) &&
      c.get("authMethod") === "session" &&
      !(c.req.header("x-requested-with") ?? "").trim()
    ) {
      throw new ApiError(403, "csrf_required", "Send the X-Requested-With header with cookie-authenticated requests");
    }
    await next();
  });
```
The rate limiter is **not** an inline arrow — it is the handler `rateLimit(...)` returns — so it cannot be edited the same way. Wrap it instead. Today the line reads:
```ts
  if (deps.rateLimitEnabled !== false) app.use("*", rateLimit({ db: deps.db, now: deps.now }));
```
and becomes:
```ts
  if (deps.rateLimitEnabled !== false) {
    // The limiter counts per principal, and a webhook has none — calling it on
    // a public path would throw on `c.get("principal").userId`. Rate limiting
    // the webhook endpoint is a Phase 9 concern and needs a different key
    // (the connection, or the source address), not this one.
    const limiter = rateLimit({ db: deps.db, now: deps.now });
    app.use("*", (c, next) => (isPublic(c.req.path) ? next() : limiter(c, next)));
  }
```

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
  // raw body, using the receiving connection's own webhook secret. It is
  // therefore also the one /api/v1 route exempt from `X-Requested-With`.
  description:
    "Verifies `X-Signature: sha256=<hex>` over the raw body and queues the provider's syncs. The work runs on the next `sync_queue` tick, not in this request.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: z.unknown() } } },
  },
  responses: {
    202: {
      description: "Signature verified; syncs queued.",
      content: { "application/json": { schema: WebhookResponseSchema } },
    },
    404: errorResponse("The signature did not verify against any connection, or the provider does not exist."),
  },
});
```
Handler:
```ts
  app.openapi(webhookRoute, async (c) => {
    const providerCode = c.req.param("provider")!;
    // `.clone()` because the body has already been consumed by the validator;
    // the HMAC is over the RAW bytes, so it must not be re-serialised.
    const rawBody = await c.req.raw.clone().text();
    // No `withSystemContext` here: `handleWebhook` opens exactly the contexts
    // it needs (Global Constraints), and it enqueues rather than syncing, so
    // nothing a user owns is ever written under `app.role = 'system'`.
    const outcome = await handleWebhook(integrationDeps(deps.db, c.get("requestId")))({
      provider: providerCode,
      rawBody,
      headers: c.req.raw.headers,
    });
    // One answer for "no such provider", "bad signature" and "signed but
    // unreadable": a machine endpoint must not confirm what exists.
    if (!outcome.accepted) throw new ApiError(404, "not_found", "No such webhook endpoint");
    return c.json({ accepted: true, runIds: outcome.runIds }, 202);
  });
```

- [ ] **Step 5: Write the route integration test**

`src/modules/integrations/api/webhook.itest.ts` — same `seed()` shape as `routes.itest.ts` (registering a provider whose `webhook.verify` is `hmacSignatureVerifier()`), then:
```ts
  it("accepts a signed webhook without a session, queues the sync, and refuses an unsigned one", async () => {
    const { app, db, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    const body = '{"event":"accounts.changed"}';
    const signature = `sha256=${createHmac("sha256", "hook-secret").update(body, "utf8").digest("hex")}`;

    // No session header, no X-Requested-With: this route is genuinely public.
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

    // Queued, not run: spec §3.4 and Ruling P2-C3.
    const queued = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    const queuedItems = (await queued.json()).items as { id: string; status: string; trigger: string }[];
    expect(queuedItems).toHaveLength(1);
    expect(queuedItems[0]!.status).toBe("queued");
    expect(queuedItems[0]!.trigger).toBe("webhook");

    // The tick runs it, in the connection owner's own context.
    const drained = await drainSyncQueue(integrationDeps(db))(10);
    expect(drained.map((r) => r.id)).toEqual([queuedItems[0]!.id]);
    expect(drained[0]!.status).toBe("success");

    const after = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    expect(((await after.json()).items as { status: string }[])[0]!.status).toBe("success");

    // The audit row the sync wrote names the person, not the system.
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "integration.sync"));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(userA.id);
  });
```
`seed()` returns `db` alongside `app`, and the file imports `drainSyncQueue`, `integrationDeps`, `auditEvents` and `eq`.

- [ ] **Step 6: Regenerate the API document and run the tests**

The webhook route is new, so the document changes in this commit:
```bash
npm run openapi:generate
npm run typecheck && npm test && npm run test:integration
```
Expected: PASS, the OpenAPI drift test included.

- [ ] **Step 7: Commit**

```bash
git add -A ../docs
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
Extend `probes.itest.ts` with a case that inserts a `connected` wallet connection for one user and asserts the other user still sees `not_configured`. `integration_connections` carries `FORCE ROW LEVEL SECURITY`, so the insert cannot go on the bare pool — it needs a context, and the system one is the honest choice for a fixture that sets up two users:
```ts
  it("reports each user's own connection state and nobody else's", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    // FORCE ROW LEVEL SECURITY: on the bare pool this insert is rejected by the
    // WITH CHECK clause, so the fixture runs in the system context.
    await withSystemContext(db, (tx) =>
      tx.insert(integrationConnections).values({ userId: a!.id, provider: "wallet", status: "connected" }),
    );

    const probes = connectionProbes(db);
    expect(await probes.connectionStates(a!.id)).toEqual({ wallet: "connected", trek: "not_configured" });
    expect(await probes.connectionStates(b!.id)).toEqual({
      wallet: "not_configured",
      trek: "not_configured",
    });
  });
```
with `withSystemContext`, `integrationConnections`, `organizations`, `users` and `connectionProbes` added to the file's imports.

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

`/settings/integrations/wallet` does not exist yet — Task 18 creates it, and the five Settings children this step adds to the sidebar are created by Tasks 17 and 18. Between this commit and those, those links 404. That is deliberate and bounded: `npm run build` still passes (Next.js does not resolve `href`s at build time), the routes land two tasks later, and the alternative — pointing them somewhere temporary — would mean editing the same six links twice.

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build`
Expected: PASS. No route changed, so the OpenAPI document is untouched and its drift test stays green.

In `npm run dev`, signed in as the owner, confirm the sidebar now lists five children under Settings and that `/finance/expenses` renders its new empty state. The five children 404 until Tasks 17 and 18 land — that is the ordering noted in Step 5, not a defect to chase here.

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
import { unusedDb } from "@/test/integration-deps";
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
    // `unusedDb` is a real, unconnected client rather than `{} as never`: if the
    // permission check were ever moved below the query, this test would fail
    // with a connection error instead of silently passing on a stub.
    await expect(loadUsers(unusedDb, testPrincipal({ roles: ["member"] }))).rejects.toBeInstanceOf(
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

All four share two conventions from the page they replace: `export const dynamic = "force-dynamic"` with a `metadata` title, and `const COLUMN = "flex flex-col gap-10"` as the `Panel` body class.

`src/app/(app)/settings/page.tsx` in full:
```tsx
import { redirect } from "next/navigation";

/** `/settings` is a group, not a page: its first area is the destination. */
export default function SettingsIndexPage() {
  redirect("/settings/personal");
}
```
Delete `src/app/(app)/settings/loading.tsx` and re-create it as `src/app/(app)/settings/personal/loading.tsx` with the skeleton trimmed to the sections Personal actually has (profile list, two narrow forms, the theme control).

`src/app/(app)/settings/personal/page.tsx` in full:
```tsx
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { effectiveRate } from "@/lib/calc/vacation-fund";
import { db } from "@/lib/db";
import { SETTING_KEYS, getSetting } from "@/lib/repo/settings";
import { balance as ledgerBalance, ledger, rates } from "@/lib/repo/vacation";
import { monthKey } from "@/lib/time";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { DEFAULT_HOURS_PER_DAY } from "../../_lib/vacation";
import { HoursPerDayForm, VacationSetupForm } from "../_components/SettingsForms";
import { loadProfile } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personal" };

const COLUMN = "flex flex-col gap-10";

/** One row of the profile list: label on the left, value on the right. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
      <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">{label}</dt>
      <dd className="shrink-0 text-body text-fg">{value}</dd>
    </div>
  );
}

export default async function PersonalSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  const now = monthKey(new Date());

  const [profile, rateRows, entries, balance, hoursRaw] = await Promise.all([
    loadProfile(db, principal),
    rates(),
    ledger(),
    ledgerBalance(),
    getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY),
  ]);

  const parsedHours = Number(hoursRaw);
  const hoursPerDay =
    Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : DEFAULT_HOURS_PER_DAY;
  const rate = effectiveRate(rateRows, now);
  const hasInitialValue = entries.some((e) => e.entryType === "initial");

  return (
    <>
      <PageHeader title="Personal" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Personal settings" bodyClassName={COLUMN}>
          <SettingsSection
            title="Profile"
            footnote="Editing your profile arrives with account management in a later release."
          >
            <dl className="hairline-t">
              <Row label="Display name" value={profile.displayName} />
              <Row label="Email" value={profile.email ?? "Not set"} />
              <Row label="Locale" value={profile.locale} />
              <Row label="Time zone" value={profile.timezone} />
              <Row label="Currency" value={profile.currency} />
            </dl>
          </SettingsSection>

          <SettingsSection
            title="Vacation fund"
            footnote="The vacation fund becomes a Budget in a later release; the figures carry over."
          >
            <VacationSetupForm
              monthlyAmount={rate === null ? "" : String(rate).replace(".", ",")}
              effectiveFrom={now.slice(0, 7)}
              hasInitialValue={hasInitialValue}
              currentMonth={now.slice(0, 7)}
              balance={balance}
            />
          </SettingsSection>

          <SettingsSection title="Leave">
            <HoursPerDayForm hoursPerDay={hoursPerDay} />
          </SettingsSection>

          <SettingsSection title="Theme">
            <ThemeToggle variant="segmented" className="max-w-xs" />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```

`src/app/(app)/settings/security/page.tsx` in full:
```tsx
import { headers } from "next/headers";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { describeCurrentSession } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

/**
 * One session, honestly labelled (Ruling P2-8). Auth.js still issues JWT
 * sessions, so there is no table to list from — inventing rows here would be
 * worse than showing the one session this request can actually see.
 */
export default async function SecuritySettingsPage() {
  await requirePrincipalOrRedirect();
  const session = describeCurrentSession(await headers());

  return (
    <>
      <PageHeader title="Security" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Security" bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Sessions"
            footnote="This device is the only session this release can see. Listing and revoking every session, two-factor authentication and personal access tokens arrive with database sessions."
          >
            <ul className="hairline-t">
              <li className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{session.userAgent}</span>
                  <span className="num block text-caption text-fg-muted">
                    {session.ip ?? "Address unknown"}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-positive">Current session</span>
              </li>
            </ul>
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```

`src/app/(app)/settings/account/page.tsx` in full:
```tsx
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { db } from "@/lib/db";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { loadProfile } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  const profile = await loadProfile(db, principal);
  const permissions = [...principal.permissions].sort();

  return (
    <>
      <PageHeader title="Account" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Account" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Organization">
            <dl className="hairline-t">
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Name</dt>
                <dd className="shrink-0 text-body text-fg">{profile.organizationName}</dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Your user id</dt>
                <dd className="num shrink-0 text-caption text-fg-muted">{principal.userId}</dd>
              </div>
            </dl>
          </SettingsSection>

          <SettingsSection
            title="Your roles"
            description="Roles decide what you may do; permissions are what they expand to."
          >
            <p className="text-body text-fg">{profile.roles.join(", ")}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <li
                  key={permission}
                  className="num rounded-xs bg-surface-hover px-1.5 py-0.5 text-caption text-fg-muted"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </SettingsSection>

          <SettingsSection title="Your data">
            <EmptyState
              title="Export and deletion are not available yet"
              description="A full JSON export with the original documents, and account deletion, arrive with the security phase."
            />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```

`src/app/(app)/settings/admin/page.tsx` in full. `JOBS`, `JOB_LABEL`, `STATUS_TONE` and `RUN_TIME` move here verbatim from the old `settings/page.tsx`, with `"sync_queue"` added to `JOBS` and `JOB_LABEL` (Task 10 registered it):
```tsx
import { notFound } from "next/navigation";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import type { JobName } from "@/lib/contracts";
import { db } from "@/lib/db";
import { formatMonth } from "@/lib/format";
import { llmConfigStatus } from "@/lib/payroll/llm-config";
import { lastSuccess, recentRuns } from "@/lib/repo/jobs";
import { monthKey } from "@/lib/time";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { LlmForm } from "../_components/SettingsForms";
import { loadUsers } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };

const COLUMN = "flex flex-col gap-10";

const JOBS: readonly JobName[] = [
  "monthly_close",
  "payslip_ingest",
  "sweep",
  "wallet_refresh",
  "wallet_accounts_sync",
  "trek_sync",
  "sync_queue",
];

const JOB_LABEL: Record<string, string> = {
  monthly_close: "Monthly close",
  payslip_ingest: "Payslip ingest",
  sweep: "Sweep",
  wallet_refresh: "Wallet refresh",
  wallet_accounts_sync: "Wallet accounts sync",
  trek_sync: "Trek leave sync",
  sync_queue: "Webhook sync queue",
};

const STATUS_TONE: Record<string, string> = {
  success: "text-positive",
  success_after_retry: "text-positive",
  already_done: "text-fg-muted",
  running: "text-fg-muted",
  failed: "text-negative",
  poisoned: "text-negative",
  missed: "text-warning",
};

const RUN_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const USER_JOINED = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Rome",
});

export default async function AdminSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  // `notFound`, not a 403: a member must not learn the page exists.
  if (!principal.permissions.has("admin.users")) notFound();

  const now = monthKey(new Date());
  const [users, runs, successes, llm] = await Promise.all([
    loadUsers(db, principal),
    recentRuns(undefined, 20),
    Promise.all(JOBS.map((job) => lastSuccess(job))),
    // Status only — `llmConfigStatus()` carries no key value, so the secret is
    // never serialised into this server component's HTML.
    llmConfigStatus(),
  ]);

  return (
    <>
      <PageHeader title="Administration" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="People and configuration" bodyClassName={COLUMN}>
          <SettingsSection
            title="Users"
            footnote="Read-only in this release. Invitations, role changes and suspension arrive with the security phase."
          >
            <ul className="hairline-t">
              {users.map((user) => (
                <li key={user.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">{user.displayName}</span>
                    <span className="block truncate text-caption text-fg-muted">
                      {user.email ?? "No email"} · {user.roles.join(", ") || "no roles"}
                    </span>
                  </span>
                  <span className="num shrink-0 text-caption text-fg-muted">
                    {user.status} · {USER_JOINED.format(user.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </SettingsSection>

          <SettingsSection
            title="Payslip AI"
            description="An OpenAI-compatible model reads each payslip alongside the deterministic rules; the two are cross-checked and disagreements are flagged for you."
            footnote={
              llm.disabledReason ??
              "Values set here override OPENAI_API_KEY, OPENAI_BASE_URL and LLM_MODEL from the environment."
            }
          >
            <LlmForm
              baseUrl={llm.baseUrl}
              model={llm.model}
              hasKey={llm.hasKey}
              keySource={llm.keySource}
              hasStoredKey={llm.hasStoredKey}
            />
          </SettingsSection>
        </Panel>

        <Panel span={6} ariaLabel="Operations" bodyClassName={COLUMN}>
          <SettingsSection title="Scheduled jobs">
            <ul className="hairline-t">
              {JOBS.map((job, index) => {
                const run = successes[index] ?? null;
                return (
                  <li key={job} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                    <span className="min-w-0 flex-1 truncate text-body text-fg">
                      {JOB_LABEL[job] ?? job}
                    </span>
                    <StaleBadge capturedAt={run?.startedAt ?? null} stale={run === null} />
                  </li>
                );
              })}
            </ul>
          </SettingsSection>

          <SettingsSection
            title="Recent runs"
            footnote={<>Current month: <span className="num">{formatMonth(now)}</span>.</>}
          >
            {runs.length === 0 ? (
              <EmptyState
                title="Cron has never fired"
                description="No job has run yet. Either the sidecar is not up, or it cannot reach the app on the internal network."
              />
            ) : (
              <ul className="hairline-t">
                {runs.map((run) => (
                  <li key={run.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">
                        {JOB_LABEL[run.jobName] ?? run.jobName}
                      </span>
                      <span className="num block truncate text-caption text-fg-muted">
                        {RUN_TIME.format(run.startedAt)} · {run.trigger}
                        {run.attempt > 1 && ` · attempt ${run.attempt}`}
                      </span>
                      {run.error !== null && (
                        <span title={run.error} className="block truncate text-caption text-fg-muted">
                          {run.error}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "num shrink-0 text-caption whitespace-nowrap",
                        STATUS_TONE[run.status] ?? "text-fg-muted",
                      )}
                    >
                      {run.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```
The old `settings/page.tsx` also carried a "Funds" list and an "Accounts" pointer. Both move to `personal/page.tsx`'s Panel only if you want them; the spec's page map does not name either, and Finance › Management already owns accounts — so **drop them**, and note it in the Task 20 walkthrough so the missing links are a decision rather than a surprise.

Update `src/app/(app)/finance/vacation/page.tsx`'s "Set it up" link from `/settings` to `/settings/personal`.

- [ ] **Step 5: Run the tests and look at the pages**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS — no route changed, so the OpenAPI drift test stays green. In `npm run dev`, confirm `/settings` lands on Personal, the sidebar shows the five children under Settings for an owner, `/settings/admin` 404s for a principal without `admin.users`, and `/settings/integrations` is the one child still 404ing (Task 18 creates it).

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
- Create: `dashboard-app/src/modules/integrations/ui/styles.ts`
- Create: `dashboard-app/src/modules/integrations/ui/IntegrationsList.tsx`, `ConnectForm.tsx`, `ConnectionActions.tsx`, `DisconnectForm.tsx`, `SyncRunsTable.tsx`
- Create: `dashboard-app/src/app/actions/integrations.ts`, `integrations.test.ts`
- Create: `dashboard-app/src/app/(app)/settings/integrations/page.tsx`, `loading.tsx`, `[provider]/page.tsx`
- Modify: `dashboard-app/src/modules/accounts/ui/AccountsToolbar.tsx` (its Sync control comes back, pointed at the new action)

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
export function syncIntegrationAction(formData: FormData): Promise<ActionResult<{ runId: string; kind: SyncKind; status: SyncRunStatus }>>;
export function disconnectIntegrationAction(formData: FormData): Promise<ActionResult<{ policy: DisconnectPolicy }>>;
```
Form fields: `provider` on all four; `credentials.<fieldName>` on connect (the action rebuilds the object by stripping the `credentials.` prefix); `kind` optional on sync; `policy` on disconnect. `connectIntegrationAction` also reads an optional `policy`, because the REST route accepts one on connect and the two must not diverge — no form in this task sends it.

**`kind` is optional because `runSync` defaults it** (Task 10), not because the action guesses. The Sync button sends no `kind` at all, and the REST route omits it the same way, so there is exactly one rule about what "sync this provider" means.

- [ ] **Step 1: Write the failing action test**

`src/app/actions/integrations.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import { testIntegrationDeps } from "@/test/integration-deps";
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
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => ["row"],
        apply: async () => ({ created: 2 }),
      },
    },
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
    deps = testIntegrationDeps({ registry });
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

  it("syncs with no kind field, defaulting to the provider's only sync, and disconnects", async () => {
    await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "good" }));
    // No `kind` in the form: `runSync` supplies the default, which is why the
    // action does not have to (and cannot disagree with the REST route).
    const synced = await syncIntegrationAction(form({ provider: "wallet" }));
    expect(synced.ok && synced.data.status).toBe("success");
    expect(synced.ok && synced.data.kind).toBe("accounts");
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

`src/modules/integrations/ui/run.ts` in full — the mirror of `src/modules/accounts/ui/run.ts`, including the `NODE_ENV !== "test"` guard inside each setter that makes the seams inert in production:
```ts
import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import type { IntegrationDeps } from "../application/deps";
import { integrationDeps } from "../infrastructure/deps";

export { integrationDeps } from "../infrastructure/deps";

/**
 * Test seams for `runIntegrationsForPrincipal`. Both are no-ops outside
 * `NODE_ENV=test`, so production code can never be redirected by a stray call.
 *
 * Kept in this module, not next to the deps, so a unit test can set them
 * without ever importing `require-principal` (which drags in `@/auth` and,
 * through it, `next/server` — an import graph vitest's unit environment cannot
 * resolve). The function below only reaches for that import dynamically, and
 * only when no test principal is set.
 */
let depsFactoryForTests: (() => IntegrationDeps) | null = null;
let principalForTests: Principal | null = null;

export function setIntegrationDepsFactoryForTests(factory: (() => IntegrationDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setIntegrationPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller and run a use case with pool-bound deps.
 *
 * Unlike the accounts module's twin, this does NOT open a transaction: an
 * integration use case opens its own (Global Constraints), because it has to
 * talk to a provider between them.
 */
export async function runIntegrationsForPrincipal<T>(
  fn: (deps: IntegrationDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  ensureProvidersRegistered();
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return fn(integrationDeps(db), principal);
}
```
`src/modules/integrations/ui/load-integrations.ts` in full:
```ts
import { listIntegrations, type IntegrationSummary } from "../application/list-integrations";
import { runIntegrationsForPrincipal } from "./run";

export function loadIntegrations(): Promise<IntegrationSummary[]> {
  return runIntegrationsForPrincipal((deps, principal) => listIntegrations(deps)(principal));
}

/**
 * One provider's summary, or null for a code no adapter is registered under —
 * which is what turns a bad URL into `notFound()` rather than a crash.
 */
export async function loadIntegration(provider: string): Promise<IntegrationSummary | null> {
  const all = await loadIntegrations();
  return all.find((i) => i.provider === provider) ?? null;
}
```

- [ ] **Step 4: Write the actions**

`src/app/actions/integrations.ts`, in full. Its head, mirroring `src/app/actions/accounts.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  ProviderCode,
  SyncKind,
  SyncRunStatus,
} from "@/platform/integrations/types";
import { connectIntegration } from "@/modules/integrations/application/connect-integration";
import { disconnectIntegration } from "@/modules/integrations/application/disconnect-integration";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  SyncDisabledError,
  UnknownProviderError,
} from "@/modules/integrations/application/errors";
import { runSync } from "@/modules/integrations/application/run-sync";
import { testIntegrationConnection } from "@/modules/integrations/application/test-integration-connection";
import { runIntegrationsForPrincipal } from "@/modules/integrations/ui/run";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

/**
 * Connecting changes the navigation (Expenses and Interests appear once Wallet
 * is connected) and a sync changes balances, so both Finance surfaces are
 * revalidated alongside the Integrations pages.
 */
function revalidateIntegrations(provider: string): void {
  for (const path of [
    "/",
    "/settings/integrations",
    `/settings/integrations/${provider}`,
    "/finance",
    "/finance/accounts",
  ]) {
    revalidatePath(path);
  }
}

function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change integrations.";
  if (err instanceof UnknownProviderError) return "That integration does not exist.";
  if (err instanceof ConnectionNotFoundError) return "This integration is not connected yet.";
  if (err instanceof ConnectionNotUsableError) return err.message;
  if (err instanceof SyncDisabledError) return err.message;
  if (err instanceof CredentialValidationError) return err.message;
  if (err instanceof ConnectionVersionMismatchError) {
    return "Somebody else changed this integration. Reload the page and try again.";
  }
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
Then the four actions:
```ts
export async function connectIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ status: ConnectionStatus; message: string }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  try {
    // A failed TEST is a successful ACTION carrying bad news: that is what lets
    // the form show the provider's own message without discarding what was
    // typed (Ruling P2-6).
    const { connection, test } = await runIntegrationsForPrincipal((deps, principal) =>
      connectIntegration(deps)(principal, {
        provider: provider as ProviderCode,
        credentials: credentialsFrom(formData),
        ...(text(formData.get("policy"))
          ? { disconnectPolicy: text(formData.get("policy")) as DisconnectPolicy }
          : {}),
      }),
    );
    revalidateIntegrations(provider);
    return succeed({ status: connection.status, message: test.message });
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function testIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ ok: boolean; message: string }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  try {
    const result = await runIntegrationsForPrincipal((deps, principal) =>
      testIntegrationConnection(deps)(principal, provider as ProviderCode),
    );
    revalidateIntegrations(provider);
    return succeed(result);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function syncIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ runId: string; kind: SyncKind; status: SyncRunStatus }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  const kind = text(formData.get("kind"));
  try {
    // `kind` is omitted by the Sync button and defaulted inside `runSync`, so
    // this action and the REST route cannot disagree about what "sync" means.
    const run = await runIntegrationsForPrincipal((deps, principal) =>
      runSync(deps)(principal, {
        provider: provider as ProviderCode,
        ...(kind ? { kind: kind as SyncKind } : {}),
        trigger: "manual",
      }),
    );
    revalidateIntegrations(provider);
    if (run.status === "failed") return fail(run.error ?? "The sync failed.");
    return succeed({ runId: run.id, kind: run.kind, status: run.status });
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function disconnectIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ policy: DisconnectPolicy }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  const policy = text(formData.get("policy"));
  try {
    const result = await runIntegrationsForPrincipal((deps, principal) =>
      disconnectIntegration(deps)(
        principal,
        provider as ProviderCode,
        policy ? (policy as DisconnectPolicy) : undefined,
      ),
    );
    revalidateIntegrations(provider);
    return succeed(result);
  } catch (err) {
    return fail(mapError(err));
  }
}
```
`provider` is cast to `ProviderCode` here rather than narrowed: the use case looks it up in the registry and throws `UnknownProviderError` for anything it does not know, which `mapError` turns into "That integration does not exist." The REST route narrows through the registry instead, because it has to answer 404 before the use case runs.

- [ ] **Step 5: Write the shared client-side chrome**

`ErrorInline` and `Toast` are **not** exported from `settings/_components/SettingsForms.tsx` (that file exports only `VacationSetupForm`, `HoursPerDayForm` and `LlmForm`). They live at `@/components/ui/ErrorInline` and `@/components/ui/Toast`. The field/button class constants in `SettingsForms.tsx` are module-private, so the integrations components declare their own, matching values.

`src/modules/integrations/ui/styles.ts` — one module both new client components import, so the two cannot drift:
```ts
/** The same values `settings/_components/SettingsForms.tsx` uses privately. */
export const FIELD =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg";
export const LABEL = "text-caption tracking-wide text-fg-muted uppercase";
export const PRIMARY =
  "inline-flex min-h-11 self-start items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-40";
export const SECONDARY =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";
export const DANGER =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-negative px-4 text-body-sm font-medium text-negative transition-colors hover:bg-negative/5 disabled:opacity-40";

export const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  error: "Error",
  disabled: "Disabled",
  disconnected: "Not connected",
};

export const STATUS_TONE: Record<string, string> = {
  connected: "text-positive",
  error: "text-negative",
  disabled: "text-fg-muted",
  disconnected: "text-fg-muted",
};
```

`src/modules/integrations/ui/IntegrationsList.tsx`:
```tsx
import Link from "next/link";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import type { IntegrationSummary } from "../application/list-integrations";
import { STATUS_LABEL, STATUS_TONE } from "./styles";

/**
 * Every registered provider, connected or not. There is deliberately no empty
 * state: the list IS the call to action, and a provider with no connection is
 * the row you click to make one.
 */
export function IntegrationsList({ items }: { items: readonly IntegrationSummary[] }) {
  return (
    <ul className="hairline-t">
      {items.map((item) => {
        const status = item.connection?.status ?? "disconnected";
        return (
          <li key={item.provider}>
            <Link
              href={`/settings/integrations/${item.provider}`}
              className="flex min-h-11 items-center gap-3 py-3 hairline-b transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg">{item.label}</span>
                <span className="block truncate text-caption text-fg-muted">
                  {item.capabilities.join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn("text-caption", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
                {item.connection && (
                  <StaleBadge
                    capturedAt={item.connection.lastSyncAt}
                    stale={item.connection.lastSyncAt === null}
                  />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

`src/modules/integrations/ui/ConnectForm.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { connectIntegrationAction } from "@/app/actions/integrations";
import type { CredentialField } from "@/platform/integrations/types";
import { FIELD, LABEL, PRIMARY } from "./styles";

export interface ConnectFormProps {
  provider: string;
  fields: readonly CredentialField[];
  connected: boolean;
}

/**
 * The credential form.
 *
 * It renders EMPTY every time, including for a connection that already has a
 * credential: a stored secret is never sent to the browser, so there is nothing
 * to prefill and nothing that could leak into the HTML. Submitting replaces
 * whatever is stored.
 */
export function ConnectForm({ provider, fields, connected }: ConnectFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      for (const field of fields) data.append(`credentials.${field.name}`, values[field.name] ?? "");
      const result = await connectIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A stored-but-failing credential is a success with bad news, so the
      // message is the provider's own either way.
      setValues({});
      setToast(result.data.message);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      {error !== null && <ErrorInline message={error} />}
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1.5">
          <span className={LABEL}>{field.label}</span>
          <input
            type={field.secret ? "password" : "text"}
            value={values[field.name] ?? ""}
            onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))}
            autoComplete="off"
            placeholder={field.placeholder}
            className={FIELD}
          />
        </label>
      ))}
      <button type="submit" disabled={pending} className={PRIMARY}>
        {connected ? "Replace credentials" : "Connect"}
      </button>
      <Toast
        open={toast !== null}
        message={toast ?? ""}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </form>
  );
}
```

`src/modules/integrations/ui/ConnectionActions.tsx` — Test and Sync, the two buttons that need a transition and a message:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { syncIntegrationAction, testIntegrationAction } from "@/app/actions/integrations";
import { SECONDARY } from "./styles";

export function ConnectionActions({ provider }: { provider: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: "test" | "sync") {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      const result = action === "test" ? await testIntegrationAction(data) : await syncIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToast(
        "message" in result.data
          ? result.data.message
          : `Sync finished: ${result.data.kind} (${result.data.status}).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run("test")} className={SECONDARY}>
          Test connection
        </button>
        <button type="button" disabled={pending} onClick={() => run("sync")} className={SECONDARY}>
          Sync now
        </button>
      </div>
      <Toast
        open={toast !== null}
        message={toast ?? ""}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}
```

`src/modules/integrations/ui/DisconnectForm.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { disconnectIntegrationAction } from "@/app/actions/integrations";
import {
  DISCONNECT_POLICIES,
  describeDisconnectPolicy,
} from "@/modules/integrations/domain/connection";
import type { DisconnectPolicy } from "@/platform/integrations/types";
import { DANGER, FIELD, LABEL, SECONDARY } from "./styles";

/**
 * The helper text is `describeDisconnectPolicy(policy)` verbatim — the same
 * sentence the API documents — so the UI can never describe a policy
 * differently from the thing that carries it out.
 *
 * The confirm step is not decoration: `purge` deletes accounts that nothing
 * else references.
 */
export function DisconnectForm({ provider, current }: { provider: string; current: DisconnectPolicy }) {
  const router = useRouter();
  const [policy, setPolicy] = useState<DisconnectPolicy>(current);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      data.append("policy", policy);
      const result = await disconnectIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>What happens to the data</span>
        <select
          value={policy}
          onChange={(event) => {
            setPolicy(event.target.value as DisconnectPolicy);
            setConfirming(false);
          }}
          className={FIELD}
        >
          {DISCONNECT_POLICIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="text-body-sm text-fg-muted">{describeDisconnectPolicy(policy)}</span>
      </label>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={submit} className={DANGER}>
            Yes, disconnect
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={SECONDARY}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={DANGER}>
          Disconnect
        </button>
      )}
    </div>
  );
}
```

`src/modules/integrations/ui/SyncRunsTable.tsx`:
```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";
import type { SyncRun } from "@/platform/integrations/types";

const RUN_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const TONE: Record<string, string> = {
  queued: "text-fg-muted",
  running: "text-fg-muted",
  success: "text-positive",
  failed: "text-negative",
  skipped: "text-fg-muted",
};

function duration(run: SyncRun): string {
  if (!run.finishedAt) return "—";
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function SyncRunsTable({ runs }: { runs: readonly SyncRun[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No syncs yet"
        description="Press Sync now, or wait for the scheduled run."
      />
    );
  }

  return (
    <ul className="hairline-t">
      {runs.map((run) => (
        <li key={run.id} className="flex min-h-11 items-start gap-3 py-2 hairline-b">
          <span className="min-w-0 flex-1">
            <span className="num block text-body-sm text-fg">
              {RUN_TIME.format(run.startedAt)} · {run.kind} · {run.trigger}
            </span>
            <span className="num block truncate text-caption text-fg-muted">
              {Object.entries(run.stats)
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ") || "no changes"}
            </span>
            {run.error !== null && (
              <span title={run.error} className="block truncate text-caption text-negative">
                {run.error}
              </span>
            )}
          </span>
          <span className="shrink-0 text-right">
            <span className={cn("num block text-caption", TONE[run.status] ?? "text-fg-muted")}>
              {run.status}
            </span>
            <span className="num block text-caption text-fg-muted">{duration(run)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Write the two pages**

`src/app/(app)/settings/integrations/page.tsx` in full:
```tsx
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { IntegrationsList } from "@/modules/integrations/ui/IntegrationsList";
import { loadIntegrations } from "@/modules/integrations/ui/load-integrations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const items = await loadIntegrations();
  return (
    <>
      <PageHeader title="Integrations" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Integrations" bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Providers"
            description="Credentials are encrypted at rest and never shown again after you enter them."
          >
            <IntegrationsList items={items} />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```
`src/app/(app)/settings/integrations/loading.tsx` reuses the `Skeleton` component the other settings loaders use, sized for one panel with a four-row list.

`src/app/(app)/settings/integrations/[provider]/page.tsx` in full:
```tsx
import { notFound } from "next/navigation";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import { ConnectForm } from "@/modules/integrations/ui/ConnectForm";
import { ConnectionActions } from "@/modules/integrations/ui/ConnectionActions";
import { DisconnectForm } from "@/modules/integrations/ui/DisconnectForm";
import { SyncRunsTable } from "@/modules/integrations/ui/SyncRunsTable";
import { loadIntegration } from "@/modules/integrations/ui/load-integrations";
import { STATUS_LABEL, STATUS_TONE } from "@/modules/integrations/ui/styles";

export const dynamic = "force-dynamic";

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const summary = await loadIntegration(provider);
  // No adapter under that code: the page does not exist, rather than existing
  // and being empty.
  if (!summary) notFound();

  const connection = summary.connection;
  const status = connection?.status ?? "disconnected";

  return (
    <>
      <PageHeader title={summary.label} />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Connection" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Status">
            <dl className="hairline-t">
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">State</dt>
                <dd className={cn("shrink-0 text-body", STATUS_TONE[status])}>{STATUS_LABEL[status]}</dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Last test</dt>
                <dd className="shrink-0">
                  <StaleBadge capturedAt={connection?.lastTestAt ?? null} stale={!connection?.lastTestAt} />
                </dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Last sync</dt>
                <dd className="shrink-0">
                  <StaleBadge capturedAt={connection?.lastSyncAt ?? null} stale={!connection?.lastSyncAt} />
                </dd>
              </div>
            </dl>
            {connection?.lastError && (
              <ErrorInline className="mt-3" message={connection.lastError} />
            )}
          </SettingsSection>

          <SettingsSection
            title="Credentials"
            footnote="Stored encrypted and never shown again. Submitting replaces what is stored."
          >
            <ConnectForm
              provider={summary.provider}
              fields={summary.credentialFields}
              connected={connection !== null}
            />
          </SettingsSection>

          {connection && (
            <>
              <SettingsSection title="Actions">
                <ConnectionActions provider={summary.provider} />
              </SettingsSection>
              <SettingsSection title="Disconnect">
                <DisconnectForm provider={summary.provider} current={connection.disconnectPolicy} />
              </SettingsSection>
            </>
          )}
        </Panel>

        <Panel span={6} ariaLabel="Recent syncs" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Recent syncs">
            <SyncRunsTable runs={summary.recentRuns} />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
```

Finally, point the Accounts toolbar at the real thing. In `src/modules/accounts/ui/AccountsToolbar.tsx`, change the link Task 11 left behind to `/settings/integrations/wallet` in both variants, and — for the `"header"` variant — replace it with a button calling `syncIntegrationAction(form)` with `provider: "wallet"`, in the same `useTransition` + `Toast` shape it had before. Its success message is now `Sync finished: accounts (success).` rather than the reconciliation counts, because the counts live on the run.

- [ ] **Step 7: Run the tests and use the page**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build`
Expected: PASS. No route changed, so the OpenAPI drift test stays green.

In `npm run dev`: connect Wallet with a real token, see the status turn Connected, press Sync now, see a run appear in the table, and confirm Expenses and Interests have appeared in the Finance navigation.

- [ ] **Step 8: Commit**

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

Now that Task 13's import exists and Tasks 11–12, 16 removed every reader, delete from `src/lib/env.ts`: `WALLET_TOKEN_FILE`, `TREK_TOKEN_FILE`, `walletToken()` and `trekConfig()`. Keep `WALLET_API_URL` (the base URL is configuration, not a credential), keep `export interface TrekConfig` (the adapter builds one), and keep `resetEnvCache()`. Remove `TREK_URL` too — the Trek base URL is now part of the connection's credentials (Ruling P2-C12).

Check first that nothing still reads them, since these are the last removals:
```bash
grep -rn "trekConfig(\|walletToken(\|WALLET_TOKEN_FILE\|TREK_TOKEN_FILE\|TREK_URL" src scripts
```
Expected before the edit: `src/lib/env.ts` (the declarations) and `scripts/import-file-credentials.ts` (which reads the three paths from `process.env` for the one-off migration and must keep doing so). Anything else is a reader Tasks 11, 12 or 16 missed — fix it before deleting.

`src/test/integration-setup.ts` sets `WALLET_API_URL` and no longer needs to mention the token files; drop them from it if they were listed.
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

- [ ] **Step 2: Confirm the API document is already current**

Tasks 11, 14 and 15 each regenerated `docs/api/openapi.json` in the commit that changed a route, so nothing should move here.

Run: `npm run openapi:generate && git diff --stat docs/api/openapi.json && npm test -- openapi-drift`
Expected: **no diff**, and the drift test PASSES. A diff means one of those three tasks skipped its regeneration step; commit it here and note which.

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
- **delete both entries under "Known deviations"** — RLS now covers `audit_events`, `idempotency_keys` and `rate_limit_windows` (Task 3), and the owner-only Wallet sync is gone (Task 11) because a connection has an owner of its own;
- move `integration_connections with encrypted, UI-managed credentials` out of "What's deferred to later phases" and add a new deferred entry: per-user sync schedules — `sync_jobs` rows exist, carry a tier and a cursor, and can switch a kind off, but the cron tiers still dispatch for the owner only;
- describe the webhook path end to end in one paragraph: verify → record the delivery → enqueue a `queued` `sync_runs` row → the hourly `sync_queue` job runs it in the connection owner's user context. This is the one place a reader can learn why a webhook does not sync immediately.

In `docs/api/README.md`:
- add the six integration routes and the webhook to the endpoint table;
- add an **Integrations** section covering the write-only `credentials` object, that `POST /integrations/{provider}/sync` answers `{ run }` and is idempotent per running job, and that `POST /webhooks/{provider}` is the one unauthenticated route (HMAC instead of a session, so no `X-Requested-With`);
- add a **Breaking changes in Phase 2** note: `POST /api/v1/integrations/wallet/sync` keeps its path but now returns `{ run: SyncRun }` — the Phase-1 counts are under `run.stats` — and no longer requires the `owner` role, only `integrations.manage`. Note also that a `sync_runs` row can be `queued`: a webhook-triggered run exists before it has executed.

- [ ] **Step 5: Write the deployment runbook**

`docs/deploy/phase-2-runbook.md`, in order, with the exact commands:
1. Pre-checks: `docker exec postgres pg_dump -U dashboard dashboard > .work/backups/pre-phase2-$(date +%F-%H%M).sql`; keep the current image as `dashboard:pre-phase2`.
2. Generate the key: `printf 'k1:%s' "$(openssl rand -base64 32)"` → `DASHBOARD_APP_ENCRYPTION_KEY` in `.env`. **Back this value up**: without it every stored credential is unrecoverable.
3. Deploy the new image with the token-file volumes **still mounted** and `APP_ENCRYPTION_KEY` set. Migrations `0008`–`0010` apply on boot.
4. Import the credentials: `docker exec dashboard-app node /app/import-file-credentials.mjs` (the bundled build of `scripts/import-file-credentials.ts`), expecting `{"imported":["wallet","trek"],"skipped":[]}`.
5. Verify in the UI: Settings › Integrations shows both as Connected; press Test on each; press Sync now on Wallet and confirm a `success` run whose stats match a normal daily sync.
6. Remove the token files: drop the two volume mounts and `WALLET_TOKEN_FILE`/`TREK_URL`/`TREK_TOKEN_FILE` from `docker-compose.yml`, `docker compose up -d --force-recreate dashboard-app`, and confirm the next hourly tick still syncs.
7. Verify the tick: `curl -H "X-Cron-Secret: $DASHBOARD_CRON_SECRET" -X POST http://dashboard-app:3000/api/jobs/tick?tier=daily` from inside the network, expecting `wallet_accounts_sync: success`. Then the hourly tier, expecting `sync_queue: already_done` with `{"reason":"queue_empty"}` on an install that has received no webhooks — that is the healthy state, not a fault.
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

```bash
npm run typecheck && npm test && npm run test:integration && npm run build && npm run e2e
grep -rn "trekConfig(\|walletToken(" src
```
Expected: every suite PASSES and the grep prints **nothing** — this is the first point in the phase at which it can, and Task 12 deferred it here for that reason. Then `graphify update .` from the repo root.

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
Expected: all five green. `npm test` must include the OpenAPI drift test passing — if it fails, `npm run openapi:generate` was not re-run in Task 11, 14 or 15, each of which owns a route change.

Also confirm no task left a red commit behind:
```bash
git log --oneline main
```
Every commit in the phase should have been green when it was made; the plan has no step that says otherwise.

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
10. The webhook path, end to end. With Wallet connected and a `webhookSecret` set, from inside the network:
    ```bash
    BODY='{"event":"accounts.changed"}'
    SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET_FOR_THE_CONNECTION" -hex | awk '{print $2}')
    curl -s -o /dev/null -w '%{http_code}\n' -X POST http://dashboard-app:3000/api/v1/webhooks/wallet \
      -H 'content-type: application/json' -H "x-signature: sha256=$SIG" -d "$BODY"
    ```
    Expect `202`. Settings › Integrations › Wallet then shows a **queued** run. Fire the hourly tick and reload: the same run is now `success`, and its audit row names the owner rather than the system. An unsigned POST to the same path answers `404`.
11. Note in the checkpoint that the old Settings page's "Funds" list and "Accounts" pointer were dropped rather than moved (Task 17, Step 4) — Finance › Funds and Finance › Management already own both.

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
- **Ruling P2-7: Rulings R10 and R18 (owner-only Wallet sync) are retired in Task 11** (moved there by Ruling P2-C14). Why: they existed only because one file-mounted token had no owner; a connection has a `user_id`, so `integrations.manage` on one's own connection is the whole check; cost if wrong: a member could sync their own connection, which is the intended behaviour.
- **Ruling P2-8: Settings › Security lists the current request's session only, and says so.** Why: Auth.js still issues JWT sessions and spec §8.1 moves them to the database in Phase 8, so there is no session table to list; cost if wrong: the page gains rows rather than changing shape when Phase 8 lands.
- **Ruling P2-9: the operational sections (scheduled jobs, recent runs) and the Payslip AI form move to Settings › Administration, gated on `admin.users`.** Why: spec §4 gives Administration to role admin/owner and these are deployment-wide operational controls, not personal preferences; cost if wrong: a member loses sight of the job log, which the Home freshness badges already summarise.
- **Ruling P2-10: the Vacation fund setup form moves to Settings › Personal until Phase 6 replaces it with a Budget.** Why: it is a per-user money preference and has no other home once Settings splits; cost if wrong: one link moves again in Phase 6, which is already planned.
- **Ruling P2-11: Trek's `onDisconnect` never deletes leave data under any policy.** Why: `leave_days` is written by the dashboard as much as by the sync, so it is the user's own record rather than the provider's; cost if wrong: a user wanting a clean slate deletes days by hand until Phase 7 models `timeoff_events` properly.

The rulings below were taken during the pre-flight conflict scan, before Task 1. They are recorded in `.superpowers/sdd/2026-09-04-phase-2-integrations/progress.md` under the same numbers.

- **Ruling P2-C3: the inbound webhook verifies, records the delivery and enqueues a `queued` `sync_runs` row; the hourly `sync_queue` job drains it.** Spec §3.4 says webhook endpoints "enqueue a job row rather than doing work inline", and a webhook has no principal — so syncing inline would also mean writing a user's rows under `app.role = 'system'`. Implemented in Tasks 5 (the `queued` status), 10 (`enqueueSync`, `drainSyncQueue`, the job) and 15 (the route) — cost if wrong: a webhook-triggered sync is delayed to the next hourly tick instead of being immediate.
- **Ruling P2-C4: `sync_jobs` gets a reader.** The sync engine looks up the row for (connection, kind), refuses a kind whose row says `enabled = false` with `SyncDisabledError`, and stamps `sync_runs.job_id`; `connectIntegration` creates one row per implemented kind. Spec §5.2 names the table and §5.10 indexes runs by job. Tasks 5, 9, 10 — cost if wrong: an unused column if a later phase moves scheduling elsewhere.
- **Ruling P2-C5: `sync_jobs.cursor jsonb` holds per-kind cursor state.** `SyncApplyContext` exposes `cursor` and `setCursor(next)`, and the engine persists it only when the run ends `success`. Spec §6 names "cursor state" in the `SyncContext` it describes. Tasks 5, 6, 10 — cost if wrong: Phase 3's incremental transaction sync has to add it.
- **Ruling P2-C6: `ProviderCode` carries only `wallet` and `trek` this phase.** Spec §6 lists three provider codes; `payroll_silo` arrives in Phase 4 with the document store it needs, as a one-line union widening plus a seed row — cost if wrong: exactly that one-line widening, a phase late.
- **Ruling P2-C7: the `provider_links` unique key gains `user_id`.** Spec §5.2 and §5.10 both state the key without it; this is deferred minor (b) from the Phase 0/1 ledger and must land before a second user exists — cost if wrong: two users could not hold the same external id, which is the bug being fixed.
- **Ruling P2-C8: the framework names `verify(req, secret)` and `toSyncRequests(payload)`.** Spec §6 sketches `verify(req)` and `toJobs(payload)`; the sketch is illustrative TypeScript, a verifier needs the secret it checks against, and what comes back is a sync request rather than a job row — cost if wrong: a rename.
- **Ruling P2-C9: a connection mutation that carries an expected version throws `ConnectionVersionMismatchError` on conflict.** Spec §3.2 requires versioned mutations; `connectIntegration` previously discarded the `"version_mismatch"` return, which would have stored a new credential while silently dropping the settings meant to go with it — cost if wrong: none, this is strictly stricter.
- **Ruling P2-C10: `env()` gains a `resetEnvCache()` test seam and the integration suite gets one setup file.** `env()` validates the whole schema and memoises the result, so per-test `process.env` writes could neither satisfy it nor override it. Task 4 — cost if wrong: a setup file to delete later.
- **Ruling P2-C11: every rubric defect the scan listed is repaired in the plan rather than shipped and flagged in review.** Swallowed errors now throw or name a reason, the duplicated webhook lambdas and payload-event block live in `platform/integrations/webhook-signature.ts`, the four "resolve connection, open credential" blocks are `openConnection`, the five `makeDeps()` copies are `src/test/integration-deps.ts` with a real typed client, the provider seed has one source, and every prose-only step carries real code — cost if wrong: a longer plan.
- **Ruling P2-C12: `TREK_URL` is removed from the environment along with the two token files.** Spec §12 item 10 lists only `WALLET_TOKEN_FILE` and `TREK_TOKEN_FILE`, but the Trek base URL is now part of the connection's credentials (`credentialFields` carries `baseUrl`), so an environment copy would be a second source that could disagree. Task 19 — cost if wrong: one env var to re-add if a deployment ever needs a fallback URL.
- **Ruling P2-C13: an integration use case receives deps bound to the pool and opens its own transactions.** The alternative — the route opening one and handing in a transaction-bound bag, as the accounts module does — puts `provider.testConnection` and a sync's provider fetch inside it, which is the exact defect Task 2 exists to remove. `IntegrationDeps` therefore carries `inUserContext` / `inSystemContext` — cost if wrong: three short transactions per sync instead of one long one, and a deps shape that differs from `UseCaseDeps`.
- **Ruling P2-C14: the Phase-1 wallet sync route and `syncWalletAction` are deleted in Task 11, not Task 14.** They are the last two `walletAccountsSource(clock)` call sites and have no credential to pass, so leaving them would make Task 11's own typecheck step unsatisfiable. Ruling P2-7 is discharged there — cost if wrong: the Accounts page's Sync control is a link to Settings for the span of six commits.

## Self-review against the Phase 2 scope

1. `integration_connections` + supporting tables, migration numbering → **Task 5** (tables, RLS, provider seed; migrations `0008`/`0009` are the two deferred minors, `0010` is the integration schema).
2. Encrypted credential storage with a documented key format → **Task 4**; the one-time import of the mounted Wallet and Trek tokens → **Task 13** (use case + `scripts/import-file-credentials.ts`), executed in **Task 19**'s runbook step 4.
3. Connection lifecycle — connect, test, manual sync trigger, disconnect with the spec's policies → **Task 9** (connect/test/disconnect/list) and **Task 10** (the trigger); the policies are applied by each adapter's `onDisconnect` (**Tasks 11, 12**).
4. Sync runs recorded with status/started/finished/error and surfaced in the UI → **Task 5** (table), **Task 10** (engine), **Task 14** (`GET .../sync-runs`), **Task 18** (`SyncRunsTable`).
4b. Sync **jobs** (spec §11's own bullet) → **Task 5** (table, cursor column), **Task 9** (`connectIntegration` creates one row per implemented kind), **Task 10** (the engine reads it, refuses a disabled kind, stamps `job_id`, persists the cursor). Rulings P2-C4 and P2-C5.
5. Inbound webhook with signature verification → **Task 15**, on the shared helper from **Task 6**, enqueueing rather than syncing inline (spec §3.4, Ruling P2-C3); the queue is drained by the `sync_queue` job in **Task 10**.
6. Wallet and Trek ported onto the framework, existing behaviour and tests green → **Task 11** and **Task 12**.
7. Settings split into Personal / Security / Account / Integrations / Administration → **Task 17** (four areas + nav children from **Task 16**) and **Task 18** (Integrations).
8. Expenses and Interests nav only when Wallet is connected, empty states ready → **Task 16**.
9. Deferred minors: Wallet fetched outside the user transaction → **Task 2**; `provider_links` unique key gains `user_id` → **Task 1**; RLS on `audit_events`/`idempotency_keys`/`rate_limit_windows` (R19) → **Task 3**.
10. Docs — architecture, API + regenerated `openapi.json`, integrations guide, env changes in the deployment doc and `.env.example` → **Task 19**.
11. Exit criteria as a verification task → **Task 20**.

Names used consistently across tasks: `ProviderCode`, `SyncKind`, `SyncTrigger`, `SyncRunStatus`, `SyncSchedule`, `ConnectionStatus`, `DisconnectPolicy`, `IntegrationConnection`, `SyncRun`, `SyncJob`, `TestResult`, `CredentialField`, `SyncFetchContext`, `SyncApplyContext`, `SyncHandler`, `DisconnectContext`, `IntegrationProvider`, `ProviderRegistry`, `SealedCredential`, `CredentialCipher`, `IntegrationDeps`, `ConnectionsRepository`, `SyncJobsRepository`, `SyncRunsRepository`, `WebhookDeliveriesRepository`, `connectIntegration`, `testIntegrationConnection`, `disconnectIntegration`, `listIntegrations`, `openConnection`, `runSync`, `runSyncForUser`, `resumeQueuedSync`, `enqueueSync`, `drainSyncQueue`, `handleWebhook`, `importFileCredentials`, `integrationDeps`, `openOwnerConnection`, `openPrincipalConnection`, `isProviderConnectedForPrincipal`, `runIntegrationsForPrincipal`, `ensureProvidersRegistered`, `providerRegistry`, `verifyHmacSignature`, `hmacSignatureVerifier`, `webhookEventName`, `credentialCipher`, `resetEnvCache`, `testIntegrationDeps`, `unusedDb`, `ownerUserId`, `connectionProbes`, `stateForStatus`, `disabledTrekSync`, `prefetchedWalletSource`, `runSyncQueue`.

Errors, all in `src/modules/integrations/application/errors.ts`: `UnknownProviderError`, `ConnectionNotFoundError`, `CredentialValidationError`, `ConnectionVersionMismatchError`, `SyncNotSupportedError`, `ConnectionNotUsableError`, `SyncDisabledError`. Each has a thrower and a mapping in `toApiError` and in the actions' `mapError`; none is declared without a caller.

Deferred by design to later phases: transactions, categories and interest rules (Phase 3); the document store and payroll uploads (Phase 4); per-user sync **schedules** dispatched from `sync_jobs` (the rows, their tiers, their `enabled` flag and their cursors all exist and are read, but the cron tiers still dispatch for the owner only, and nothing yet exposes a UI for switching a kind off); outbound webhook endpoints and deliveries (Phase 9, reusing `webhook_deliveries.direction`); surfacing `rejected` webhook deliveries, which no page reads this phase; database sessions, MFA, personal access tokens and user administration beyond a read-only list (Phase 8); a bulk credential re-seal job for key rotation (reconnecting each integration is the Phase 2 procedure); rate limiting the public webhook endpoint, which needs a key that is not the principal (Phase 9).

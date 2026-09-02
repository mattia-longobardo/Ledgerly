# Phase 0 + Phase 1: Foundations and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the platform foundations (users, permissions, RLS, versioned API, job tick, capability-driven navigation) and ship the first vertical slice: generic manual and provider-synced accounts with Teable fully retired.

**Architecture:** New code lives under `dashboard-app/src/platform/*` (cross-cutting) and `dashboard-app/src/modules/accounts/*` (domain, application, infrastructure, api, ui). Use cases take a `Principal` and ports (repository interfaces); Drizzle implementations and the Wallet adapter live in infrastructure. A Hono app with `@hono/zod-openapi` is mounted at `/api/v1` inside Next.js; server components and server actions call the same use cases.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7 strict, Drizzle ORM 0.45 + drizzle-kit, Postgres 18, Zod 4, Hono 4 + `@hono/zod-openapi` 1.x, vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-finance-company-platform-design.md` (sections 3, 5.1–5.3, 10.1, 10.3, 11 Phase 0 and Phase 1).

## Global Constraints

- All UI copy, labels, errors and docs in English.
- Money at the DB boundary is a plain decimal string (`numeric(16,2)`) with a three-letter `currency`; domain math uses integer cents via `toCents`/`fromCents` from `src/lib/calc/money.ts`.
- Month keys are `YYYY-MM-01` in Europe/Rome via `monthKey`/`monthKeyOf`/`addMonths` from `src/lib/time.ts`.
- New tables use `uuid` primary keys defaulting to `uuidv7()` (Postgres 18) and carry `created_at`/`updated_at` timestamptz.
- Every mutable entity carries `version integer not null default 1`; updates require the expected version and answer `version_mismatch` on conflict.
- Never invent financial data: a missing source renders an empty or setup state, never a zero.
- No provider field names outside `src/modules/*/infrastructure/*-adapter.ts`.
- Do not create git branches or worktrees (a project hook blocks it). Commit on the checked-out branch after every task.
- Run `graphify update .` from the repo root after each task that changes code.
- All commands below run from `dashboard-app/` unless stated otherwise. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure (what will exist after Phase 1)

```
dashboard-app/
  docker-compose.test.yml                    Postgres 18 for integration tests
  tests/db/init.sql                          creates non-superuser test role
  vitest.integration.config.ts               *.itest.ts runner
  src/test/db.ts                             test DB bootstrap + truncate helper
  src/test/principal.ts                      test principals
  src/lib/db/schema/index.ts                 re-exports legacy + new schema files
  src/lib/db/schema/legacy.ts                the former schema.ts, unchanged
  src/lib/db/schema/identity.ts              organizations, users, identities, roles, audit
  src/lib/db/schema/platform.ts              idempotency_keys, rate_limit_windows
  src/lib/db/schema/accounts.ts              account_groups, accounts, account_balances, provider_links
  src/lib/db/client.ts                       DbClient type
  src/platform/auth/permissions.ts           permission + role catalogue
  src/platform/auth/principal.ts             Principal, resolvePrincipal, requirePrincipal, assertPermission
  src/platform/db/context.ts                 withUserContext (SET LOCAL app.user_id)
  src/platform/http/errors.ts                ApiError + codes + envelope
  src/platform/http/app.ts                   createApiApp(deps) → OpenAPIHono
  src/platform/http/idempotency.ts           middleware
  src/platform/http/rate-limit.ts            middleware
  src/platform/http/versioning.ts            parseExpectedVersion
  src/platform/audit/record.ts               recordAudit
  src/platform/jobs/registry.ts              registerJob, runTier
  src/platform/jobs/register-all.ts          wires existing jobs
  src/platform/capabilities/resolve.ts       resolveCapabilities
  src/platform/capabilities/navigation.ts    buildNavigation
  src/platform/capabilities/probes.ts        real probes
  src/modules/accounts/domain/account.ts     types + deletion rule
  src/modules/accounts/domain/net-worth.ts   series aggregation
  src/modules/accounts/application/ports.ts  repository + source interfaces
  src/modules/accounts/application/*.ts      one use case per file
  src/modules/accounts/infrastructure/drizzle-accounts-repository.ts
  src/modules/accounts/infrastructure/drizzle-provider-links-repository.ts
  src/modules/accounts/infrastructure/memory-repositories.ts
  src/modules/accounts/infrastructure/wallet-adapter.ts
  src/modules/accounts/infrastructure/teable-import.ts
  src/modules/accounts/api/schemas.ts, routes.ts
  src/modules/accounts/ui/*                  loaders and components
  src/modules/home/cards.ts                  Home card registry
  src/app/api/v1/[[...route]]/route.ts       Hono mount
  src/app/api/jobs/tick/route.ts             job tick
  src/app/(app)/finance/accounts/page.tsx, [id]/page.tsx
  src/app/(app)/finance/management/accounts/page.tsx
  scripts/openapi.ts, scripts/migrate-teable.ts, scripts/validate-teable-migration.ts
docs/api/openapi.json, docs/deploy/phase-1-runbook.md, docs/migration/teable-reconciliation.md
```

---

## Phase 0 — Foundations

### Task 1: Integration test infrastructure

**Files:**
- Create: `dashboard-app/docker-compose.test.yml`
- Create: `dashboard-app/tests/db/init.sql`
- Create: `dashboard-app/vitest.integration.config.ts`
- Create: `dashboard-app/src/test/db.ts`
- Create: `dashboard-app/src/lib/db/migrations.itest.ts`
- Modify: `dashboard-app/package.json` (scripts)
- Modify: `dashboard-app/.dockerignore` (add `docker-compose.test.yml`)

**Interfaces:**
- Produces: `testDb(): Promise<NodePgDatabase<typeof schema>>` (migrated, connected as non-superuser `app_test`), `resetDb(): Promise<void>` (truncates every non-migration table), `closeDb(): Promise<void>`.

- [ ] **Step 1: Write the compose file and init script**

`docker-compose.test.yml`:
```yaml
services:
  postgres-test:
    image: postgres:18-alpine
    container_name: dashboard-postgres-test
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: root
      POSTGRES_DB: dashboard_test
    ports: ["55432:5432"]
    volumes:
      - ./tests/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    tmpfs: ["/var/lib/postgresql/data"]
```

`tests/db/init.sql` (a non-superuser owner so `FORCE ROW LEVEL SECURITY` is exercised):
```sql
CREATE ROLE app_test LOGIN PASSWORD 'app_test' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT ALL ON DATABASE dashboard_test TO app_test;
\c dashboard_test
GRANT ALL ON SCHEMA public TO app_test;
```

- [ ] **Step 2: Add the vitest integration config and scripts**

`vitest.integration.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://app_test:app_test@localhost:55432/dashboard_test",
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
```

package.json scripts to add:
```json
"test:db:up": "docker compose -f docker-compose.test.yml up -d --wait",
"test:db:down": "docker compose -f docker-compose.test.yml down -v",
"test:integration": "vitest run --config vitest.integration.config.ts",
"test:all": "npm run test && npm run test:integration"
```

- [ ] **Step 3: Write the failing integration test**

`src/lib/db/migrations.itest.ts`:
```ts
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, testDb } from "@/test/db";

describe("migrations", () => {
  afterAll(closeDb);
  it("apply on an empty database and create the legacy tables", async () => {
    const db = await testDb();
    const res = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
    const names = res.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(["funds", "payslips", "job_runs", "leave_days"]));
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:db:up && npm run test:integration`
Expected: FAIL with `Cannot find module '@/test/db'`.

- [ ] **Step 5: Write the helper**

`src/test/db.ts`:
```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let migrated = false;

export async function testDb(): Promise<NodePgDatabase<typeof schema>> {
  if (db) return db;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests");
  pool = new Pool({ connectionString: url, max: 4 });
  db = drizzle(pool, { schema });
  if (!migrated) {
    await migrate(db, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  return db;
}

/** Truncate everything except drizzle's own bookkeeping. */
export async function resetDb(): Promise<void> {
  const d = await testDb();
  const res = await d.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE '__drizzle%'`);
  const names = res.rows.map((r) => `"${r.table_name}"`);
  if (names.length) await d.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
```

Note: `migrate.ts` also seeds `funds`/`tracked_accounts`; tests that need those rows insert them explicitly.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:integration`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.test.yml tests/db/init.sql vitest.integration.config.ts src/test/db.ts src/lib/db/migrations.itest.ts package.json .dockerignore
git commit -m "test: add Postgres-backed integration test harness"
```

---

### Task 2: Split the schema file and add identity tables

**Files:**
- Move: `dashboard-app/src/lib/db/schema.ts` → `dashboard-app/src/lib/db/schema/legacy.ts`
- Create: `dashboard-app/src/lib/db/schema/index.ts`, `dashboard-app/src/lib/db/schema/identity.ts`
- Create: `dashboard-app/src/lib/db/client.ts`
- Modify: `dashboard-app/drizzle.config.ts` (schema path), `dashboard-app/src/lib/db/migrate.ts` (owner seed)
- Create: `dashboard-app/drizzle/0004_identity.sql` via drizzle-kit
- Test: `dashboard-app/src/lib/db/identity.itest.ts`

**Interfaces:**
- Produces tables `organizations`, `users`, `user_identities`, `roles`, `user_roles`, `audit_events`; Drizzle exports `organizations, users, userIdentities, roles, userRoles, auditEvents`; type `DbClient`.

- [ ] **Step 1: Move the schema and add the index**

```bash
git mv src/lib/db/schema.ts src/lib/db/schema/legacy.ts
```
`src/lib/db/schema/index.ts`:
```ts
export * from "./legacy";
export * from "./identity";
```
`drizzle.config.ts`: change `schema: "./src/lib/db/schema.ts"` to `schema: "./src/lib/db/schema/index.ts"`.

`src/lib/db/client.ts`:
```ts
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
/** Either the pool-backed db or a transaction: repositories accept both. */
export type DbClient = PgDatabase<NodePgQueryResultHKT, typeof schema>;
```

- [ ] **Step 2: Write the identity schema**

`src/lib/db/schema/identity.ts`:
```ts
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  policies: jsonb("policies").notNull().default({}),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email"),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en-GB"),
    timezone: text("timezone").notNull().default("Europe/Rome"),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").notNull().default("active"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    check("users_status_ck", sql`${t.status} IN ('invited','active','suspended','deleted')`),
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`).where(sql`email IS NOT NULL`),
  ],
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    linkedAt: tz("linked_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_identities_provider_subject_uq").on(t.provider, t.subject)],
);

export const roles = pgTable("roles", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleCode: text("role_code").notNull().references(() => roles.code),
    grantedAt: tz("granted_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_roles_uq").on(t.userId, t.roleCode)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc())],
);
```

- [ ] **Step 3: Generate the migration and append seeds**

Run: `npx drizzle-kit generate --name identity`
Then append to the generated `drizzle/0004_identity.sql`:
```sql
--> statement-breakpoint
INSERT INTO roles (code, label) VALUES ('owner','Owner'),('admin','Administrator'),('member','Member'),('viewer','Viewer') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO organizations (name) SELECT 'Personal' WHERE NOT EXISTS (SELECT 1 FROM organizations);
```

- [ ] **Step 4: Add the owner seed to migrate.ts**

Append before the final `console.log(...)` in `src/lib/db/migrate.ts`:
```ts
/**
 * Bootstrap the owner from the legacy allowlist, once. After this the users
 * table governs access and AUTHORIZED_SUB is read only while the table is empty.
 */
const bootstrapSub = process.env.AUTHORIZED_SUB;
if (bootstrapSub) {
  await db.execute(sql`
    WITH org AS (SELECT id FROM organizations ORDER BY created_at LIMIT 1),
    u AS (
      INSERT INTO users (organization_id, email, display_name)
      SELECT org.id, ${process.env.AUTHORIZED_EMAIL ?? null}, 'Owner' FROM org
      WHERE NOT EXISTS (SELECT 1 FROM users)
      RETURNING id
    ),
    r AS (INSERT INTO user_roles (user_id, role_code) SELECT id, 'owner' FROM u)
    INSERT INTO user_identities (user_id, provider, subject) SELECT id, 'authentik', ${bootstrapSub} FROM u
  `);
}
```

- [ ] **Step 5: Write the failing integration test**

`src/lib/db/identity.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, userIdentities, users } from "@/lib/db/schema";

describe("identity schema", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores a user with an OIDC identity and rejects a duplicate subject", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Personal" }).returning();
    const [user] = await db
      .insert(users)
      .values({ organizationId: org!.id, displayName: "Owner" })
      .returning();
    await db.insert(userIdentities).values({ userId: user!.id, provider: "authentik", subject: "sub-1" });
    await expect(
      db.insert(userIdentities).values({ userId: user!.id, provider: "authentik", subject: "sub-1" }),
    ).rejects.toThrow(/user_identities_provider_subject_uq/);
    const [stored] = await db.select().from(users).where(eq(users.id, user!.id));
    expect(stored?.status).toBe("active");
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/db drizzle drizzle.config.ts
git commit -m "feat(platform): split schema and add identity tables with owner bootstrap"
```

---

### Task 3: Permission catalogue and Principal

**Files:**
- Create: `dashboard-app/src/platform/auth/permissions.ts`, `principal.ts`, `principal.test.ts`, `principal.itest.ts`
- Create: `dashboard-app/src/test/principal.ts`

**Interfaces:**
- Produces:
```ts
type Permission = "accounts.read" | "accounts.write" | "accounts.delete" | "finance.manage" | "integrations.manage" | "jobs.run" | "admin.users" | "admin.audit";
type RoleCode = "owner" | "admin" | "member" | "viewer";
interface Principal { userId: string; organizationId: string; roles: RoleCode[]; permissions: ReadonlySet<Permission>; }
permissionsForRoles(roles: readonly RoleCode[]): ReadonlySet<Permission>
resolvePrincipal(db: DbClient, identity: { provider: string; subject: string }): Promise<Principal | null>
requirePrincipal(db?: DbClient): Promise<Principal>            // session → Principal or throws UnauthorizedError
assertPermission(p: Principal, perm: Permission): void          // throws PermissionDeniedError
class PermissionDeniedError extends Error { status: 403; permission: Permission }
```

- [ ] **Step 1: Write the failing unit test**

`src/platform/auth/principal.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "./permissions";
import { assertPermission, PermissionDeniedError, type Principal } from "./principal";

const base = (roles: Principal["roles"]): Principal => ({
  userId: "u1",
  organizationId: "o1",
  roles,
  permissions: permissionsForRoles(roles),
});

describe("permissions", () => {
  it("viewer can read accounts but not write", () => {
    const p = base(["viewer"]);
    expect(p.permissions.has("accounts.read")).toBe(true);
    expect(p.permissions.has("accounts.write")).toBe(false);
  });
  it("owner has every permission", () => {
    expect(base(["owner"]).permissions.size).toBe(8);
  });
  it("assertPermission throws a typed error", () => {
    expect(() => assertPermission(base(["viewer"]), "admin.users")).toThrow(PermissionDeniedError);
    expect(() => assertPermission(base(["admin"]), "admin.users")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/platform/auth/principal.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/platform/auth/permissions.ts`:
```ts
export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "admin.users",
  "admin.audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleCode = "owner" | "admin" | "member" | "viewer";

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  member: ["accounts.read", "accounts.write", "accounts.delete", "finance.manage", "integrations.manage", "jobs.run"],
  viewer: ["accounts.read"],
};

export function permissionsForRoles(roles: readonly RoleCode[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}
```

`src/platform/auth/principal.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { db as defaultDb } from "@/lib/db";
import { userIdentities, userRoles, users } from "@/lib/db/schema";
import { getUserOrNull, UnauthorizedError } from "@/lib/auth/require-user";
import { PROVIDER_ID } from "@/auth";
import { permissionsForRoles, type Permission, type RoleCode } from "./permissions";

export interface Principal {
  userId: string;
  organizationId: string;
  roles: RoleCode[];
  permissions: ReadonlySet<Permission>;
}

export class PermissionDeniedError extends Error {
  readonly status = 403;
  constructor(readonly permission: Permission) {
    super(`Missing permission ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export async function resolvePrincipal(
  db: DbClient,
  identity: { provider: string; subject: string },
): Promise<Principal | null> {
  const [match] = await db
    .select({ userId: users.id, organizationId: users.organizationId, status: users.status })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, identity.provider), eq(userIdentities.subject, identity.subject)))
    .limit(1);
  if (!match || match.status !== "active") return null;
  const roleRows = await db
    .select({ code: userRoles.roleCode })
    .from(userRoles)
    .where(eq(userRoles.userId, match.userId));
  const roles = roleRows.map((r) => r.code as RoleCode);
  return {
    userId: match.userId,
    organizationId: match.organizationId,
    roles,
    permissions: permissionsForRoles(roles),
  };
}

export async function requirePrincipal(db: DbClient = defaultDb): Promise<Principal> {
  const user = await getUserOrNull();
  if (!user) throw new UnauthorizedError();
  const principal = await resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id });
  if (!principal) throw new UnauthorizedError("No active user for this identity");
  return principal;
}

export function assertPermission(p: Principal, permission: Permission): void {
  if (!p.permissions.has(permission)) throw new PermissionDeniedError(permission);
}
```

`src/test/principal.ts`:
```ts
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";

export function testPrincipal(overrides: Partial<Omit<Principal, "permissions">> = {}): Principal {
  const roles: RoleCode[] = overrides.roles ?? ["owner"];
  return {
    userId: overrides.userId ?? "00000000-0000-7000-8000-000000000001",
    organizationId: overrides.organizationId ?? "00000000-0000-7000-8000-0000000000aa",
    roles,
    permissions: permissionsForRoles(roles),
  };
}
```

- [ ] **Step 4: Write the integration test for resolvePrincipal**

`src/platform/auth/principal.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, userIdentities, userRoles, users } from "@/lib/db/schema";
import { resolvePrincipal } from "./principal";

describe("resolvePrincipal", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("maps an identity to roles and permissions; unknown identity is null", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [u] = await db.insert(users).values({ organizationId: org!.id, displayName: "O" }).returning();
    await db.insert(userIdentities).values({ userId: u!.id, provider: "authentik", subject: "s1" });
    await db.execute(sql`INSERT INTO roles (code, label) VALUES ('member', 'Member') ON CONFLICT DO NOTHING`);
    await db.insert(userRoles).values({ userId: u!.id, roleCode: "member" });

    const p = await resolvePrincipal(db, { provider: "authentik", subject: "s1" });
    expect(p?.roles).toEqual(["member"]);
    expect(p?.permissions.has("accounts.write")).toBe(true);
    expect(await resolvePrincipal(db, { provider: "authentik", subject: "nope" })).toBeNull();
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/platform/auth src/test/principal.ts
git commit -m "feat(platform): permission catalogue and Principal resolution"
```

---

### Task 4: Request-scoped user context for RLS

**Files:**
- Create: `dashboard-app/src/platform/db/context.ts`, `context.itest.ts`

**Interfaces:**
- Produces: `withUserContext<T>(db: DbClient, ctx: { userId: string; role?: "user" | "system" }, fn: (tx: DbClient) => Promise<T>): Promise<T>`; `withSystemContext<T>(db: DbClient, fn: (tx: DbClient) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing integration test**

`src/platform/db/context.itest.ts`:
```ts
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, testDb } from "@/test/db";
import { withSystemContext, withUserContext } from "./context";

describe("withUserContext", () => {
  afterAll(closeDb);
  it("sets app.user_id for the transaction only", async () => {
    const db = await testDb();
    const uid = "00000000-0000-7000-8000-000000000001";
    const inside = await withUserContext(db, { userId: uid }, async (tx) => {
      const r = await tx.execute<{ v: string }>(sql`SELECT current_setting('app.user_id', true) AS v`);
      return r.rows[0]?.v;
    });
    expect(inside).toBe(uid);
    const outside = await db.execute<{ v: string | null }>(sql`SELECT current_setting('app.user_id', true) AS v`);
    expect(outside.rows[0]?.v ?? "").toBe("");
    const role = await withSystemContext(db, async (tx) => {
      const r = await tx.execute<{ v: string }>(sql`SELECT current_setting('app.role', true) AS v`);
      return r.rows[0]?.v;
    });
    expect(role).toBe("system");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/platform/db/context.ts`:
```ts
import { sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";

export interface UserContext {
  userId: string;
  role?: "user" | "system";
}

/** set_config(..., true) is transaction-scoped: nothing leaks to the pooled connection. */
export async function withUserContext<T>(
  db: DbClient,
  ctx: UserContext,
  fn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.role', ${ctx.role ?? "user"}, true)`,
    );
    return fn(tx as unknown as DbClient);
  });
}

export async function withSystemContext<T>(db: DbClient, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true)`);
    return fn(tx as unknown as DbClient);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/db
git commit -m "feat(platform): request-scoped user context for row-level security"
```

---

### Task 5: Hono API skeleton with OpenAPI and stable errors

**Files:**
- Create: `dashboard-app/src/platform/http/errors.ts`, `errors.test.ts`, `app.ts`, `app.test.ts`
- Create: `dashboard-app/src/app/api/v1/[[...route]]/route.ts`
- Modify: `dashboard-app/src/middleware.ts:404` add `"/api/v1/"` to `PUBLIC_PREFIXES` (Hono enforces auth there; middleware stays defence-in-depth for pages)
- Modify: `dashboard-app/package.json` dependencies

**Interfaces:**
- Produces:
```ts
type ErrorCode = "validation_failed" | "unauthorized" | "permission_denied" | "not_found" | "conflict" | "version_mismatch" | "idempotency_key_reused" | "rate_limited" | "integration_unavailable" | "internal";
class ApiError extends Error { constructor(status: number, code: ErrorCode, message: string, details?: unknown) }
toErrorBody(err: ApiError, requestId: string): { error: { code; message; requestId; details? } }
interface ApiDeps { db: DbClient; authenticate(req: Request): Promise<Principal | null>; now(): Date; rateLimitEnabled?: boolean }
type ApiEnv = { Variables: { principal: Principal; requestId: string } }
type ApiApp = OpenAPIHono<ApiEnv>
createApiApp(deps: ApiDeps): ApiApp
registerAllRoutes(app: ApiApp, deps: ApiDeps): void   // route modules are added here in later tasks
```

- [ ] **Step 1: Install**

Run: `npm install hono@^4.7 @hono/zod-openapi@^1.0`

- [ ] **Step 2: Write the failing tests**

`src/platform/http/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ApiError, toErrorBody } from "./errors";

describe("ApiError", () => {
  it("serialises to the stable envelope", () => {
    const body = toErrorBody(new ApiError(404, "not_found", "Account not found"), "req-1");
    expect(body).toEqual({ error: { code: "not_found", message: "Account not found", requestId: "req-1" } });
  });
});
```

`src/platform/http/app.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createApiApp } from "./app";
import { testPrincipal } from "@/test/principal";

const deps = {
  db: {} as never,
  authenticate: async (req: Request) => (req.headers.get("x-test-user") ? testPrincipal() : null),
  now: () => new Date("2026-09-02T10:00:00Z"),
  rateLimitEnabled: false,
};

describe("api app", () => {
  it("serves the OpenAPI document to an authenticated caller", async () => {
    const res = await createApiApp(deps).request("/api/v1/openapi.json", { headers: { "x-test-user": "1" } });
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe("Finance Dashboard API");
  });
  it("answers 401 with the error envelope when unauthenticated", async () => {
    const res = await createApiApp(deps).request("/api/v1/openapi.json");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(typeof body.error.requestId).toBe("string");
  });
  it("answers 404 with the envelope for unknown routes", async () => {
    const res = await createApiApp(deps).request("/api/v1/nope", { headers: { "x-test-user": "1" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/platform/http`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement errors.ts**

```ts
export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "version_mismatch"
  | "idempotency_key_reused"
  | "rate_limited"
  | "integration_unavailable"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string; details?: unknown };
}

export function toErrorBody(err: ApiError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}
```

- [ ] **Step 5: Implement app.ts**

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db/client";
import { PermissionDeniedError, type Principal } from "@/platform/auth/principal";
import { ApiError, toErrorBody } from "./errors";

export interface ApiDeps {
  db: DbClient;
  authenticate(req: Request): Promise<Principal | null>;
  now(): Date;
  /** Task 7 wires the Postgres limiter; unit tests without a db pass false. */
  rateLimitEnabled?: boolean;
}
export type ApiEnv = { Variables: { principal: Principal; requestId: string } };
export type ApiApp = OpenAPIHono<ApiEnv>;

export function createApiApp(deps: ApiDeps): ApiApp {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError(422, "validation_failed", "Request validation failed", result.error.issues);
      }
    },
  }).basePath("/api/v1");

  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("x-request-id") ?? randomUUID());
    await next();
    c.header("x-request-id", c.get("requestId"));
  });

  app.use("*", async (c, next) => {
    const principal = await deps.authenticate(c.req.raw);
    if (!principal) throw new ApiError(401, "unauthorized", "Sign in to use the API");
    c.set("principal", principal);
    await next();
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (err instanceof ApiError) return c.json(toErrorBody(err, requestId), err.status as 400);
    if (err instanceof PermissionDeniedError) {
      return c.json(toErrorBody(new ApiError(403, "permission_denied", err.message), requestId), 403);
    }
    console.error(JSON.stringify({ level: "error", event: "api_unhandled", requestId, name: err.name }));
    return c.json(toErrorBody(new ApiError(500, "internal", "Something went wrong"), requestId), 500);
  });
  app.notFound((c) =>
    c.json(toErrorBody(new ApiError(404, "not_found", "No such route"), c.get("requestId") ?? "unknown"), 404),
  );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Finance Dashboard API", version: "1.0.0" },
    servers: [{ url: "/api/v1" }],
  });

  registerAllRoutes(app, deps);
  return app;
}

/** Route modules register here; Task 18 adds accounts. */
export function registerAllRoutes(_app: ApiApp, _deps: ApiDeps): void {}
```
The auth middleware is registered before `app.doc`, so the OpenAPI document itself is authenticated, as the spec requires.

- [ ] **Step 6: Mount in Next.js**

`src/app/api/v1/[[...route]]/route.ts`:
```ts
import { handle } from "hono/vercel";
import { db } from "@/lib/db";
import { PROVIDER_ID } from "@/auth";
import { getUserOrNull } from "@/lib/auth/require-user";
import { resolvePrincipal } from "@/platform/auth/principal";
import { createApiApp } from "@/platform/http/app";

export const dynamic = "force-dynamic";

const app = createApiApp({
  db,
  async authenticate() {
    const user = await getUserOrNull();
    return user ? resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id }) : null;
  },
  now: () => new Date(),
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```
Add `"/api/v1/"` to `PUBLIC_PREFIXES` in `src/middleware.ts` with a comment: Hono's own auth middleware is the gate for `/api/v1`.

- [ ] **Step 7: Run**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS and a successful build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): mount Hono OpenAPI app at /api/v1 with stable error envelope"
```

---

### Task 6: Idempotency keys and optimistic versioning helpers

**Files:**
- Create: `dashboard-app/src/lib/db/schema/platform.ts` (and add `export * from "./platform";` to `schema/index.ts`), migration `0005_platform.sql`
- Create: `dashboard-app/src/platform/http/idempotency.ts`, `idempotency.itest.ts`, `versioning.ts`, `versioning.test.ts`

**Interfaces:**
- Produces: `idempotency(deps: { db: DbClient; now(): Date })` Hono middleware for mutating routes; `parseExpectedVersion(input: { ifMatch: string | null; body: unknown }): number` (throws `ApiError(428, "version_mismatch")` when absent).
- Tables: `idempotency_keys(principal_id uuid, key text, request_hash text, status_code int, response_body jsonb, created_at, expires_at)` PK `(principal_id, key)`; `rate_limit_windows(principal_id uuid, window_start timestamptz, count int)` PK `(principal_id, window_start)`.

- [ ] **Step 1: Schema and migration**

`src/lib/db/schema/platform.ts`:
```ts
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    principalId: uuid("principal_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.key] })],
);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    principalId: uuid("principal_id").notNull(),
    windowStart: tz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.windowStart] })],
);
```
Run: `npx drizzle-kit generate --name platform`

- [ ] **Step 2: Failing tests**

`src/platform/http/versioning.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { parseExpectedVersion } from "./versioning";

describe("parseExpectedVersion", () => {
  it("reads If-Match first, then body.version", () => {
    expect(parseExpectedVersion({ ifMatch: "3", body: { version: 1 } })).toBe(3);
    expect(parseExpectedVersion({ ifMatch: null, body: { version: 2 } })).toBe(2);
  });
  it("throws a 428 when neither is present", () => {
    expect(() => parseExpectedVersion({ ifMatch: null, body: {} })).toThrow(ApiError);
  });
});
```

`src/platform/http/idempotency.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { closeDb, resetDb, testDb } from "@/test/db";
import { idempotency } from "./idempotency";
import { ApiError, toErrorBody } from "./errors";
import { testPrincipal } from "@/test/principal";
import type { Principal } from "@/platform/auth/principal";

describe("idempotency middleware", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("replays the first response for the same key and rejects a different body", async () => {
    const db = await testDb();
    let calls = 0;
    const app = new OpenAPIHono<{ Variables: { principal: Principal } }>();
    app.onError((err, c) =>
      err instanceof ApiError ? c.json(toErrorBody(err, "t"), err.status as 422) : c.text("boom", 500),
    );
    app.use("*", async (c, next) => {
      c.set("principal", testPrincipal());
      await next();
    });
    app.post("/x", idempotency({ db, now: () => new Date() }), async (c) => {
      calls += 1;
      return c.json({ n: calls }, 201);
    });
    const h = { "content-type": "application/json", "idempotency-key": "k1" };
    const a = await app.request("/x", { method: "POST", headers: h, body: JSON.stringify({ v: 1 }) });
    const b = await app.request("/x", { method: "POST", headers: h, body: JSON.stringify({ v: 1 }) });
    expect(await a.json()).toEqual({ n: 1 });
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual({ n: 1 });
    const c2 = await app.request("/x", { method: "POST", headers: h, body: JSON.stringify({ v: 2 }) });
    expect(c2.status).toBe(422);
    const missing = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(428);
  });
});
```

- [ ] **Step 3: Implement**

`src/platform/http/versioning.ts`:
```ts
import { ApiError } from "./errors";

export function parseExpectedVersion(input: { ifMatch: string | null; body: unknown }): number {
  const fromHeader = input.ifMatch ? Number(input.ifMatch.replace(/"/g, "")) : Number.NaN;
  if (Number.isInteger(fromHeader)) return fromHeader;
  const v =
    typeof input.body === "object" && input.body !== null
      ? (input.body as { version?: unknown }).version
      : undefined;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  throw new ApiError(428, "version_mismatch", "Send the current version in If-Match or body.version");
}
```

`src/platform/http/idempotency.ts`:
```ts
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import { idempotencyKeys } from "@/lib/db/schema";
import type { Principal } from "@/platform/auth/principal";
import { ApiError } from "./errors";

const TTL_MS = 24 * 60 * 60 * 1000;

export function idempotency(deps: {
  db: DbClient;
  now(): Date;
}): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  return async (c, next) => {
    const key = c.req.header("idempotency-key");
    if (!key) throw new ApiError(428, "validation_failed", "Idempotency-Key header is required");
    const principalId = c.get("principal").userId;
    const raw = await c.req.raw.clone().text();
    const requestHash = createHash("sha256").update(`${c.req.method} ${c.req.path}\n${raw}`).digest("hex");

    const [existing] = await deps.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (existing && existing.expiresAt > deps.now()) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(422, "idempotency_key_reused", "Idempotency-Key was already used with a different request");
      }
      if (existing.statusCode !== null) return c.json(existing.responseBody as object, existing.statusCode as 200);
    }

    await next();

    const res = c.res.clone();
    const body = await res.json().catch(() => null);
    await deps.db
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
        set: { statusCode: res.status, responseBody: body },
      });
  };
}
```

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): idempotency keys and version-check helpers"
```

---

### Task 7: Rate limiting and audit recording

**Files:**
- Create: `dashboard-app/src/platform/http/rate-limit.ts`, `rate-limit.itest.ts`
- Create: `dashboard-app/src/platform/audit/record.ts`, `record.itest.ts`
- Modify: `dashboard-app/src/platform/http/app.ts` (apply the limiter after auth when `rateLimitEnabled !== false`)

**Interfaces:**
- Produces: `rateLimit(deps: { db: DbClient; now(): Date; limit?: number })` middleware, 300 requests per principal per minute by default, headers `RateLimit-Limit` and `RateLimit-Remaining`; `recordAudit(db: DbClient, e: AuditInput): Promise<void>` where
```ts
interface AuditInput { actorUserId: string | null; action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; requestId?: string | null; ip?: string | null }
```

- [ ] **Step 1: Failing tests**

`src/platform/http/rate-limit.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { closeDb, resetDb, testDb } from "@/test/db";
import { rateLimit } from "./rate-limit";
import { ApiError, toErrorBody } from "./errors";
import { testPrincipal } from "@/test/principal";
import type { Principal } from "@/platform/auth/principal";

describe("rateLimit", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("allows `limit` requests in a window then answers 429", async () => {
    const db = await testDb();
    const app = new OpenAPIHono<{ Variables: { principal: Principal } }>();
    app.onError((err, c) =>
      err instanceof ApiError ? c.json(toErrorBody(err, "t"), err.status as 429) : c.text("boom", 500),
    );
    app.use("*", async (c, next) => {
      c.set("principal", testPrincipal());
      await next();
    });
    app.use("*", rateLimit({ db, now: () => new Date("2026-09-02T10:00:10Z"), limit: 2 }));
    app.get("/", (c) => c.text("ok"));
    expect((await app.request("/")).status).toBe(200);
    const second = await app.request("/");
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    const third = await app.request("/");
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("rate_limited");
  });
});
```

`src/platform/audit/record.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents } from "@/lib/db/schema";
import { recordAudit } from "./record";

describe("recordAudit", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("writes one row with before/after", async () => {
    const db = await testDb();
    await recordAudit(db, {
      actorUserId: null,
      action: "account.create",
      entityType: "account",
      entityId: "a1",
      after: { name: "Cash" },
    });
    const rows = await db.select().from(auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toEqual({ name: "Cash" });
  });
});
```

- [ ] **Step 2: Implement**

`src/platform/http/rate-limit.ts`:
```ts
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import type { Principal } from "@/platform/auth/principal";
import { ApiError } from "./errors";

export function rateLimit(deps: {
  db: DbClient;
  now(): Date;
  limit?: number;
}): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  const limit = deps.limit ?? 300;
  return async (c, next) => {
    const start = new Date(Math.floor(deps.now().getTime() / 60_000) * 60_000);
    const res = await deps.db.execute<{ count: number }>(sql`
      INSERT INTO rate_limit_windows (principal_id, window_start, count)
      VALUES (${c.get("principal").userId}, ${start}, 1)
      ON CONFLICT (principal_id, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
      RETURNING count`);
    const count = Number(res.rows[0]?.count ?? 0);
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, limit - count)));
    if (count > limit) throw new ApiError(429, "rate_limited", "Too many requests; try again in a minute");
    await next();
  };
}
```
In `app.ts`, right after the auth middleware: `if (deps.rateLimitEnabled !== false) app.use("*", rateLimit({ db: deps.db, now: deps.now }));`

`src/platform/audit/record.ts`:
```ts
import type { DbClient } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/schema";

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
}

export async function recordAudit(db: DbClient, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: e.actorUserId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    requestId: e.requestId ?? null,
    ip: e.ip ?? null,
  });
}
```

- [ ] **Step 3: Run**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(platform): per-principal rate limiting and audit recording"
```

---

### Task 8: OpenAPI document generation and drift test

**Files:**
- Create: `dashboard-app/scripts/openapi.ts`, `dashboard-app/src/platform/http/openapi-drift.test.ts`
- Create: `docs/api/openapi.json` (repo root `docs/`)
- Modify: `dashboard-app/package.json` script `"openapi:generate": "tsx scripts/openapi.ts"`

- [ ] **Step 1: Script**

`scripts/openapi.ts`:
```ts
import { writeFileSync } from "node:fs";
import { createApiApp } from "@/platform/http/app";
import { testPrincipal } from "@/test/principal";

export async function buildOpenApiDocument(): Promise<unknown> {
  const app = createApiApp({
    db: {} as never,
    authenticate: async () => testPrincipal(),
    now: () => new Date(0),
    rateLimitEnabled: false,
  });
  const res = await app.request("/api/v1/openapi.json");
  return res.json();
}

if (process.argv[1]?.endsWith("openapi.ts")) {
  const doc = await buildOpenApiDocument();
  writeFileSync(new URL("../../docs/api/openapi.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
  console.log("docs/api/openapi.json written");
}
```
`tsx` honours tsconfig `paths`, so `@/` imports resolve.

- [ ] **Step 2: Drift test**

`src/platform/http/openapi-drift.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../../scripts/openapi";

describe("openapi document", () => {
  it("matches the committed docs/api/openapi.json (run `npm run openapi:generate` to update)", async () => {
    const committed = JSON.parse(
      readFileSync(new URL("../../../../docs/api/openapi.json", import.meta.url), "utf8"),
    );
    expect(await buildOpenApiDocument()).toEqual(committed);
  });
});
```

- [ ] **Step 3: Generate, run, commit**

Run: `mkdir -p ../docs/api && npm run openapi:generate && npm test`
Expected: PASS.
```bash
git add scripts/openapi.ts src/platform/http/openapi-drift.test.ts ../docs/api/openapi.json package.json
git commit -m "feat(api): generate OpenAPI document and fail on drift"
```

---

### Task 9: Job registry and tick endpoint

**Files:**
- Create: `dashboard-app/src/platform/jobs/registry.ts`, `registry.test.ts`, `register-all.ts`
- Create: `dashboard-app/src/app/api/jobs/tick/route.ts`
- Modify: `dashboard-app/src/lib/contracts.ts` (extend the `JobName` union with `"monthly_close" | "wallet_accounts_sync"`)
- Modify: `cron/crontab` (repo root)

**Interfaces:**
- Produces:
```ts
type JobTier = "hourly" | "daily" | "monthly";
interface JobRunInput { trigger: "cron" | "manual"; now: Date }
interface JobDefinition { name: JobName; tier: JobTier; run(input: JobRunInput): Promise<JobResult> }
registerJob(def: JobDefinition): void; listJobs(tier?: JobTier): JobDefinition[]; runTier(tier: JobTier, input: JobRunInput): Promise<JobResult[]>; resetRegistry(): void
ensureJobsRegistered(): void
```

- [ ] **Step 1: Failing test**

`src/platform/jobs/registry.test.ts` (use job names that exist in the `JobName` union of `src/lib/contracts.ts`):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { listJobs, registerJob, resetRegistry, runTier } from "./registry";

describe("job registry", () => {
  beforeEach(resetRegistry);
  it("runs the jobs of a tier in registration order and never throws", async () => {
    const order: string[] = [];
    registerJob({
      name: "sweep",
      tier: "hourly",
      run: async () => {
        order.push("sweep");
        return { job: "sweep", status: "success" };
      },
    });
    registerJob({
      name: "trek_sync",
      tier: "hourly",
      run: async () => {
        throw new Error("boom");
      },
    });
    registerJob({ name: "wallet_refresh", tier: "daily", run: async () => ({ job: "wallet_refresh", status: "success" }) });
    const results = await runTier("hourly", { trigger: "cron", now: new Date() });
    expect(order).toEqual(["sweep"]);
    expect(results.map((r) => r.status)).toEqual(["success", "failed"]);
    expect(listJobs("daily").map((j) => j.name)).toEqual(["wallet_refresh"]);
  });
  it("rejects a duplicate name", () => {
    registerJob({ name: "sweep", tier: "hourly", run: async () => ({ job: "sweep", status: "success" }) });
    expect(() =>
      registerJob({ name: "sweep", tier: "daily", run: async () => ({ job: "sweep", status: "success" }) }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Implement registry.ts**

```ts
import type { JobName, JobResult } from "@/lib/contracts";

export type JobTier = "hourly" | "daily" | "monthly";
export interface JobRunInput {
  trigger: "cron" | "manual";
  now: Date;
}
export interface JobDefinition {
  name: JobName;
  tier: JobTier;
  run(input: JobRunInput): Promise<JobResult>;
}

const jobs = new Map<JobName, JobDefinition>();

export function registerJob(def: JobDefinition): void {
  if (jobs.has(def.name)) throw new Error(`job ${def.name} is already registered`);
  jobs.set(def.name, def);
}

export function listJobs(tier?: JobTier): JobDefinition[] {
  return [...jobs.values()].filter((j) => !tier || j.tier === tier);
}

export async function runTier(tier: JobTier, input: JobRunInput): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const job of listJobs(tier)) {
    try {
      out.push(await job.run(input));
    } catch (err) {
      out.push({ job: job.name, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export function resetRegistry(): void {
  jobs.clear();
}
```

- [ ] **Step 3: Register the existing jobs and add the route**

`src/platform/jobs/register-all.ts` — read the exported `run*` function and its input type in each of `src/lib/jobs/sweep.ts`, `trek-sync-job.ts`, `wallet-refresh.ts`, `monthly-snapshot.ts` and call them with matching arguments:
```ts
import { registerJob } from "./registry";
import { runSweep } from "@/lib/jobs/sweep";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";

let done = false;

export function ensureJobsRegistered(): void {
  if (done) return;
  done = true;
  registerJob({ name: "sweep", tier: "hourly", run: (i) => runSweep({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "trek_sync", tier: "hourly", run: (i) => runTrekSyncJob({ trigger: i.trigger }) });
  registerJob({ name: "wallet_refresh", tier: "daily", run: (i) => runWalletRefresh({ trigger: i.trigger, now: i.now }) });
  registerJob({ name: "monthly_snapshot", tier: "monthly", run: (i) => runMonthlySnapshot({ trigger: i.trigger }) });
}
```
If a job's input type does not accept `trigger: "manual"` or `now`, pass only what it accepts.

`src/app/api/jobs/tick/route.ts`:
```ts
import { verifyCronSecret } from "@/lib/auth/machine";
import { ensureJobsRegistered } from "@/platform/jobs/register-all";
import { runTier, type JobTier } from "@/platform/jobs/registry";

export const dynamic = "force-dynamic";

const TIERS: readonly JobTier[] = ["hourly", "daily", "monthly"];

export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const tier = new URL(req.url).searchParams.get("tier") as JobTier | null;
  if (!tier || !TIERS.includes(tier)) {
    return Response.json({ error: "tier must be hourly, daily or monthly" }, { status: 400 });
  }
  ensureJobsRegistered();
  const results = await runTier(tier, { trigger: "cron", now: new Date() });
  return Response.json({ tier, results }, { status: results.some((r) => r.status === "failed") ? 500 : 200 });
}
```

`cron/crontab` becomes:
```
# Monthly tier — 23:59 on the 1st, TZ=Europe/Rome on the container
59 23 1 * * curl -fsS --retry 3 --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=monthly"
# Hourly tier — sweep then Trek sync, sequentially
7 * * * *  curl -fsS --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=hourly"
# Daily tier — Wallet refresh at local noon
0 12 * * * curl -fsS --retry 3 --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=daily"
```
Keep the four old routes; they still work for manual use.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A . ../cron/crontab
git commit -m "feat(jobs): job registry with tiered tick endpoint"
```

---

### Task 10: Capability resolver and capability-driven navigation

**Files:**
- Create: `dashboard-app/src/platform/capabilities/resolve.ts`, `resolve.test.ts`, `navigation.ts`, `navigation.test.ts`, `probes.ts`
- Modify: `dashboard-app/src/components/layout/AppShell.tsx` (accept an `items` prop instead of the `TABS` constant; icons keyed by `iconKey`)
- Modify: `dashboard-app/src/app/(app)/layout.tsx` (compute items server-side)

**Interfaces:**
- Produces:
```ts
type IntegrationState = "connected" | "error" | "disconnected" | "not_configured";
interface Capabilities {
  features: { accounts: boolean; funds: boolean; budgets: boolean; expenses: boolean; interests: boolean; payroll: boolean; timeoff: boolean };
  integrations: { wallet: IntegrationState; trek: IntegrationState; payroll: IntegrationState };
  permissions: ReadonlySet<Permission>;
  data: { hasAccounts: boolean; hasPayrollRecords: boolean };
}
interface CapabilityProbes { walletConfigured(): boolean; trekConfigured(): boolean; payrollConfigured(): boolean; hasAccounts(): Promise<boolean>; hasPayrollRecords(): Promise<boolean> }
resolveCapabilities(principal: Principal, probes: CapabilityProbes): Promise<Capabilities>
interface NavChild { href: string; label: string }
interface NavItem { href: string; label: string; iconKey: "home" | "finance" | "company" | "settings"; children?: NavChild[] }
buildNavigation(caps: Capabilities): NavItem[]
realProbes: CapabilityProbes
```

- [ ] **Step 1: Failing tests**

`src/platform/capabilities/resolve.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = (o: Partial<{ wallet: boolean; trek: boolean; payroll: boolean }>) => ({
  walletConfigured: () => o.wallet ?? false,
  trekConfigured: () => o.trek ?? false,
  payrollConfigured: () => o.payroll ?? false,
  hasAccounts: async () => true,
  hasPayrollRecords: async () => false,
});

describe("resolveCapabilities", () => {
  it("expenses and interests follow the wallet integration", async () => {
    const off = await resolveCapabilities(testPrincipal(), probes({}));
    expect(off.features.expenses).toBe(false);
    expect(off.integrations.wallet).toBe("not_configured");
    const on = await resolveCapabilities(testPrincipal(), probes({ wallet: true }));
    expect(on.features.expenses).toBe(true);
    expect(on.features.interests).toBe(true);
  });
  it("manual features are always on", async () => {
    const c = await resolveCapabilities(testPrincipal(), probes({}));
    expect(c.features).toMatchObject({ accounts: true, funds: true, budgets: true });
  });
});
```

`src/platform/capabilities/navigation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildNavigation } from "./navigation";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = {
  walletConfigured: () => false,
  trekConfigured: () => false,
  payrollConfigured: () => true,
  hasAccounts: async () => false,
  hasPayrollRecords: async () => false,
};

describe("buildNavigation", () => {
  it("hides Expenses and Interests without wallet and shows Management only with finance.manage", async () => {
    const owner = buildNavigation(await resolveCapabilities(testPrincipal(), probes));
    const finance = owner.find((i) => i.href === "/finance")!;
    expect(finance.children?.map((c) => c.label)).toEqual(["Overview", "Accounts", "Funds", "Budgets", "Management"]);
    const viewer = buildNavigation(await resolveCapabilities(testPrincipal({ roles: ["viewer"] }), probes));
    expect(viewer.find((i) => i.href === "/finance")!.children?.map((c) => c.label)).not.toContain("Management");
  });
});
```
Budgets, Expenses, Interests and Management pages arrive in later phases; Task 17 adds placeholder pages so these links never 404.

- [ ] **Step 2: Implement resolve.ts and navigation.ts**

`src/platform/capabilities/resolve.ts`:
```ts
import type { Principal } from "@/platform/auth/principal";
import type { Permission } from "@/platform/auth/permissions";

export type IntegrationState = "connected" | "error" | "disconnected" | "not_configured";

export interface Capabilities {
  features: {
    accounts: boolean;
    funds: boolean;
    budgets: boolean;
    expenses: boolean;
    interests: boolean;
    payroll: boolean;
    timeoff: boolean;
  };
  integrations: { wallet: IntegrationState; trek: IntegrationState; payroll: IntegrationState };
  permissions: ReadonlySet<Permission>;
  data: { hasAccounts: boolean; hasPayrollRecords: boolean };
}

export interface CapabilityProbes {
  walletConfigured(): boolean;
  trekConfigured(): boolean;
  payrollConfigured(): boolean;
  hasAccounts(): Promise<boolean>;
  hasPayrollRecords(): Promise<boolean>;
}

export async function resolveCapabilities(principal: Principal, probes: CapabilityProbes): Promise<Capabilities> {
  const wallet: IntegrationState = probes.walletConfigured() ? "connected" : "not_configured";
  const trek: IntegrationState = probes.trekConfigured() ? "connected" : "not_configured";
  const payroll: IntegrationState = probes.payrollConfigured() ? "connected" : "not_configured";
  const [hasAccounts, hasPayrollRecords] = await Promise.all([probes.hasAccounts(), probes.hasPayrollRecords()]);
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

`src/platform/capabilities/navigation.ts`:
```ts
import type { Capabilities } from "./resolve";

export interface NavChild {
  href: string;
  label: string;
}
export interface NavItem {
  href: string;
  label: string;
  iconKey: "home" | "finance" | "company" | "settings";
  children?: NavChild[];
}

export function buildNavigation(c: Capabilities): NavItem[] {
  const finance: NavChild[] = [
    { href: "/finance", label: "Overview" },
    { href: "/finance/accounts", label: "Accounts" },
    { href: "/finance/funds", label: "Funds" },
  ];
  if (c.features.expenses) finance.push({ href: "/finance/expenses", label: "Expenses" });
  finance.push({ href: "/finance/budgets", label: "Budgets" });
  if (c.features.interests) finance.push({ href: "/finance/interests", label: "Interests" });
  if (c.permissions.has("finance.manage")) finance.push({ href: "/finance/management", label: "Management" });

  const items: NavItem[] = [
    { href: "/", label: "Home", iconKey: "home" },
    { href: "/finance", label: "Finance", iconKey: "finance", children: finance },
  ];
  if (c.features.payroll || c.features.timeoff) items.push({ href: "/work", label: "Company", iconKey: "company" });
  items.push({ href: "/settings", label: "Settings", iconKey: "settings" });
  return items;
}
```
`/work` keeps its route until Phase 4 renames it; the label already reads Company (spec §12 item 1).

- [ ] **Step 3: Real probes and shell wiring**

`src/platform/capabilities/probes.ts`:
```ts
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env, trekConfig } from "@/lib/env";
import type { CapabilityProbes } from "./resolve";

async function countIsNonZero(query: ReturnType<typeof sql>): Promise<boolean> {
  const res = await db.execute<{ n: string }>(query);
  return (res.rows[0]?.n ?? "0") !== "0";
}

export const realProbes: CapabilityProbes = {
  walletConfigured: () => {
    try {
      return readFileSync(env().WALLET_TOKEN_FILE, "utf8").trim().length > 0;
    } catch {
      return false;
    }
  },
  trekConfigured: () => trekConfig() !== null,
  // Replaced by the document-store probe in Phase 4.
  payrollConfigured: () => Boolean(env().PAPERLESS_URL),
  hasAccounts: () => countIsNonZero(sql`SELECT count(*)::text AS n FROM balance_snapshots`),
  hasPayrollRecords: () => countIsNonZero(sql`SELECT count(*)::text AS n FROM payslips WHERE status = 'verified'`),
};
```
In `src/app/(app)/layout.tsx`: after `requireUserOrRedirect()`, call `const principal = await requirePrincipal(); const caps = await resolveCapabilities(principal, realProbes);` and pass `items={buildNavigation(caps)}` to `AppShell`. In `AppShell.tsx` replace `TABS` with the `items: NavItem[]` prop and an `ICONS: Record<NavItem["iconKey"], ReactNode>` map (reuse the three existing SVGs; add a gear path for settings). Render `children` as an indented list under the active parent on desktop only. Remove the Settings link from `sidebarFooter` since Settings is now a nav item; keep the mobile Home-header settings icon.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. Then `npm run dev` and confirm the sidebar shows Home, Finance (Overview, Accounts, Funds, Budgets, Management), Company, Settings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): capability-resolved navigation"
```

Phase 0 exit check: the pre-existing 39 test files still pass, `/api/v1/openapi.json` answers 200 when signed in, jobs run through the tick endpoint.

---

## Phase 1 — Accounts and Teable retirement

### Task 11: Accounts schema with RLS

**Files:**
- Create: `dashboard-app/src/lib/db/schema/accounts.ts` (and `export * from "./accounts";` in `schema/index.ts`), migration `0006_accounts.sql` with appended RLS statements
- Test: `dashboard-app/src/lib/db/accounts-rls.itest.ts`

**Interfaces:**
- Produces Drizzle exports `accountGroups, accounts, accountBalances, providerLinks` and types `AccountRow, AccountBalanceRow, ProviderLinkRow, AccountGroupRow`.

- [ ] **Step 1: Schema**

`src/lib/db/schema/accounts.ts`:
```ts
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const accountGroups = pgTable(
  "account_groups",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("account_groups_user_name_uq").on(t.userId, t.name)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    groupId: uuid("group_id").references(() => accountGroups.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: text("currency").notNull().default("EUR"),
    origin: text("origin").notNull(),
    provider: text("provider"),
    status: text("status").notNull().default("active"),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    check("accounts_type_ck", sql`${t.type} IN ('checking','savings','cash','investment','pension_fund','crypto','credit','other')`),
    check("accounts_origin_ck", sql`${t.origin} IN ('manual','synced')`),
    check("accounts_status_ck", sql`${t.status} IN ('active','unavailable','archived')`),
    check("accounts_currency_ck", sql`char_length(${t.currency}) = 3`),
    index("accounts_user_idx").on(t.userId, t.sortOrder),
  ],
);

export const accountBalances = pgTable(
  "account_balances",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    asOf: date("as_of").notNull(),
    balance: money("balance").notNull(),
    available: money("available"),
    source: text("source").notNull(),
    capturedAt: tz("captured_at").notNull().defaultNow(),
    syncRunId: uuid("sync_run_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("account_balances_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("account_balances_uq").on(t.accountId, t.asOf, t.source),
    index("account_balances_account_asof_idx").on(t.accountId, t.asOf.desc()),
  ],
);

export const providerLinks = pgTable(
  "provider_links",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    externalParentId: text("external_parent_id"),
    metadata: jsonb("metadata").notNull().default({}),
    firstSeenAt: tz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    missingSince: tz("missing_since"),
  },
  (t) => [
    uniqueIndex("provider_links_external_uq").on(t.provider, t.entityType, t.externalId),
    uniqueIndex("provider_links_entity_uq").on(t.provider, t.entityType, t.entityId),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type AccountBalanceRow = typeof accountBalances.$inferSelect;
export type ProviderLinkRow = typeof providerLinks.$inferSelect;
export type AccountGroupRow = typeof accountGroups.$inferSelect;
```

- [ ] **Step 2: Generate and append RLS**

Run `npx drizzle-kit generate --name accounts`, then append to `drizzle/0006_accounts.sql` (one statement per breakpoint):
```sql
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role', true) = 'system' $$;
--> statement-breakpoint
ALTER TABLE account_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_groups_owner ON account_groups USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_owner ON accounts USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_balances_owner ON account_balances USING (app_is_system() OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_id AND a.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_id AND a.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE provider_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_links_owner ON provider_links USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
```

- [ ] **Step 3: RLS test**

`src/lib/db/accounts-rls.itest.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("accounts RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("a user sees only their own accounts; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    await withSystemContext(db, async (tx) => {
      await tx.insert(accounts).values([
        { userId: a!.id, name: "A cash", type: "cash", origin: "manual" },
        { userId: b!.id, name: "B cash", type: "cash", origin: "manual" },
      ]);
    });
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(accounts));
    expect(mine.map((r) => r.name)).toEqual(["A cash"]);
    expect((await withSystemContext(db, (tx) => tx.select().from(accounts))).length).toBe(2);
    expect(await db.select().from(accounts)).toEqual([]);
    await expect(
      withUserContext(db, { userId: a!.id }, (tx) =>
        tx.insert(accounts).values({ userId: b!.id, name: "x", type: "cash", origin: "manual" }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
```

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(accounts): accounts, balances and provider links with row-level security"
```

---

### Task 12: Accounts domain, ports and in-memory repositories

**Files:**
- Create: `dashboard-app/src/modules/accounts/domain/account.ts`, `account.test.ts`, `net-worth.ts`, `net-worth.test.ts`
- Create: `dashboard-app/src/modules/accounts/application/ports.ts`
- Create: `dashboard-app/src/modules/accounts/infrastructure/memory-repositories.ts`

**Interfaces:**
```ts
// domain/account.ts
type AccountType = "checking" | "savings" | "cash" | "investment" | "pension_fund" | "crypto" | "credit" | "other";
type AccountStatus = "active" | "unavailable" | "archived";
type AccountOrigin = "manual" | "synced";
type BalanceSource = "manual" | "provider" | "system" | "migration";
interface Account { id: string; userId: string; groupId: string | null; name: string; type: AccountType; currency: string; origin: AccountOrigin; provider: string | null; status: AccountStatus; includeInNetWorth: boolean; notes: string | null; sortOrder: number; version: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date }
interface BalancePoint { accountId: string; asOf: string /* YYYY-MM-DD */; balance: string; available: string | null; source: BalanceSource; capturedAt: Date }
type DeletionDecision = "hard_delete" | "archive" | "blocked_linked";
deletionDecision(a: Account, facts: { hasLiveProviderLink: boolean; hasReferences: boolean }): DeletionDecision
// domain/net-worth.ts
monthlySeries(points: readonly BalancePoint[], months: readonly string[]): MonthPoint[]     // last balance per month, carried forward
totalSeries(perAccount: readonly (readonly MonthPoint[])[], months: readonly string[]): MonthPoint[]
// application/ports.ts
type NewAccount = Omit<Account, "id" | "version" | "createdAt" | "updatedAt" | "archivedAt">;
type AccountPatch = Partial<Pick<Account, "name" | "type" | "currency" | "groupId" | "includeInNetWorth" | "notes" | "sortOrder" | "status" | "archivedAt" | "provider" | "origin">>;
type NewBalance = Omit<BalancePoint, "capturedAt"> & { capturedAt?: Date };
interface AccountsRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Account[]>;
  get(userId: string, id: string): Promise<Account | null>;
  create(input: NewAccount): Promise<Account>;
  update(userId: string, id: string, expectedVersion: number, patch: AccountPatch): Promise<Account | "version_mismatch" | null>;
  delete(userId: string, id: string): Promise<boolean>;
  latestBalances(userId: string): Promise<Map<string, BalancePoint>>;     // keyed by accountId
  history(userId: string, accountIds: string[], sinceAsOf: string): Promise<BalancePoint[]>;
  recordBalances(rows: NewBalance[]): Promise<void>;                      // upsert on (accountId, asOf, source)
  hasReferences(accountId: string): Promise<boolean>;                     // false in Phase 1; budgets and interest rules will consult it
}
interface ProviderLink { provider: string; entityType: "account"; entityId: string; externalId: string; metadata: Record<string, unknown>; missingSince: Date | null }
interface ProviderLinksRepository {
  byExternal(userId: string, provider: string, entityType: "account", externalIds: string[]): Promise<Map<string, ProviderLink>>;  // keyed by externalId
  liveFor(entityType: "account", entityId: string): Promise<ProviderLink | null>;   // null when missingSince is set
  upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void>;
  markMissing(userId: string, provider: string, entityType: "account", seenExternalIds: string[], at: Date): Promise<string[]>;  // entityIds newly marked missing
}
interface ProviderAccount { externalId: string; name: string; type: AccountType; currency: string; archived: boolean; balance: string; available: string | null; asOf: string; updatedAt: Date | null }
interface AccountsSource { provider: string; fetchAccounts(): Promise<ProviderAccount[]> }
interface Clock { now(): Date }
// infrastructure/memory-repositories.ts
class MemoryAccountsRepository implements AccountsRepository
class MemoryProviderLinksRepository implements ProviderLinksRepository
class MemoryClock implements Clock { constructor(at: Date); set(at: Date): void }
```

- [ ] **Step 1: Failing domain tests**

`src/modules/accounts/domain/account.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deletionDecision, type Account } from "./account";

const base: Account = {
  id: "a", userId: "u", groupId: null, name: "Cash", type: "cash", currency: "EUR", origin: "manual", provider: null,
  status: "active", includeInNetWorth: true, notes: null, sortOrder: 0, version: 1, archivedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("deletionDecision", () => {
  it("manual + unreferenced → hard delete", () => {
    expect(deletionDecision(base, { hasLiveProviderLink: false, hasReferences: false })).toBe("hard_delete");
  });
  it("manual + referenced → archive", () => {
    expect(deletionDecision(base, { hasLiveProviderLink: false, hasReferences: true })).toBe("archive");
  });
  it("synced with a live link → blocked", () => {
    expect(deletionDecision({ ...base, origin: "synced", provider: "wallet" }, { hasLiveProviderLink: true, hasReferences: false })).toBe("blocked_linked");
  });
  it("synced but missing upstream → archive", () => {
    expect(deletionDecision({ ...base, origin: "synced", status: "unavailable" }, { hasLiveProviderLink: false, hasReferences: false })).toBe("archive");
  });
});
```

`src/modules/accounts/domain/net-worth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { monthlySeries, totalSeries } from "./net-worth";

const p = (asOf: string, balance: string) => ({
  accountId: "a", asOf, balance, available: null, source: "manual" as const, capturedAt: new Date(`${asOf}T12:00:00Z`),
});

describe("monthlySeries", () => {
  it("takes the last balance of each month and carries forward gaps", () => {
    const s = monthlySeries(
      [p("2026-01-05", "10.00"), p("2026-01-20", "12.50"), p("2026-03-01", "20.00")],
      ["2026-01-01", "2026-02-01", "2026-03-01"],
    );
    expect(s).toEqual([
      { month: "2026-01-01", value: 12.5 },
      { month: "2026-02-01", value: 12.5 },
      { month: "2026-03-01", value: 20 },
    ]);
  });
  it("is null before the first known value", () => {
    expect(monthlySeries([p("2026-02-01", "5.00")], ["2026-01-01", "2026-02-01"])[0]?.value).toBeNull();
  });
});

describe("totalSeries", () => {
  it("sums per-month values in cents and keeps null when nothing is known", () => {
    const t = totalSeries(
      [
        [{ month: "2026-01-01", value: 0.1 }, { month: "2026-02-01", value: 0.2 }],
        [{ month: "2026-01-01", value: null }, { month: "2026-02-01", value: 0.1 }],
      ],
      ["2026-01-01", "2026-02-01"],
    );
    expect(t).toEqual([{ month: "2026-01-01", value: 0.1 }, { month: "2026-02-01", value: 0.3 }]);
  });
});
```

- [ ] **Step 2: Implement the domain**

`account.ts` holds the types above plus:
```ts
export function deletionDecision(
  a: Account,
  f: { hasLiveProviderLink: boolean; hasReferences: boolean },
): DeletionDecision {
  if (a.origin === "synced" && f.hasLiveProviderLink) return "blocked_linked";
  if (f.hasReferences || a.origin === "synced") return "archive";
  return "hard_delete";
}
```
`net-worth.ts`:
```ts
import type { MonthPoint } from "@/lib/contracts";
import { fromCents, toCents } from "@/lib/calc/money";
import { monthKeyOf } from "@/lib/time";
import type { BalancePoint } from "./account";

export function monthlySeries(points: readonly BalancePoint[], months: readonly string[]): MonthPoint[] {
  const lastByMonth = new Map<string, BalancePoint>();
  const ordered = [...points].sort(
    (x, y) => x.asOf.localeCompare(y.asOf) || x.capturedAt.getTime() - y.capturedAt.getTime(),
  );
  for (const p of ordered) lastByMonth.set(monthKeyOf(p.asOf), p);
  let carry: number | null = null;
  return months.map((month) => {
    const hit = lastByMonth.get(month);
    if (hit) carry = toCents(hit.balance);
    return { month, value: carry === null ? null : fromCents(carry) };
  });
}

export function totalSeries(perAccount: readonly (readonly MonthPoint[])[], months: readonly string[]): MonthPoint[] {
  return months.map((month, i) => {
    let sum: number | null = null;
    for (const series of perAccount) {
      const v = series[i]?.value ?? null;
      if (v !== null) sum = (sum ?? 0) + (toCents(v) ?? 0);
    }
    return { month, value: sum === null ? null : fromCents(sum) };
  });
}
```

- [ ] **Step 3: Ports file and in-memory repositories**

Write `ports.ts` exactly as in Interfaces. `memory-repositories.ts` implements both repositories over arrays with the same semantics: `update` returns `"version_mismatch"` when the stored version differs and increments `version` on success; `recordBalances` upserts on `(accountId, asOf, source)`; `latestBalances` picks the greatest `asOf` (then latest `capturedAt`) per account; `markMissing` sets `missingSince` for links of that provider not in `seenExternalIds` and returns their `entityId`s; `liveFor` returns a link only when `missingSince === null`; `upsertSeen` clears `missingSince`. `MemoryClock` holds a settable date. Generate ids with `crypto.randomUUID()`.

- [ ] **Step 4: Run**

Run: `npx vitest run src/modules/accounts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts
git commit -m "feat(accounts): domain rules, ports and in-memory repositories"
```

---

### Task 13: Use cases for manual accounts and balances

**Files:**
- Create under `dashboard-app/src/modules/accounts/application/`: `deps.ts`, `errors.ts`, `create-manual-account.ts`, `update-account.ts`, `delete-account.ts`, `record-manual-balance.ts`, `list-accounts.ts`, `get-account-detail.ts`, `use-cases.test.ts`

**Interfaces:**
```ts
// deps.ts
interface UseCaseDeps { accounts: AccountsRepository; links: ProviderLinksRepository; clock: Clock; audit(e: AuditInput): Promise<void> }
// errors.ts
class NotFoundError extends Error {}                       // message "Account not found"
class VersionMismatchError extends Error {}
class DeletionBlockedError extends Error { readonly reason = "linked" }
class InvalidInputError extends Error { constructor(message: string, readonly issues?: unknown) }
// use cases (each file exports the Zod input schema too)
createManualAccountSchema; createManualAccount(deps)(p: Principal, input: { name: string; type: AccountType; currency?: string; groupId?: string | null; includeInNetWorth?: boolean; notes?: string | null; openingBalance?: { asOf: string; balance: string } }): Promise<Account>
updateAccountSchema; updateAccount(deps)(p, id: string, expectedVersion: number, patch: { name?: string; type?: AccountType; currency?: string; groupId?: string | null; includeInNetWorth?: boolean; notes?: string | null; sortOrder?: number }): Promise<Account>
deleteAccount(deps)(p, id: string, opts?: { confirmSynced?: boolean }): Promise<{ outcome: "deleted" | "archived" }>
recordManualBalanceSchema; recordManualBalance(deps)(p, id: string, input: { asOf: string; balance: string; available?: string | null }): Promise<void>
interface AccountListItem { account: Account; latest: BalancePoint | null; trend: MonthPoint[]; stale: boolean }
listAccounts(deps)(p, opts?: { months?: number; includeArchived?: boolean }): Promise<AccountListItem[]>
interface AccountDetail { account: Account; latest: BalancePoint | null; history: BalancePoint[]; series: MonthPoint[]; link: ProviderLink | null; stale: boolean }
getAccountDetail(deps)(p, id: string, opts?: { months?: number }): Promise<AccountDetail>
```
Rules: `accounts.read` for list and detail; `accounts.write` for create, update, balance; `accounts.delete` for delete. For synced accounts a patch may change `name`, `groupId`, `includeInNetWorth`, `notes`, `sortOrder` but not `type` or `currency` (throw `InvalidInputError`). `asOf` later than the clock's Rome date is rejected with "Balance date cannot be in the future". `stale` is true for a synced account whose latest `capturedAt` is older than 36 hours; a manual account is never stale. Every mutation records one audit event (`account.create`, `account.update`, `account.delete`, `account.archive`, `account.balance`).

- [ ] **Step 1: Failing tests**

`src/modules/accounts/application/use-cases.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MemoryAccountsRepository, MemoryClock, MemoryProviderLinksRepository } from "../infrastructure/memory-repositories";
import { createManualAccount } from "./create-manual-account";
import { deleteAccount } from "./delete-account";
import { recordManualBalance } from "./record-manual-balance";
import { listAccounts } from "./list-accounts";
import { updateAccount } from "./update-account";
import { DeletionBlockedError, VersionMismatchError } from "./errors";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";

function harness() {
  const audit: unknown[] = [];
  const deps = {
    accounts: new MemoryAccountsRepository(),
    links: new MemoryProviderLinksRepository(),
    clock: new MemoryClock(new Date("2026-09-02T12:00:00Z")),
    audit: async (e: unknown) => {
      audit.push(e);
    },
  };
  return { deps, audit };
}

describe("accounts use cases", () => {
  it("creates a manual account with an opening balance and audits it", async () => {
    const { deps, audit } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), {
      name: "EToro", type: "investment", openingBalance: { asOf: "2026-08-31", balance: "1234.50" },
    });
    expect(a.origin).toBe("manual");
    const [item] = await listAccounts(deps)(testPrincipal());
    expect(item?.latest?.balance).toBe("1234.50");
    expect(audit).toHaveLength(1);
  });

  it("viewer cannot create", async () => {
    const { deps } = harness();
    await expect(
      createManualAccount(deps)(testPrincipal({ roles: ["viewer"] }), { name: "x", type: "cash" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("update requires the current version", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await updateAccount(deps)(testPrincipal(), a.id, 1, { name: "y" });
    await expect(updateAccount(deps)(testPrincipal(), a.id, 1, { name: "z" })).rejects.toThrow(VersionMismatchError);
  });

  it("rejects a future balance date", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await expect(
      recordManualBalance(deps)(testPrincipal(), a.id, { asOf: "2027-01-01", balance: "1" }),
    ).rejects.toThrow(/future/);
  });

  it("hard-deletes an unreferenced manual account and blocks a live synced one", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    expect(await deleteAccount(deps)(testPrincipal(), a.id)).toEqual({ outcome: "deleted" });
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await deps.links.upsertSeen(
      testPrincipal().userId,
      { provider: "wallet", entityType: "account", entityId: synced.id, externalId: "ext-1", metadata: {} },
      new Date(),
    );
    await expect(deleteAccount(deps)(testPrincipal(), synced.id)).rejects.toThrow(DeletionBlockedError);
  });

  it("cannot see another user's account", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    const other = testPrincipal({ userId: "00000000-0000-7000-8000-000000000002" });
    await expect(updateAccount(deps)(other, a.id, 1, { name: "y" })).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/modules/accounts/application`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Each use case follows this shape (shown for create; the others mirror it):
```ts
import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import { romeDate } from "@/lib/time";
import type { Account } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import { InvalidInputError } from "./errors";

export const createManualAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  type: z.enum(["checking", "savings", "cash", "investment", "pension_fund", "crypto", "credit", "other"]),
  currency: z.string().length(3).toUpperCase().default("EUR"),
  groupId: z.string().uuid().nullable().optional(),
  includeInNetWorth: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
  openingBalance: z
    .object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/) })
    .optional(),
});
export type CreateManualAccountInput = z.input<typeof createManualAccountSchema>;

export function createManualAccount(deps: UseCaseDeps) {
  return async (principal: Principal, raw: CreateManualAccountInput): Promise<Account> => {
    assertPermission(principal, "accounts.write");
    const parsed = createManualAccountSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const input = parsed.data;
    if (input.openingBalance && input.openingBalance.asOf > romeDate(deps.clock.now())) {
      throw new InvalidInputError("Balance date cannot be in the future");
    }
    const account = await deps.accounts.create({
      userId: principal.userId, groupId: input.groupId ?? null, name: input.name, type: input.type,
      currency: input.currency, origin: "manual", provider: null, status: "active",
      includeInNetWorth: input.includeInNetWorth, notes: input.notes ?? null, sortOrder: 0,
    });
    if (input.openingBalance) {
      await deps.accounts.recordBalances([{
        accountId: account.id, asOf: input.openingBalance.asOf, balance: input.openingBalance.balance,
        available: null, source: "manual", capturedAt: deps.clock.now(),
      }]);
    }
    await deps.audit({ actorUserId: principal.userId, action: "account.create", entityType: "account", entityId: account.id, after: account });
    return account;
  };
}
```
`listAccounts` computes `trend` with `monthlySeries` over `history(userId, ids, addMonths(monthKey(now), -(months - 1)))` with `months` defaulting to 13, and `stale` per the rule above. `deleteAccount` calls `deletionDecision` with `hasLiveProviderLink = (await deps.links.liveFor("account", id)) !== null` and `hasReferences = await deps.accounts.hasReferences(id)`; `blocked_linked` throws `DeletionBlockedError` unless `opts.confirmSynced` is true, in which case it archives; `archive` sets `status: "archived", archivedAt: now` through `update`.

- [ ] **Step 4: Run**

Run: `npx vitest run src/modules/accounts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts
git commit -m "feat(accounts): manual account use cases"
```

---

### Task 14: Drizzle repositories

**Files:**
- Create: `dashboard-app/src/modules/accounts/infrastructure/drizzle-accounts-repository.ts`, `drizzle-provider-links-repository.ts`, `repositories.itest.ts`

**Interfaces:**
- `class DrizzleAccountsRepository implements AccountsRepository { constructor(db: DbClient) }`
- `class DrizzleProviderLinksRepository implements ProviderLinksRepository { constructor(db: DbClient) }`

- [ ] **Step 1: Failing integration test**

`repositories.itest.ts` seeds an organization and a user, then inside `withUserContext(db, { userId }, ...)` asserts: create then get then list (ordered by `sortOrder`, then `name`); `update` with the right version increments `version` and with a stale version returns `"version_mismatch"`; `recordBalances` twice for the same `(accountId, asOf, source)` leaves one row with the second balance; `latestBalances` returns the greatest `asOf` per account; `history` excludes rows before `sinceAsOf`; `upsertSeen` then `byExternal` finds the link; `markMissing` with an empty seen list returns the entity id and `liveFor` then returns null; `upsertSeen` again clears `missingSince`.

- [ ] **Step 2: Implement**

Key fragments for `DrizzleAccountsRepository`:
```ts
async update(userId: string, id: string, expectedVersion: number, patch: AccountPatch) {
  const [row] = await this.db
    .update(accounts)
    .set({ ...patch, version: sql`${accounts.version} + 1`, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id), eq(accounts.version, expectedVersion)))
    .returning();
  if (row) return toAccount(row);
  return (await this.get(userId, id)) ? "version_mismatch" : null;
}

async recordBalances(rows: NewBalance[]) {
  if (rows.length === 0) return;
  await this.db
    .insert(accountBalances)
    .values(rows.map((r) => ({ accountId: r.accountId, asOf: r.asOf, balance: r.balance, available: r.available, source: r.source, capturedAt: r.capturedAt ?? new Date() })))
    .onConflictDoUpdate({
      target: [accountBalances.accountId, accountBalances.asOf, accountBalances.source],
      set: { balance: sql`excluded.balance`, available: sql`excluded.available`, capturedAt: sql`excluded.captured_at` },
    });
}

async latestBalances(userId: string) {
  const res = await this.db.execute<{ account_id: string; as_of: string; balance: string; available: string | null; source: string; captured_at: string }>(sql`
    SELECT DISTINCT ON (b.account_id) b.account_id, b.as_of::text, b.balance, b.available, b.source, b.captured_at
    FROM account_balances b JOIN accounts a ON a.id = b.account_id
    WHERE a.user_id = ${userId}
    ORDER BY b.account_id, b.as_of DESC, b.captured_at DESC`);
  return new Map(res.rows.map((r) => [r.account_id, { accountId: r.account_id, asOf: r.as_of, balance: r.balance, available: r.available, source: r.source as BalanceSource, capturedAt: new Date(r.captured_at) }]));
}
```
Raw `execute` returns `as_of` and `captured_at` as strings; always convert as shown. `hasReferences` returns `false` in Phase 1 with a comment naming the future consumers.

- [ ] **Step 3: Run**

Run: `npm run typecheck && npm run test:integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounts/infrastructure
git commit -m "feat(accounts): Drizzle repositories"
```

---

### Task 15: Wallet adapter and provider account sync

**Files:**
- Modify: `dashboard-app/src/lib/clients/wallet.ts:12-25` — extend `accountSchema` with `id: z.string()`, `archived: z.boolean().default(false)`, `accountType: z.string().optional()`, `isInvestmentAccount: z.boolean().optional()`, `updatedAt: z.string().optional()`; leave `reduceBalances`/`getBalances` untouched (used until Task 20)
- Create: `dashboard-app/src/modules/accounts/infrastructure/wallet-adapter.ts`, `wallet-adapter.test.ts`
- Create: `dashboard-app/src/modules/accounts/application/sync-provider-accounts.ts`, `sync-provider-accounts.test.ts`
- Create: `dashboard-app/src/lib/jobs/wallet-accounts-sync.ts`; register it in `src/platform/jobs/register-all.ts` (tier `daily`, after `wallet_refresh`)

**Interfaces:**
- `mapWalletAccount(raw: WalletAccount, asOf: string): ProviderAccount`
- `walletAccountsSource(clock: Clock): AccountsSource` (provider `"wallet"`, calls `getAccounts()` from `@/lib/clients/wallet`)
- `syncProviderAccounts(deps: UseCaseDeps & { source: AccountsSource })(userId: string): Promise<{ created: number; updated: number; adopted: number; balances: number; missing: number }>`
- Type mapping: `Cash`→`cash`; `General`, `Checking`, `Current`→`checking`; `Saving`, `Savings`→`savings`; `Investment` or `isInvestmentAccount`→`investment`; `Credit Card`→`credit`; `Crypto`→`crypto`; anything else→`other`. `archived` upstream → status `unavailable`; never deleted.
- Adoption rule: an unlinked `manual` account of the same user whose lower-cased trimmed name equals the provider account's name is linked instead of duplicated (`origin` becomes `synced`, `provider` `"wallet"`); counted as `adopted`. This is what re-links the ING and Revolut accounts created by the Teable import (Task 16).
- Name rule: the provider name is stored in `link.metadata.providerName`; the local name is updated only while it still equals the previously stored provider name.

- [ ] **Step 1: Failing tests**

`wallet-adapter.test.ts`: maps `name`, `currencyCode`, type by the table above, `archived`, `balance.currentBalance` to a two-decimal string (`251` → `"251.00"`), `asOf` passed through.

`sync-provider-accounts.test.ts` with memory repositories and a fake source:
```ts
it("creates on first sync, updates balances on the next, marks vanished accounts unavailable", async () => {
  const seen = [{ externalId: "w1", name: "ING - Salary", type: "checking" as const, currency: "EUR", archived: false, balance: "251.00", available: null, asOf: "2026-09-02", updatedAt: null }];
  const source = { provider: "wallet", fetchAccounts: async () => [...seen] };
  const r1 = await syncProviderAccounts({ ...deps, source })(userId);
  expect(r1).toMatchObject({ created: 1, balances: 1, missing: 0 });
  seen[0]!.balance = "300.00";
  const r2 = await syncProviderAccounts({ ...deps, source })(userId);
  expect(r2).toMatchObject({ created: 0, updated: 1, balances: 1 });
  seen.length = 0;
  const r3 = await syncProviderAccounts({ ...deps, source })(userId);
  expect(r3.missing).toBe(1);
  const [acc] = await deps.accounts.list(userId);
  expect(acc?.status).toBe("unavailable");
});
it("adopts an unlinked manual account with the same name", ...);
it("keeps a user-renamed account name", ...);
```

- [ ] **Step 2: Implement** the adapter (pure mapping plus the source) and the use case: fetch → `links.byExternal` → for unknown external ids, adopt by name or create (`origin: "synced"`, `provider`) and `upsertSeen`; for known ids update `status` from `archived`, apply the name rule, `upsertSeen`; `recordBalances` for every fetched account with `source: "provider"`; `markMissing` → set each returned entity `status: "unavailable"` via `update` with its current version. Audit one `accounts.sync` event with the counts.

- [ ] **Step 3: Job**

`src/lib/jobs/wallet-accounts-sync.ts` with `JOB_NAME = "wallet_accounts_sync"`: select active users (`status = 'active'`), for each run `withUserContext(db, { userId, role: "system" }, (tx) => syncProviderAccounts({ accounts: new DrizzleAccountsRepository(tx), links: new DrizzleProviderLinksRepository(tx), clock, audit: (e) => recordAudit(tx, e), source: walletAccountsSource(clock) })(userId))`; wrap in `startRun`/`finishRun` and `withJobLock(JOB_NAME, ...)`; never throw; alert with `alertJobFailure` on failure. Skip cleanly with status `already_done` and detail `{ reason: "wallet_not_configured" }` when the token file is empty or missing. Register it.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(accounts): Wallet adapter and provider account sync"
```

---

### Task 16: Teable import plan and migration scripts

**Files:**
- Create: `dashboard-app/src/modules/accounts/infrastructure/teable-import.ts`, `teable-import.test.ts`
- Create: `dashboard-app/scripts/migrate-teable.ts`, `dashboard-app/scripts/validate-teable-migration.ts`
- Modify: `dashboard-app/package.json` scripts, `dashboard-app/Dockerfile` (bundle both scripts like `migrate.mjs`), repo `.gitignore` (add `docs/migration/*.json`)
- Create: `docs/migration/README.md`

**Interfaces:**
```ts
interface TeableImportInput { userId: string; tracked: { slug: string; label: string; sortOrder: number; visible: boolean }[]; funds: { slug: string; name: string }[]; points: { key: string; month: string; value: number | null }[]; walletSnapshots: { accountKey: string; balance: string; capturedAt: Date }[] }
interface PlannedAccount { key: string; name: string; type: AccountType; origin: "manual"; includeInNetWorth: boolean; sortOrder: number }
interface PlannedBalance { key: string; asOf: string; balance: string; source: "migration" | "provider" }
planTeableImport(input: TeableImportInput): { accounts: PlannedAccount[]; balances: PlannedBalance[]; skipped: { key: string; reason: string }[] }
```
- Mapping: `etoro`, `binance` → `investment`; `buddy_bank`, `isybank`, `mediolanum` → `savings`; `fideuram` → `investment`; `cometa` → `pension_fund`; `ing` → `checking` named "ING - Salary"; `revolut_main` → `checking` named "Revolut"; `revolut_savings` → `savings` named "Savings"; `revolut_holidays` → `savings` named "Holidays" (these names match the Wallet accounts so Task 15 adopts them). `revolut_total` and `total` are skipped. A Teable cell for month `M` becomes `asOf` = last day of `M` with `source: "migration"`; a wallet snapshot becomes `asOf` = Rome date of `capturedAt` with `source: "provider"`, keeping the last row per day. A `null` cell is a gap, not a zero.

- [ ] **Step 1: Failing test** for `planTeableImport`: three points (`etoro` Jan 2026 = 100, `total` Jan = 999, `cometa` Feb = null) and two wallet rows for `ing` on the same Rome day; asserts the account list, `asOf` `2026-01-31` for the January cell, that `total` is skipped, that the null cell produces no balance, and that the two same-day wallet rows collapse to the later one.

- [ ] **Step 2: Implement** `teable-import.ts` (pure). Use `addMonths` from `@/lib/time` and compute the last day of the month as the day before the next month key.

- [ ] **Step 3: Scripts**

`scripts/migrate-teable.ts`: reads env, `listAllocationRecords()` and `pivotToSeries()` from `src/lib/clients/teable.ts`, writes `docs/migration/teable-allocation-<YYYY-MM-DD>.json`, loads `tracked_accounts`, `funds` and wallet rows from `balance_snapshots`, resolves the owner user id (the single `users` row with role owner), builds the plan, then inside `withSystemContext` inserts accounts (skipping keys whose name already exists for the user) and balances with `recordBalances` (upsert). Idempotent. Prints counts.

`scripts/validate-teable-migration.ts`: computes the legacy series via `loadAccounts(24)` from `src/app/(app)/_lib/accounts.ts` and the new series via `netWorthSeries` (Task 17), prints a month-by-month table (legacy total, new total, difference), writes `docs/migration/teable-reconciliation.md`, and exits 1 on any difference other than zero.

package.json: `"migrate:teable": "tsx scripts/migrate-teable.ts"`, `"migrate:teable:validate": "tsx scripts/validate-teable-migration.ts"`. Dockerfile: add two esbuild lines mirroring the `migrate.mjs` one, output `migrate-teable.mjs` and `validate-teable.mjs`, copied into the runner image.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test`
Expected: PASS. Do not run the scripts against production in this task; Task 21's runbook does.

- [ ] **Step 5: Commit**

```bash
git add -A . ../docs/migration/README.md ../.gitignore
git commit -m "feat(migration): Teable allocation import plan and validation scripts"
```

---

### Task 17: Net-worth series, overview loader and placeholder pages

**Files:**
- Create: `dashboard-app/src/modules/accounts/application/net-worth-series.ts`, `net-worth-series.test.ts`
- Create: `dashboard-app/src/modules/accounts/ui/deps.ts`, `load-overview.ts`
- Create placeholder pages: `src/app/(app)/finance/budgets/page.tsx`, `expenses/page.tsx`, `interests/page.tsx`, `management/page.tsx` — each renders `PageHeader` plus `EmptyState` with title "Not available yet" and body "This section arrives in a later release."

**Interfaces:**
```ts
interface NetWorthSeries { months: string[]; total: MonthPoint[]; perAccount: { account: Account; series: MonthPoint[]; latest: BalancePoint | null }[]; asOf: Date | null; stale: boolean; unavailableCount: number }
netWorthSeries(deps: UseCaseDeps)(p: Principal, months?: number): Promise<NetWorthSeries>     // includeInNetWorth and status active|unavailable only
// ui/deps.ts
accountDeps(tx: DbClient, requestId?: string | null): UseCaseDeps
runForPrincipal<T>(fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>): Promise<T>   // requirePrincipal + withUserContext + accountDeps
// ui/load-overview.ts
interface SourceFreshness { name: string; lastUpdated: Date | null; state: "fresh" | "stale" | "missing" }
interface OverviewData { netWorth: NetWorthSeries; accounts: AccountListItem[]; sources: SourceFreshness[] }
loadOverview(months?: number): Promise<OverviewData>
```

- [ ] **Step 1: Failing unit test** with memory repositories: three accounts (one excluded from net worth, one `unavailable` synced with a balance captured 3 days ago, one manual). Assert the total sums only the included ones, `unavailableCount` is 1, `stale` is true because of the old synced capture, and `asOf` is the newest included capture.

- [ ] **Step 2: Implement** with `monthRange`/`addMonths`/`monthKey` from `@/lib/time` and `monthlySeries`/`totalSeries` from the domain. `loadOverview` derives `sources` as: "Budget Makers Wallet" from the newest `provider` capture across synced accounts (`missing` when there is no synced account), "Manual entries" from the newest `manual`/`migration` capture.

- [ ] **Step 3: Run**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(accounts): net-worth series, overview loader and placeholder sections"
```

---

### Task 18: Accounts REST API

**Files:**
- Create: `dashboard-app/src/modules/accounts/api/schemas.ts`, `routes.ts`, `routes.itest.ts`
- Create: `dashboard-app/src/modules/accounts/application/groups.ts` (`listGroups`, `createGroup`, `renameGroup`, `deleteGroup`) with a `GroupsRepository` port and Drizzle/memory implementations added next to the others
- Modify: `dashboard-app/src/platform/http/app.ts` — `registerAllRoutes` calls `registerAccountRoutes(app, deps)`
- Regenerate `docs/api/openapi.json`

**Endpoints (all under `/api/v1`):**

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/accounts?includeArchived=&months=` | accounts.read | `{ items: AccountListItemDto[] }` |
| POST | `/accounts` | accounts.write | `Idempotency-Key` required; 201 |
| GET | `/accounts/{id}?months=` | accounts.read | detail |
| PATCH | `/accounts/{id}` | accounts.write | `If-Match` or `version`; 409 `version_mismatch` |
| DELETE | `/accounts/{id}?confirmSynced=true` | accounts.delete | 200 `{ outcome }`; 409 `conflict` with `details.reason = "linked"` |
| POST | `/accounts/{id}/balances` | accounts.write | `Idempotency-Key`; 201 |
| GET | `/accounts/{id}/balances?from=&to=&cursor=&limit=` | accounts.read | `{ items, nextCursor }`; cursor is base64 of the last `asOf`; `limit` ≤ 200, default 50 |
| GET / POST / PATCH / DELETE | `/account-groups`, `/account-groups/{id}` | accounts.read for GET, accounts.write otherwise | groups CRUD |
| POST | `/integrations/wallet/sync` | integrations.manage | runs `syncProviderAccounts` for the caller; 503 `integration_unavailable` when no token |
| GET | `/net-worth?months=` | accounts.read | `NetWorthSeries` DTO |

DTO rule: dates as ISO strings, money as decimal strings, `MonthPoint.value` as number or null. Error mapping: `NotFoundError` → 404, `VersionMismatchError` → 409 `version_mismatch`, `DeletionBlockedError` → 409 `conflict`, `InvalidInputError` → 422 `validation_failed` with `details`, `UpstreamError` from the Wallet client → 503 `integration_unavailable`.

- [ ] **Step 1: Failing integration test**

`routes.itest.ts` builds `createApiApp` with the real test db, `rateLimitEnabled: false`, and an `authenticate` that returns a principal for a seeded user based on the `x-test-user` header. Flow: POST `/accounts` with key `k1` → 201; POST again with `k1` and the same body → 201 with the identical body; GET `/accounts` → one item; PATCH with `If-Match: 1` → 200 and `version: 2`; PATCH with `If-Match: 1` → 409; POST `/accounts/{id}/balances` twice on different days; GET `/accounts/{id}/balances?limit=1` → one item and a `nextCursor`; follow the cursor → the second item and no cursor; a second user's principal GET `/accounts/{id}` → 404; DELETE → 200 `{ outcome: "deleted" }`. Validate every response body against the response Zod schema exported from `schemas.ts` for that route.

- [ ] **Step 2: Implement** routes with `createRoute` from `@hono/zod-openapi`, `security: [{ session: [] }]`, tags `Accounts`, `Account groups`, `Integrations`, `Net worth`. Handlers run `withUserContext(deps.db, { userId: principal.userId }, (tx) => useCase(accountDeps(tx, requestId))(principal, ...))`. Register the idempotency middleware on the two POST routes that create records.

- [ ] **Step 3: Run**

Run: `npm run openapi:generate && npm run typecheck && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A . ../docs/api/openapi.json
git commit -m "feat(api): accounts, balances, groups, net worth and wallet sync endpoints"
```

---

### Task 19: Accounts pages, forms and management

**Files:**
- Create: `src/app/(app)/finance/accounts/page.tsx`, `loading.tsx`, `[id]/page.tsx`, `[id]/loading.tsx`
- Create: `src/modules/accounts/ui/AccountsTable.tsx` (client: group-by select, rows with `MoneyValue`, `Sparkline`, `StaleBadge`, origin chip "Synced from Budget Makers Wallet" or "Manual"), `AccountForm.tsx` (client, inside `SheetForm`), `BalanceForm.tsx`, `DeleteAccountButton.tsx` (confirmation dialog stating the outcome before it happens)
- Create: `src/app/actions/accounts.ts` server actions `createAccountAction`, `updateAccountAction`, `deleteAccountAction`, `recordBalanceAction`, `syncWalletAction`, each returning `ActionResult` and calling the use case through `runForPrincipal`
- Create: `src/app/(app)/finance/management/accounts/page.tsx` (groups CRUD and archived accounts with a Restore action)
- Modify: `src/app/(app)/finance/_components/FinanceTabs.tsx` — options become Overview, Accounts, Funds; the Vacation fund page stays reachable from a link on the Funds page until Phase 6
- Modify: `src/app/(app)/settings/page.tsx` — remove the tracked-accounts section and link to Finance › Management instead
- Test: `src/app/actions/accounts.test.ts`

**Interfaces:**
- `runForPrincipal` from Task 17 gains a test seam: `setAccountDepsFactoryForTests(factory: (() => UseCaseDeps) | null)` and `setPrincipalForTests(p: Principal | null)` in `ui/deps.ts`, both no-ops outside `NODE_ENV=test`.

- [ ] **Step 1: Failing action test**: with the seams set to memory repositories and an owner principal, `createAccountAction(formData)` with an empty name → `{ ok: false, error: "Enter a name." }`; with a valid form → `{ ok: true }`; with a viewer principal → `{ ok: false, error: "You do not have permission to change accounts." }`.

- [ ] **Step 2: Implement** the actions (map `PermissionDeniedError` to the message above, `InvalidInputError` to its message, anything else to `errorMessage`), then the pages. States to render: no accounts → `EmptyState` "No accounts yet" with primary action "Add account" and secondary "Connect Budget Makers Wallet" linking to `/settings`; synced and stale → `StaleBadge`; `unavailable` → chip "Unavailable upstream since {date}"; archived accounts appear only under Management. Detail page: header with the latest balance, `TimeSeriesChart` of the series, balance history table (50 rows, "Load more" via the API cursor), provider link metadata, actions Edit, Record balance (manual only), Archive or Delete with confirmation. Every `revalidatePath` covers `/`, `/finance`, `/finance/accounts`, and the detail path.

- [ ] **Step 3: Run**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. In `npm run dev`: create a manual account, record a balance, see it in the list and in the detail chart.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(accounts): accounts list, detail, forms and management pages"
```

---

### Task 20: Home and Overview on the new data; retire Teable and the monthly snapshot

**Files:**
- Create: `src/modules/home/cards.ts`, `cards.test.ts`
- Modify: `src/app/(app)/page.tsx`, `src/app/(app)/finance/page.tsx`, `src/app/(app)/finance/_components/OverviewClient.tsx` — read from `loadOverview()`; the total balance card links to `/finance/accounts`; a freshness line per source
- Create: `src/lib/jobs/monthly-close.ts`, `monthly-close.test.ts`; register `monthly_close` (tier monthly) and unregister `monthly_snapshot`
- Delete: `src/lib/clients/teable.ts` and its test; `src/lib/jobs/monthly-snapshot.ts`, its test and route; Teable steps (c) and (d) in `src/lib/jobs/sweep.ts` and their tests; `src/lib/repo/tracked-accounts.ts`; the `deleteAccount`/`setAccountVisible` actions in `src/app/actions/settings.ts`; `src/app/(app)/_lib/accounts.ts` and its test (move the legacy series computation into `scripts/validate-teable-migration.ts` as `legacySeriesFromSnapshots(db)` so validation still runs after deletion); `TEABLE_*` from `src/lib/env.ts`; the `"teable"` member of `SourceKind` in `src/lib/contracts.ts`; Teable vars from `docker-compose.yml` and `.env.example`; the tracked-accounts seed and the `teable_column` in the funds seed in `src/lib/db/migrate.ts`
- Create migration `0007_retire_teable.sql`: remove `funds.teable_column`, remove the `tracked_accounts` and `monthly_snapshots` tables, remove the `balance_snapshots_source_ck` constraint (the table stays as a read-only archive until Phase 9)
- Modify `src/platform/capabilities/probes.ts` `hasAccounts` to count `accounts`
- Modify `src/modules/accounts/infrastructure/teable-import.ts` to accept the JSON export instead of the deleted client types

**Interfaces:**
```ts
type CardKey = "total_balance" | "accounts_sync" | "funds" | "leave";
interface HomeCard { key: CardKey; title: string; href: string; requires: { feature?: keyof Capabilities["features"]; integration?: keyof Capabilities["integrations"]; permission?: Permission } }
visibleCards(caps: Capabilities): HomeCard[]
type CardState<T> = { state: "ready"; data: T; updatedAt: Date | null; source: string } | { state: "loading" } | { state: "empty"; hint: string } | { state: "stale"; data: T; updatedAt: Date; source: string } | { state: "partial"; data: T; missing: string[] } | { state: "integration_error"; message: string } | { state: "permission_denied" }
runMonthlyClose(input: { trigger: "cron" | "manual"; now: Date }): Promise<JobResult>
closePreviousMonth(deps: { accounts: AccountsRepository; clock: Clock }, userId: string): Promise<{ closed: number }>
```
`closePreviousMonth` writes, for every non-archived account, an `account_balances` row with `asOf` = last day of the previous Rome month, `source: "system"`, and balance = the latest known balance with `asOf` ≤ that day; it skips accounts with no balance at all; it is idempotent through the `(accountId, asOf, source)` upsert.

- [ ] **Step 1: Failing tests**: `cards.test.ts` (a card requiring the `expenses` feature is hidden without wallet; a viewer gets `permission_denied` for a card requiring `accounts.write`); `monthly-close.test.ts` with memory repositories (closes the previous month, second run changes nothing, skips accounts without balances).

- [ ] **Step 2: Implement** the card registry, the Home and Overview pages (keeping the existing `TimeSeriesChart`, `StatTile`, `ProgressRing` usage), and the job.

- [ ] **Step 3: Remove Teable** as listed and fix every error `npm run typecheck` reports. `sweep.test.ts` keeps steps (a) and (b).

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm test && npm run test:integration && npm run build && grep -ri teable src`
Expected: all PASS; the grep prints nothing but the migration-import module and its test.

- [ ] **Step 5: Commit**

```bash
git add -A . ../docker-compose.yml ../.env.example
git commit -m "feat: Home and Overview on account balances; retire Teable and the monthly snapshot"
```

---

### Task 21: Runbook, reconciliation, e2e smoke and docs

**Files:**
- Create: `docs/deploy/phase-1-runbook.md`, `docs/architecture/overview.md`, `docs/api/README.md`
- Create: `dashboard-app/tests/e2e/smoke.spec.ts`
- Create or update: repo `README.md`

- [ ] **Step 1: Playwright smoke**

`tests/e2e/smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("health answers, the API is gated, and the app redirects to sign-in", async ({ request, page }) => {
  expect((await request.get("/api/health")).ok()).toBeTruthy();
  expect((await request.get("/api/v1/openapi.json")).status()).toBe(401);
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});
```

- [ ] **Step 2: Runbook** with exact commands in order: `docker exec postgres pg_dump -U <role> dashboard > backup-<date>.sql`; build the image; deploy (migrations 0004–0006 apply on boot); `docker exec dashboard-app node /app/migrate-teable.mjs`; `docker exec dashboard-app node /app/validate-teable.mjs`; inspect `docs/migration/teable-reconciliation.md`; `curl -X POST .../api/v1/integrations/wallet/sync` with a session cookie, or run the daily tick; verify the Home total equals the pre-deploy figure; only then deploy the Task 20 image (migration 0007 removes the legacy tables). Rollback: redeploy the previous image; 0004–0006 are additive, 0007 is applied only after validation.

- [ ] **Step 3: Docs** — architecture overview (module layout, the use-case rule, RLS context, job tiers, API conventions) and the API README (auth, error envelope, pagination, idempotency, versioning, how to regenerate the document).

- [ ] **Step 4: Run**

Run: `npm run e2e` against `npm run dev` (E2E_BASE_URL defaults to localhost:3000); then `graphify update .` from the repo root.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A . ../docs ../README.md
git commit -m "docs: Phase 1 runbook, architecture and API guides; e2e smoke"
```

---

## Self-review against the spec

- Spec §3.1 layering → Tasks 12–14, 17–19. §3.2 API (errors, idempotency, versioning, rate limit, audit, OpenAPI drift) → Tasks 5–8, 18. §3.3 capabilities → Tasks 10, 20. §3.4 tick → Task 9. §5.1 identity → Tasks 2–3. RLS → Tasks 4, 11. §5.3 accounts and deletion rules → Tasks 11–13. Wallet adapter → Task 15. §10.1 Teable migration, validation, rollback, removal → Tasks 16, 20, 21. §10.3 owner seed → Task 2. Phase 1 exit criteria → Tasks 20–21.
- Deferred by design to later phases: personal access tokens (Phase 8), outbound webhooks (Phase 9), `integration_connections` with encrypted credentials (Phase 2; Phase 1 still reads the token file), Budgets, Expenses, Interests and Management beyond placeholders.
- Names used consistently across tasks: `AccountsRepository`, `ProviderLinksRepository`, `UseCaseDeps`, `syncProviderAccounts`, `netWorthSeries`, `loadOverview`, `accountDeps`, `runForPrincipal`, `withUserContext`, `withSystemContext`, `requirePrincipal`, `assertPermission`, `createApiApp`, `registerAllRoutes`, `recordAudit`, `registerJob`, `runTier`, `ensureJobsRegistered`, `resolveCapabilities`, `buildNavigation`, `realProbes`.

/**
 * The Security API and the Bearer branch of `authenticate`, against real
 * Postgres.
 *
 * Unlike the other route itests this one does NOT stub `authenticate`: it
 * builds the production `createAuthenticate` with only the session lookup
 * injected, so the branch order (Bearer first, no fallback), the CSRF
 * exemption and the live scope intersection are all proved as they ship.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  organizations,
  personalAccessTokens,
  roles,
  userIdentities,
  userRoles,
  users,
} from "@/lib/db/schema";
import type { RoleCode } from "@/platform/auth/permissions";
import { createApiApp } from "@/platform/http/app";
import { createAuthenticate } from "@/platform/http/authenticate";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";

/**
 * The identity provider is a parameter of `createAuthenticate`, so this test
 * picks its own rather than importing `PROVIDER_ID` from `@/auth`: that module
 * pulls next-auth, which reaches for `next/server` and cannot be resolved in
 * the test environment (the same reason `require-principal.ts` is split out).
 * Production passes `PROVIDER_ID`; typecheck covers that wiring.
 */
const PROVIDER = "test-provider";

const NOW = new Date("2026-04-01T09:00:00.000Z");
const SUBJECT = "authentik-subject-1";
const JSON_HEADERS = { "content-type": "application/json" };
const SESSION_WRITE = { ...JSON_HEADERS, "x-requested-with": "test" };

type Db = Awaited<ReturnType<typeof testDb>>;

async function seedUser(role: RoleCode = "owner"): Promise<{ db: Db; userId: string }> {
  const testdb = await testDb();
  await testdb
    .insert(roles)
    .values([
      { code: "owner", label: "Owner" },
      { code: "admin", label: "Admin" },
      { code: "member", label: "Member" },
      { code: "viewer", label: "Viewer" },
    ])
    .onConflictDoNothing();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb
    .insert(users)
    .values({ organizationId: org!.id, displayName: "Owner" })
    .returning();
  await testdb.insert(userIdentities).values({ userId: user!.id, provider: PROVIDER, subject: SUBJECT });
  await testdb.insert(userRoles).values({ userId: user!.id, roleCode: role });
  return { db: testdb, userId: user!.id };
}

/** The real app, with only the cookie session's subject injected. */
function appFor(sessionSubject: string | null, now: Date = NOW) {
  return createApiApp({
    db,
    now: () => now,
    rateLimitEnabled: false,
    authenticate: createAuthenticate({
      db,
      sessionSubject: async () => sessionSubject,
      provider: PROVIDER,
      now: () => now,
    }),
  });
}

const signedIn = (now?: Date) => appFor(SUBJECT, now);
/** No cookie at all: the only credential these requests carry is the header. */
const anonymous = (now?: Date) => appFor(null, now);

async function mintToken(
  scopes: string[],
  extra: { expiresAt?: Date | null } = {},
): Promise<{ token: string; id: string }> {
  const res = await signedIn().request("/api/v1/security/tokens", {
    method: "POST",
    headers: SESSION_WRITE,
    body: JSON.stringify({ name: "cli", scopes, expiresAt: extra.expiresAt?.toISOString() ?? null }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; id: string };
  return { token: body.token, id: body.id };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function storedToken(id: string) {
  return withSystemContext(db, async (tx) => {
    const [row] = await tx.select().from(personalAccessTokens).where(eq(personalAccessTokens.id, id));
    return row!;
  });
}

describe("POST /security/tokens", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns the token once, and never again", async () => {
    await seedUser();
    const res = await signedIn().request("/api/v1/security/tokens", {
      method: "POST",
      headers: SESSION_WRITE,
      body: JSON.stringify({ name: "laptop", scopes: ["accounts.read"] }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.token).toMatch(/^pat_[0-9A-Za-z]{8}\.[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe((created.token as string).slice(4, 12));
    expect(created).not.toHaveProperty("tokenHash");
    expect(created).not.toHaveProperty("userId");

    const list = await signedIn().request("/api/v1/security/tokens", {
      headers: { "x-requested-with": "test" },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("token");
    expect(body.items[0]).not.toHaveProperty("tokenHash");
    expect(body.items[0]).not.toHaveProperty("userId");
    expect(JSON.stringify(body)).not.toContain(created.token as string);
  });

  it("writes an audit row with no token in it", async () => {
    await seedUser();
    const { token } = await mintToken(["accounts.read"]);

    const [audit] = await withSystemContext(db, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "security.token_created")),
    );
    expect(audit!.entityType).toBe("personal_access_token");
    expect(audit!.after).not.toHaveProperty("token");
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("refuses a scope the caller does not hold", async () => {
    await seedUser("viewer");
    const res = await signedIn().request("/api/v1/security/tokens", {
      method: "POST",
      headers: SESSION_WRITE,
      // A viewer holds `accounts.read` but not `accounts.write`.
      body: JSON.stringify({ name: "cli", scopes: ["accounts.read", "accounts.write"] }),
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
  });

  it("refuses a cookie-authenticated create without X-Requested-With", async () => {
    await seedUser();
    const res = await signedIn().request("/api/v1/security/tokens", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "cli", scopes: ["accounts.read"] }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });
});

describe("Bearer authentication", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("authenticates a read with no X-Requested-With — a browser never sends an Authorization header on its own", async () => {
    await seedUser();
    const { token } = await mintToken(["accounts.read"]);

    const res = await anonymous().request("/api/v1/accounts", { headers: bearer(token) });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("refuses a write outside the token's scopes with 403 permission_denied", async () => {
    await seedUser();
    const { token } = await mintToken(["accounts.read"]);

    const res = await anonymous().request("/api/v1/accounts", {
      method: "POST",
      headers: { ...bearer(token), ...JSON_HEADERS, "idempotency-key": "k1" },
      body: JSON.stringify({ name: "Cash", type: "cash", currency: "EUR" }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("permission_denied");
  });

  it("shrinks live when the owner's role is downgraded — R8-5's re-intersection", async () => {
    const { db: testdb, userId } = await seedUser();
    // Minted while the owner still held the write.
    const { token } = await mintToken(["accounts.read", "accounts.write"]);

    await testdb.delete(userRoles).where(eq(userRoles.userId, userId));
    await testdb.insert(userRoles).values({ userId, roleCode: "viewer" });

    const read = await anonymous().request("/api/v1/accounts", { headers: bearer(token) });
    expect(read.status).toBe(200);

    const write = await anonymous().request("/api/v1/accounts", {
      method: "POST",
      headers: { ...bearer(token), ...JSON_HEADERS, "idempotency-key": "k1" },
      body: JSON.stringify({ name: "Cash", type: "cash", currency: "EUR" }),
    });
    expect(write.status).toBe(403);
    expect(((await write.json()) as { error: { code: string } }).error.code).toBe("permission_denied");
  });

  it("refuses a revoked token with 401", async () => {
    await seedUser();
    const { token, id } = await mintToken(["accounts.read"]);

    const revoked = await signedIn().request(`/api/v1/security/tokens/${id}`, {
      method: "DELETE",
      headers: { "x-requested-with": "test" },
    });
    expect(revoked.status).toBe(204);
    expect(await revoked.text()).toBe("");

    const res = await anonymous().request("/api/v1/accounts", { headers: bearer(token) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("refuses an expired token with 401", async () => {
    await seedUser();
    const expiresAt = new Date("2026-04-01T10:00:00.000Z");
    const { token } = await mintToken(["accounts.read"], { expiresAt });

    const before = await anonymous().request("/api/v1/accounts", { headers: bearer(token) });
    expect(before.status).toBe(200);

    const after = await anonymous(new Date("2026-04-01T10:00:01.000Z")).request("/api/v1/accounts", {
      headers: bearer(token),
    });
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("refuses a suspended owner's token with 401", async () => {
    const { db: testdb, userId } = await seedUser();
    const { token } = await mintToken(["accounts.read"]);

    await testdb.update(users).set({ status: "suspended" }).where(eq(users.id, userId));

    const res = await anonymous().request("/api/v1/accounts", { headers: bearer(token) });
    expect(res.status).toBe(401);
  });

  it("refuses an unknown or malformed Bearer credential without falling back to the cookie", async () => {
    await seedUser();
    // A signed-in browser that also sends a bad Authorization header must be
    // refused, not quietly served off its cookie: otherwise a revoked token
    // keeps working for anyone who happens to be logged in.
    const unknown = await signedIn().request("/api/v1/accounts", {
      headers: { authorization: "Bearer pat_AAAAAAAA.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    expect(unknown.status).toBe(401);

    // A credential of some other shape is not ours; the cookie decides.
    const notOurs = await signedIn().request("/api/v1/accounts", {
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" },
    });
    expect(notOurs.status).toBe(200);
  });

  it("stamps last_used_at at most once a minute", async () => {
    await seedUser();
    const { token, id } = await mintToken(["accounts.read"]);
    expect((await storedToken(id)).lastUsedAt).toBeNull();

    await anonymous().request("/api/v1/accounts", { headers: bearer(token) });
    const first = (await storedToken(id)).lastUsedAt;
    expect(first?.toISOString()).toBe(NOW.toISOString());

    // 59 seconds later: still the same stamp, so a busy client does not turn
    // every read into a write.
    await anonymous(new Date(NOW.getTime() + 59_000)).request("/api/v1/accounts", {
      headers: bearer(token),
    });
    expect((await storedToken(id)).lastUsedAt?.toISOString()).toBe(first?.toISOString());

    // A minute later it moves.
    const later = new Date(NOW.getTime() + 60_000);
    await anonymous(later).request("/api/v1/accounts", { headers: bearer(token) });
    expect((await storedToken(id)).lastUsedAt?.toISOString()).toBe(later.toISOString());
  });
});

/**
 * Ruling P8-2. A token that could mint or revoke tokens would turn one leak
 * into a permanent foothold, so these three routes are session-only whatever
 * the token's scopes say.
 */
describe("tokens cannot manage tokens (P8-2)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("refuses list, create and revoke over Bearer with 403 permission_denied", async () => {
    await seedUser();
    // Scoped as widely as an owner can scope it — the refusal is not about
    // permissions the token lacks.
    const { token, id } = await mintToken(["accounts.read", "accounts.write", "admin.users"]);

    const list = await anonymous().request("/api/v1/security/tokens", { headers: bearer(token) });
    expect(list.status).toBe(403);
    expect(((await list.json()) as { error: { code: string } }).error.code).toBe("permission_denied");

    const create = await anonymous().request("/api/v1/security/tokens", {
      method: "POST",
      headers: { ...bearer(token), ...JSON_HEADERS },
      body: JSON.stringify({ name: "child", scopes: ["accounts.read"] }),
    });
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("permission_denied");

    const revoke = await anonymous().request(`/api/v1/security/tokens/${id}`, {
      method: "DELETE",
      headers: bearer(token),
    });
    expect(revoke.status).toBe(403);
    expect(((await revoke.json()) as { error: { code: string } }).error.code).toBe("permission_denied");

    // Nothing was created and nothing was revoked.
    const rows = await withSystemContext(db, (tx) => tx.select().from(personalAccessTokens));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeNull();
  });
});

describe("DELETE /security/tokens/{id}", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("answers 404 for an id that is not the caller's, and for a second revocation", async () => {
    await seedUser();
    const { id } = await mintToken(["accounts.read"]);

    const unknown = await signedIn().request(
      "/api/v1/security/tokens/00000000-0000-7000-8000-00000000dead",
      { method: "DELETE", headers: { "x-requested-with": "test" } },
    );
    expect(unknown.status).toBe(404);

    expect(
      (
        await signedIn().request(`/api/v1/security/tokens/${id}`, {
          method: "DELETE",
          headers: { "x-requested-with": "test" },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await signedIn().request(`/api/v1/security/tokens/${id}`, {
          method: "DELETE",
          headers: { "x-requested-with": "test" },
        })
      ).status,
    ).toBe(404);
  });
});

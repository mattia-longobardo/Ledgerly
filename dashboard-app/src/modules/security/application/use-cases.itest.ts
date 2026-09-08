/**
 * The security use cases against real Postgres.
 *
 * The reduced Phase 8 keeps no memory repositories, so this file IS the
 * repository proof as well as the use-case proof: every assertion runs
 * through `securityDeps(tx)` inside the owner's RLS context, against the
 * Drizzle repository and the real constraints.
 *
 * The property this module exists to keep — the plain token is never stored,
 * never audited, never returned twice — is asserted directly against the
 * table and the audit log rather than trusted.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents, organizations, personalAccessTokens, users } from "@/lib/db/schema";
import { hashToken, TOKEN_PATTERN } from "@/platform/auth/pat";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { testPrincipal } from "@/test/principal";
import { securityDeps } from "../infrastructure/deps";
import { createToken } from "./create-token";
import { InvalidInputError, NotFoundError } from "./errors";
import { listTokens } from "./list-tokens";
import { revokeToken } from "./revoke-token";

const principal = testPrincipal();
const viewer = testPrincipal({ roles: ["viewer"] });

type Db = Awaited<ReturnType<typeof testDb>>;

async function seed(): Promise<Db> {
  const db = await testDb();
  await db.insert(organizations).values({ id: principal.organizationId, name: "P" });
  await db.insert(users).values({
    id: principal.userId,
    organizationId: principal.organizationId,
    displayName: "Owner",
  });
  return db;
}

function inContext<T>(db: Db, fn: (deps: ReturnType<typeof securityDeps>) => Promise<T>): Promise<T> {
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(securityDeps(tx, "req-1")));
}

/**
 * Verification reads go through the system context deliberately. Both tables
 * carry FORCE RLS, so a read on the pool-bound client with no context set
 * returns zero rows silently — an assertion written that way would pass
 * vacuously on "the token is not stored in the clear" while proving nothing.
 */
function storedRows(db: Db) {
  return withSystemContext(db, (tx) => tx.select().from(personalAccessTokens));
}

function auditRows(db: Db, action: string) {
  return withSystemContext(db, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)),
  );
}

describe("createToken", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns the token once and stores only its prefix and hash", async () => {
    const db = await seed();
    const { token, record } = await inContext(db, (deps) =>
      createToken(deps)(principal, { name: "  laptop cli  ", scopes: ["accounts.read"] }),
    );

    expect(token).toMatch(TOKEN_PATTERN);
    expect(record.name).toBe("laptop cli");
    expect(record.prefix).toBe(token.slice(4, 12));
    expect(record.scopes).toEqual(["accounts.read"]);
    expect(record.expiresAt).toBeNull();
    expect(record.lastUsedAt).toBeNull();
    expect(record.revokedAt).toBeNull();
    // The port type has no hash at all — the row is where to look.
    expect(record).not.toHaveProperty("tokenHash");

    const [row] = await storedRows(db);
    expect(row!.tokenHash).toBe(hashToken(token));
    // The stored row must not contain the token or its secret half anywhere.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.split(".")[1]);
  });

  it("writes an audit row that carries no token and no hash", async () => {
    const db = await seed();
    const { token } = await inContext(db, (deps) =>
      createToken(deps)(principal, { name: "cli", scopes: ["accounts.read", "accounts.write"] }),
    );

    const [audit] = await auditRows(db, "security.token_created");
    expect(audit!.actorUserId).toBe(principal.userId);
    expect(audit!.entityType).toBe("personal_access_token");
    expect(audit!.requestId).toBe("req-1");
    expect(audit!.after).toMatchObject({ name: "cli", scopes: ["accounts.read", "accounts.write"] });
    expect(audit!.after).not.toHaveProperty("token");
    expect(audit!.after).not.toHaveProperty("tokenHash");
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(hashToken(token));
  });

  it("refuses a scope the caller does not hold", async () => {
    const db = await seed();
    await expect(
      withUserContext(db, { userId: principal.userId }, (tx) =>
        // A viewer holds `accounts.read` but not `accounts.write`.
        createToken(securityDeps(tx))({ ...viewer, userId: principal.userId }, {
          name: "cli",
          scopes: ["accounts.read", "accounts.write"],
        }),
      ),
    ).rejects.toThrow(InvalidInputError);
    expect(await storedRows(db)).toEqual([]);
  });

  it("refuses an empty name, empty scopes, an unknown permission and a past expiry", async () => {
    const db = await seed();
    const refused = [
      { name: "   ", scopes: ["accounts.read"] as const },
      { name: "cli", scopes: [] as const },
      { name: "cli", scopes: ["not.a.permission"] as unknown as ["accounts.read"] },
      { name: "cli", scopes: ["accounts.read"] as const, expiresAt: new Date("2020-01-01T00:00:00Z") },
      { name: "cli", scopes: ["accounts.read"] as const, expiresAt: new Date("nonsense") },
    ];
    for (const input of refused) {
      await expect(inContext(db, (deps) => createToken(deps)(principal, input))).rejects.toThrow(
        InvalidInputError,
      );
    }
    expect(await storedRows(db)).toEqual([]);
  });

  it("de-duplicates scopes and keeps an expiry", async () => {
    const db = await seed();
    const expiresAt = new Date("2030-06-01T00:00:00.000Z");
    const { record } = await inContext(db, (deps) =>
      createToken(deps)(principal, {
        name: "cli",
        scopes: ["accounts.read", "accounts.read", "funds.read"],
        expiresAt,
      }),
    );
    expect(record.scopes).toEqual(["accounts.read", "funds.read"]);
    expect(record.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });
});

describe("listTokens", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns the caller's tokens newest first, without a hash", async () => {
    const db = await seed();
    const first = await inContext(db, (deps) =>
      createToken(deps)(principal, { name: "one", scopes: ["accounts.read"] }),
    );
    const second = await inContext(db, (deps) =>
      createToken(deps)(principal, { name: "two", scopes: ["funds.read"] }),
    );

    const listed = await inContext(db, (deps) => listTokens(deps)(principal));
    expect(listed.map((t) => t.name)).toEqual(["two", "one"]);
    for (const token of listed) expect(token).not.toHaveProperty("tokenHash");
    const serialised = JSON.stringify(listed);
    expect(serialised).not.toContain(first.token);
    expect(serialised).not.toContain(second.token);
    expect(serialised).not.toContain(hashToken(first.token));
  });

  it("does not show another user's tokens", async () => {
    const db = await seed();
    const [other] = await db
      .insert(users)
      .values({ organizationId: principal.organizationId, displayName: "B" })
      .returning();
    await withUserContext(db, { userId: other!.id }, (tx) =>
      createToken(securityDeps(tx))({ ...principal, userId: other!.id }, {
        name: "theirs",
        scopes: ["accounts.read"],
      }),
    );

    expect(await inContext(db, (deps) => listTokens(deps)(principal))).toEqual([]);
  });
});

describe("revokeToken", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stamps revoked_at, audits it, and refuses a second revocation", async () => {
    const db = await seed();
    const { record } = await inContext(db, (deps) =>
      createToken(deps)(principal, { name: "cli", scopes: ["accounts.read"] }),
    );

    await inContext(db, (deps) => revokeToken(deps)(principal, record.id));
    const [row] = await storedRows(db);
    expect(row!.revokedAt).toBeInstanceOf(Date);

    const [audit] = await auditRows(db, "security.token_revoked");
    expect(audit!.entityId).toBe(record.id);

    // Revoking twice must not move the timestamp: when the credential died is
    // a fact, not the time of the last button press.
    await expect(inContext(db, (deps) => revokeToken(deps)(principal, record.id))).rejects.toThrow(
      NotFoundError,
    );
    const [again] = await storedRows(db);
    expect(again!.revokedAt?.toISOString()).toBe(row!.revokedAt?.toISOString());
  });

  it("refuses an unknown id and another user's token", async () => {
    const db = await seed();
    const [other] = await db
      .insert(users)
      .values({ organizationId: principal.organizationId, displayName: "B" })
      .returning();
    const theirs = await withUserContext(db, { userId: other!.id }, (tx) =>
      createToken(securityDeps(tx))({ ...principal, userId: other!.id }, {
        name: "theirs",
        scopes: ["accounts.read"],
      }),
    );

    await expect(
      inContext(db, (deps) => revokeToken(deps)(principal, "00000000-0000-7000-8000-00000000dead")),
    ).rejects.toThrow(NotFoundError);
    await expect(inContext(db, (deps) => revokeToken(deps)(principal, theirs.record.id))).rejects.toThrow(
      NotFoundError,
    );

    const [row] = (await storedRows(db)).filter((t) => t.id === theirs.record.id);
    expect(row!.revokedAt).toBeNull();
  });
});

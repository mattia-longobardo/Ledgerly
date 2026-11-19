// R3 parity of Admin › Users (03-releases.md §R3, criterion 11): what the server page read before it
// became a client screen — the people and the invitations — is what `GET /api/v1/people` answers.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_CSRF_HEADER } from "@ledgerly/api-contract";
import { authAccounts, users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api } = await import("@/app/api/v1/[[...route]]/composition");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { listPeople } = await import("@/modules/users/admin");
const { readEnv } = await import("@domain/platform/env");

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
});

afterAll(closeDatabase);

const origin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

/** A signed-in person with no password row: the session owes no TOTP setup. */
async function person(role: "user" | "admin") {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({
    body: { email, password: "correct-horse-battery", name: "Parity Person", role },
  });
  await getDb().update(users).set({ role }).where(eq(users.id, created.user.id));
  const { headers } = await auth.api.signInEmail({
    body: { email, password: "correct-horse-battery" },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  const cookie = headers
    .getSetCookie()
    .map((one) => one.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  return { userId: created.user.id, cookie };
}

async function send(path: string, cookie: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { cookie };
  if (method !== "GET") Object.assign(headers, { origin: origin(), [SESSION_CSRF_HEADER]: "1" });
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return api.fetch(
    new Request(`${origin()}/api/v1${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

describe("Admin › Users, old page = new screen", () => {
  it("shows the same people and invitations", async () => {
    const admin = await person("admin");
    await person("user");
    const invited = await send("/people/invitations", admin.cookie, {
      method: "POST",
      body: { email: `${randomUUID()}@example.test`, role: "user" },
    });
    expect(invited.status).toBe(201);

    // What the server page read (`users/page.tsx` before R3).
    const page = (await listPeople({ userId: admin.userId, role: "admin" })).map((one) => ({
      ...one,
      lastSignInAt: one.lastSignInAt?.toISOString() ?? null,
    }));

    // What the screen reads now.
    const response = await send("/people", admin.cookie);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { people: unknown[] }).people).toEqual(page);
    expect(page.length).toBe(3);
  });

  it("answers a person's own row with the use case's refusal as the reason", async () => {
    const admin = await person("admin");
    await person("admin");
    const removed = await send(`/people/${admin.userId}`, admin.cookie, { method: "DELETE" });
    expect(removed.status).toBe(409);
    expect(await removed.json()).toMatchObject({ error: "conflict", reason: "self" });
  });
});

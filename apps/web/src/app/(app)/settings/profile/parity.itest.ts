// R3 parity of Settings › Profile (03-releases.md §R3, criterion 11): what the server page read before
// it became a client screen — the session's name and email, the role, the SSO link and the saved
// preferences — is what `GET /api/v1/profile` and `GET /api/v1/preferences` answer for the same person.
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
const { hasSsoAccount } = await import("@ledgerly/domain/platform/auth");
const { getPreferences, updatePreferences } = await import("@ledgerly/domain/users");
const { readEnv } = await import("@domain/platform/env");
const { OIDC_PROVIDER_ID } = await import("@domain/platform/auth/provider");
const { mailPolicy } = await import("@ledgerly/domain/platform/settings");
const { utcOffsetLabel } = await import("@ledgerly/domain/shared/dates");

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
});

afterAll(closeDatabase);

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
  // Without the password the session owes no TOTP setup (TWO_FACTOR_POLICY=required) and opens the app.
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

const origin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

async function read(path: string, cookie: string): Promise<unknown> {
  const response = await api.fetch(new Request(`${origin()}/api/v1${path}`, { headers: { cookie } }));
  expect(response.status).toBe(200);
  return response.json();
}

/** A rename the way the screen sends it: the cookie, the instance's origin and the CSRF header. */
function rename(name: string, cookie: string): Promise<Response> {
  return Promise.resolve(
    api.fetch(
      new Request(`${origin()}/api/v1/profile`, {
        method: "PATCH",
        headers: { cookie, origin: origin(), [SESSION_CSRF_HEADER]: "1", "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    ),
  );
}

describe("Settings › Profile, old page = new screen", () => {
  it.each(["user", "admin"] as const)("shows the same values for a %s", async (role) => {
    const { userId, cookie } = await person(role);
    const ctx = { userId } as Parameters<typeof getPreferences>[0];
    await updatePreferences(ctx, {
      ...(await getPreferences(ctx)),
      locale: "it",
      numberFormat: "fr-FR",
      decimalSeparator: ",",
      displayCurrency: "USD",
      weekStart: 0,
      theme: "dark",
      monthlySummary: true,
    });

    // What the server page read (`profile/page.tsx` before R3).
    const session = await (await getAuth()).api.getSession({ headers: new Headers({ cookie }) });
    const page = {
      name: session?.user.name,
      email: session?.user.email,
      role,
      sso: await hasSsoAccount(userId),
      preferences: await getPreferences(ctx),
    };

    // What the screen reads now.
    const profile = (await read("/profile", cookie)) as Record<string, unknown>;
    const preferences = await read("/preferences", cookie);

    expect({
      name: profile.name,
      email: profile.email,
      role: profile.role,
      sso: profile.managedByProvider,
      preferences,
    }).toEqual(page);
  });
});

describe("Settings › Profile, the options: old page = new screen", () => {
  it("offers the same zones with their offset and the same block of the monthly summary", async () => {
    const { cookie } = await person("user");
    const options = (await read("/profile/options", cookie)) as {
      timeZones: { zone: string; offset: string }[];
      monthlySummaryAllowed: boolean;
    };
    // What the server page computed (`profile/page.tsx` before the contract carried it).
    const now = new Date();
    expect(options.timeZones).toEqual(
      Intl.supportedValuesOf("timeZone").map((zone) => ({ zone, offset: utcOffsetLabel(zone, now) })),
    );
    expect(options.monthlySummaryAllowed).toBe((await mailPolicy()).monthlySummary);
  });
});

/** The rules the tests of `updateNameAction` held, on the route that replaced it. */
describe("Settings › Profile, renaming", () => {
  it("trims a name, and refuses one of spaces", async () => {
    const { cookie } = await person("user");
    const renamed = await rename("  Giulia Rossi  ", cookie);
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "Giulia Rossi" });
    const blank = await rename("   ", cookie);
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ error: "invalid" });
  });

  it("refuses to rename a person whose name the identity provider manages", async () => {
    const { userId, cookie } = await person("user");
    await getDb()
      .insert(authAccounts)
      .values({ userId, accountId: randomUUID(), providerId: OIDC_PROVIDER_ID });
    const refused = await rename("New Name", cookie);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "conflict", reason: "sso" });
    expect(((await read("/profile", cookie)) as { name: string }).name).toBe("Parity Person");
  });
});

// R3 parity of Admin › Server (03-releases.md §R3, criterion 11): what the server page read before it
// became a client screen — the sign-in provider, the mail transport, the AI service and the jobs — is
// what `GET /api/v1/server/settings` and `/server/jobs` answer.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAccounts, users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api } = await import("@/app/api/v1/[[...route]]/composition");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { llmFallbackView, oidcView, saveLlmFallback, saveSmtp, smtpView } =
  await import("@ledgerly/domain/platform/settings");
const { jobStatuses } = await import("@/platform/jobs/queries");
const { readEnv } = await import("@domain/platform/env");

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
});

// The settings it saves are sealed with this run's key: none may stay for the preview of the same database.
afterAll(async () => {
  await resetDatabase();
  await closeDatabase();
});

const origin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

/** A signed-in admin with no password row: the session owes no TOTP setup. */
async function admin() {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({
    body: { email, password: "correct-horse-battery", name: "Parity Admin", role: "admin" },
  });
  await getDb().update(users).set({ role: "admin" }).where(eq(users.id, created.user.id));
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

async function read(path: string, cookie: string): Promise<Record<string, unknown>> {
  const response = await api.fetch(new Request(`${origin()}/api/v1${path}`, { headers: { cookie } }));
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** Dates as the wire writes them. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("Admin › Server, old page = new screen", () => {
  it("shows the same provider, mail transport, AI service and jobs", async () => {
    const { userId, cookie } = await admin();
    const ctx = { userId, role: "admin" as const };
    await saveSmtp(ctx, {
      host: "mail.example.test",
      port: 587,
      encryption: "starttls",
      user: "ledgerly",
      password: "not-a-real-password",
      from: "Ledgerly <ledgerly@example.test>",
      invitations: true,
      syncAlerts: false,
      monthlySummary: true,
    });
    await saveLlmFallback(ctx, { model: "gpt-5-mini", apiKey: "sk-not-a-real-key-for-the-parity-test" });

    // What the server page read (`server/page.tsx` before R3).
    const page = {
      oidc: wire(await oidcView(ctx)),
      smtp: wire(await smtpView(ctx)),
      llm: wire(await llmFallbackView(ctx)),
      jobs: wire(await jobStatuses(ctx)),
    };

    // What the screen reads now.
    const settings = await read("/server/settings", cookie);
    const { jobs } = await read("/server/jobs", cookie);

    expect(settings.oidc).toMatchObject(page.oidc as object);
    expect(settings.smtp).toMatchObject(page.smtp as object);
    expect(settings.llm).toMatchObject(page.llm as object);
    expect(jobs).toEqual(page.jobs);
  });
});

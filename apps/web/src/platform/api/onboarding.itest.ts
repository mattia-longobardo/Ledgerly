// The first start on /api/v1 (rewrite plan R5a, E4, E8): a sign-up through Better Auth has it ahead,
// the routes end it and change the country, and only an admin reads or sets the instance's defaults.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contextFor } from "@domain/modules/users/jobs";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { getAuth, wireAuth } = await import("@domain/platform/auth/auth");
const { startOnboarding } = await import("@ledgerly/domain/users");

// The sign-up of this file starts the first start, as in the application (`test/wiring.ts` turns it off).
beforeAll(() => wireAuth({ userCreated: startOnboarding }));

async function send(userId: string, method: string, path: string, body?: unknown, role?: "admin") {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      const ctx = await contextFor({ id: userId });
      context.set("ctx", role ? { ...ctx, role } : ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

const FRANCE = {
  country: "FR",
  displayCurrency: "EUR",
  timeZone: "Europe/Paris",
  numberFormat: "fr-FR",
  locale: "en",
};

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the first start", () => {
  it("is ahead of a person who signs up, and ends with their country, format and addons", async () => {
    const auth = await getAuth();
    const email = `${randomUUID()}@example.test`;
    const created = await auth.api.createUser({ body: { email, password: randomUUID(), name: "New" } });
    const userId = created.user.id;

    expect((await send(userId, "GET", "/onboarding")).body).toEqual({
      pending: true,
      country: null,
      proposal: null,
    });
    // No addon is on before the person chooses it (PA13).
    const before = (await send(userId, "GET", "/addons")).body.addons;
    expect(before.every((one: { active: boolean }) => !one.active)).toBe(true);

    const done = await send(userId, "POST", "/onboarding", { ...FRANCE, addons: ["budgets", "pockets"] });
    expect(done).toEqual({ status: 200, body: { pending: false, country: "FR", proposal: null } });
    const addons = (await send(userId, "GET", "/addons")).body.addons;
    expect(
      addons.filter((one: { active: boolean }) => one.active).map((one: { id: string }) => one.id),
    ).toEqual(["budgets", "pockets"]);
    expect((await send(userId, "GET", "/payroll/payslips")).body).toEqual({
      error: "module_inactive",
      reason: "payroll",
    });

    expect(await send(userId, "PUT", "/country", { country: "BE" })).toEqual({
      status: 200,
      body: { country: "BE" },
    });
    expect((await send(userId, "PUT", "/country", { country: "belgium" })).status).toBe(400);
  });

  it("lists the countries with a pack and what each proposes", async () => {
    const user = await createTestUser();
    const answer = await send(user.id, "GET", "/countries");
    expect(answer.body.countries).toEqual([
      {
        country: "IT",
        currency: "EUR",
        timeZone: "Europe/Rome",
        numberFormat: "it-IT",
        locale: "it",
        weekStart: 1,
        interestTaxPercent: "26",
      },
    ]);
  });
});

describe("the instance's defaults", () => {
  it("are read and set by an admin only, and proposed to the next sign-up", async () => {
    const user = await createTestUser();
    expect((await send(user.id, "GET", "/server/defaults")).status).toBe(403);
    expect((await send(user.id, "PUT", "/server/defaults", FRANCE)).status).toBe(403);
    expect((await send(user.id, "GET", "/server/defaults", undefined, "admin")).body).toEqual({
      defaults: null,
    });
    expect(await send(user.id, "PUT", "/server/defaults", FRANCE, "admin")).toEqual({
      status: 200,
      body: { defaults: FRANCE },
    });
    expect((await send(user.id, "GET", "/onboarding")).body.proposal).toEqual(FRANCE);
  });
});

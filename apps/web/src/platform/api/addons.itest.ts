// The Addons on /api/v1 and MCP (rewrite plan R5a, H52, PA10-PA13): every route and read tool of an
// addon that is off answers `module_inactive`, the base routes and the numbers do not change, and an
// addon turned back on reads what it read before. The guard builds the context as the real one
// does, from the saved preferences, so a switch is seen by the next request.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADDONS, type AddonId, addonOf, CONTRACT_ROUTES } from "@ledgerly/api-contract";
import type { Ctx } from "@domain/platform/context";
import { contextFor } from "@domain/modules/users/jobs";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

const PLACEHOLDER_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

async function send(userId: string, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", await contextFor({ id: userId }));
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

const routesOf = (addon: AddonId) => CONTRACT_ROUTES.filter((route) => addonOf(route) === addon);

/** A route's path with its parameters filled from its example, or with an id when it has none. */
function pathOf(route: (typeof CONTRACT_ROUTES)[number]): string {
  const params = route.example.params ?? {};
  return route.path.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? PLACEHOLDER_ID);
}

/** The reads of an addon that need no id: what the person sees of it. */
async function readsOf(userId: string, addon: AddonId) {
  const answers: Record<string, unknown> = {};
  for (const route of routesOf(addon).filter((one) => one.method === "GET" && !one.params)) {
    const query = new URLSearchParams(route.example.query ?? {}).toString();
    answers[route.id] = await send(userId, "GET", `${route.path}${query ? `?${query}` : ""}`);
  }
  return answers;
}

let userId: string;

/** An account, a pocket on it and a subscription paid from it. */
async function seed() {
  const account = await send(userId, "POST", "/accounts", {
    name: "Checking",
    type: "checking",
    openingBalance: { on: "2026-01-01", amount: "900" },
  });
  expect(account.status).toBe(201);
  const pocket = await send(userId, "POST", "/pockets", {
    name: "Holiday",
    color: null,
    accountId: account.body.id,
    target: "1500",
    monthly: "100",
    startMonth: "2026-10-01",
  });
  expect(pocket.status, JSON.stringify(pocket.body)).toBe(201);
  const subscription = await send(userId, "POST", "/subscriptions", {
    name: "Holiday streaming",
    categoryId: null,
    accountId: account.body.id,
    price: "12.99",
    cycle: "monthly",
    chargeOn: "2026-10-05",
    payeeMatch: null,
    tolerance: "5",
    utility: 7,
  });
  expect(subscription.status, JSON.stringify(subscription.body)).toBe(201);
}

beforeEach(async () => {
  await resetDatabase();
  userId = (await createTestUser()).id;
});

afterAll(closeDatabase);

describe("GET and PUT /addons", () => {
  it("lists every addon on for a person of today, with what turning one off stops (PA12, PA13)", async () => {
    const answer = await send(userId, "GET", "/addons");
    expect(answer.status).toBe(200);
    expect(answer.body.addons.map((one: { id: string }) => one.id)).toEqual([...ADDONS]);
    expect(answer.body.addons.every((one: { active: boolean }) => one.active)).toBe(true);
    expect(answer.body.addons.find((one: { id: string }) => one.id === "payroll")).toEqual({
      id: "payroll",
      group: "work",
      active: true,
      stops: [
        { addon: "timeoff", what: "payslip_balances" },
        { addon: "funds", what: "payroll_contributions" },
      ],
    });
  });

  it("refuses an addon the list does not have, and a base module", async () => {
    expect((await send(userId, "PUT", "/addons/wallet", { active: false })).status).toBe(400);
    expect((await send(userId, "PUT", "/addons/accounts", { active: false })).status).toBe(400);
  });
});

describe("an addon that is off (PA10)", () => {
  it.each(ADDONS)("%s: every route and read tool answers module_inactive", async (addon) => {
    const off = await send(userId, "PUT", `/addons/${addon}`, { active: false });
    expect(off.body.addons.find((one: { id: string }) => one.id === addon).active).toBe(false);

    const routes = routesOf(addon);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const body = route.method === "GET" ? undefined : (route.example.body ?? {});
      const answer = await send(userId, route.method, pathOf(route), body);
      expect(answer, `${route.method} ${route.path}`).toEqual({
        status: 409,
        body: { error: "module_inactive", reason: addon },
      });
    }

    const ctx: Ctx = await contextFor({ id: userId });
    const tools = reads.filter((tool) => routes.some((route) => route.id === tool.name));
    for (const tool of tools) {
      await expect(tool.run(ctx, {}), tool.name).rejects.toThrow(`module_inactive: ${addon}`);
    }

    // The base modules and the other addons answer as before.
    expect((await send(userId, "GET", "/summary")).status).toBe(200);
    expect((await send(userId, "GET", "/accounts")).status).toBe(200);
    const other = ADDONS.find((one) => one !== addon)!;
    const otherRead = routesOf(other).find((route) => route.method === "GET" && !route.params)!;
    expect((await send(userId, "GET", otherRead.path)).status).not.toBe(409);
  });
});

describe("turning addons off and on again", () => {
  it("leaves the numbers as they are, and gives back what each addon read before (PA11)", async () => {
    await seed();
    const summary = await send(userId, "GET", "/summary");
    expect(summary.status).toBe(200);
    const before = Object.fromEntries(
      await Promise.all(ADDONS.map(async (addon) => [addon, await readsOf(userId, addon)] as const)),
    );

    for (const addon of ADDONS) {
      await send(userId, "PUT", `/addons/${addon}`, { active: false });
      expect(await send(userId, "GET", "/summary"), addon).toEqual(summary);
    }
    for (const addon of ADDONS) {
      await send(userId, "PUT", `/addons/${addon}`, { active: true });
      expect(await readsOf(userId, addon), addon).toEqual(before[addon]);
    }
    expect(await send(userId, "GET", "/summary")).toEqual(summary);
  });

  it("leaves an addon that is off out of the palette's search", async () => {
    await seed();
    const kinds = async () =>
      (await send(userId, "GET", "/search?q=holiday")).body.records.map((one: { kind: string }) => one.kind);
    expect((await kinds()).sort()).toEqual(["pocket", "subscription"]);
    await send(userId, "PUT", "/addons/pockets", { active: false });
    expect(await kinds()).toEqual(["subscription"]);
    await send(userId, "PUT", "/addons/subscriptions", { active: false });
    expect(await kinds()).toEqual([]);
  });
});

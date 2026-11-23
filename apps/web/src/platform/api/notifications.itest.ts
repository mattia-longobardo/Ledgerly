// The alerts on /api/v1 and MCP (rewrite plan R5e): «Da fare», the apps' periodic check, the read
// state and the channels of each event, and nothing of an addon that is off (PA10).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contextFor } from "@domain/modules/users/jobs";
import { getPreferences, setAddon } from "@domain/modules/users/service";
import { raise } from "@domain/platform/notifications/service";
import { saveConnection } from "@domain/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

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

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);

let userId: string;
let connectionId: string;

// Facts on a connection that exists: GET /todo closes the facts of a connection that is gone.
beforeEach(async () => {
  await resetDatabase();
  userId = (await createTestUser()).id;
  const ctx = { userId };
  connectionId = (
    await saveConnection(await contextFor({ id: userId }), {
      provider: WALLET_PROVIDER,
      credentials: { token: "t" },
    })
  ).id;
  await raise(ctx, { event: "connection_failed", subject: connectionId, targetId: connectionId }, ago(30));
  await raise(ctx, { event: "connection_stale", subject: connectionId, targetId: connectionId }, ago(20));
  await raise(
    ctx,
    { event: "budget_threshold", subject: "b|2026-11-01", targetId: "b", params: { percent: 85 } },
    ago(10),
  );
});
afterAll(closeDatabase);

describe("GET /todo", () => {
  it("lists the facts that ask for an action, oldest first, with the page that resolves them", async () => {
    const todo = await send(userId, "GET", "/todo");
    expect(todo.status).toBe(200);
    expect(todo.body.items.map((item: { event: string }) => item.event)).toEqual([
      "connection_failed",
      "connection_stale",
    ]);
    expect(todo.body.items[0].target).toEqual({ page: "connection", id: connectionId });
  });

  it("is a read tool of MCP with the same answer", async () => {
    const tool = reads.find((one) => one.name === "list_todo");
    expect(tool).toBeDefined();
    const answer = await tool!.run(await contextFor({ id: userId }), {});
    expect(answer).toEqual((await send(userId, "GET", "/todo")).body);
    expect(reads.filter((one) => one.name.includes("notification"))).toEqual([]);
  });
});

describe("GET /notifications", () => {
  it("gives the device the events whose device channel is on, then only what is newer", async () => {
    const first = await send(userId, "GET", "/notifications");
    expect(first.body.items.map((item: { event: string }) => item.event)).toEqual([
      "connection_failed",
      "connection_stale",
    ]);
    expect((await send(userId, "GET", `/notifications?since=${first.body.cursor}`)).body).toEqual({
      items: [],
      cursor: first.body.cursor,
    });
    const ending = `${connectionId}:3:2026-12-01`;
    await raise(
      { userId },
      { event: "connection_expiring", subject: ending, params: { days: 3, date: "2026-12-01" } },
    );
    const next = await send(userId, "GET", `/notifications?since=${first.body.cursor}`);
    expect(next.body.items.map((item: { event: string }) => item.event)).toEqual(["connection_expiring"]);
  });

  it("answers invalid for a cursor it never gave", async () => {
    expect((await send(userId, "GET", "/notifications?since=yesterday")).status).toBe(400);
  });

  it("marks one read, once, and refuses an id that is not the person's", async () => {
    const [item] = (await send(userId, "GET", "/notifications")).body.items;
    expect((await send(userId, "POST", `/notifications/${item.id}/read`)).status).toBe(204);
    const readAt = (await send(userId, "GET", "/notifications")).body.items[0].readAt;
    expect(readAt).not.toBeNull();
    await send(userId, "POST", `/notifications/${item.id}/read`);
    expect((await send(userId, "GET", "/notifications")).body.items[0].readAt).toBe(readAt);
    const other = (await createTestUser()).id;
    expect((await send(other, "POST", `/notifications/${item.id}/read`)).status).toBe(404);
  });
});

describe("the channels of each event", () => {
  it("are the defaults, with the monthly summary's email from the person's preference", async () => {
    const choices = await send(userId, "GET", "/notification-preferences");
    const failed = choices.body.events.find((one: { event: string }) => one.event === "connection_failed");
    expect(failed).toMatchObject({ channels: { inApp: true, email: true, device: true }, locked: ["inApp"] });
    const summary = choices.body.events.find((one: { event: string }) => one.event === "monthly_summary");
    expect(summary.channels.email).toBe(false);
  });

  it("change one at a time; the device stops getting an event turned off", async () => {
    const changed = await send(userId, "PUT", "/notification-preferences/connection_stale", {
      device: false,
    });
    expect(changed.status).toBe(200);
    expect(
      (await send(userId, "GET", "/notifications")).body.items.map((item: { event: string }) => item.event),
    ).toEqual(["connection_failed"]);
  });

  it("keep the email of an event without one off", async () => {
    const choices = await send(userId, "GET", "/notification-preferences");
    const payslips = choices.body.events.find((one: { event: string }) => one.event === "payslips_to_review");
    expect(payslips).toMatchObject({ channels: { email: false }, locked: ["inApp", "email"] });
    expect(
      (await send(userId, "PUT", "/notification-preferences/payslips_to_review", { email: true })).status,
    ).toBe(400);
  });

  it("refuse a locked channel turned off, and an event of an addon that is off", async () => {
    expect(
      (await send(userId, "PUT", "/notification-preferences/connection_failed", { inApp: false })).status,
    ).toBe(400);
    await setAddon({ userId }, "budgets", false);
    const refused = await send(userId, "PUT", "/notification-preferences/budget_threshold", { email: false });
    expect(refused.status).toBe(409);
  });

  it("write the monthly summary's email into the person's preference", async () => {
    await send(userId, "PUT", "/notification-preferences/monthly_summary", { email: true });
    expect((await getPreferences({ userId })).monthlySummary).toBe(true);
  });
});

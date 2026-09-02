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

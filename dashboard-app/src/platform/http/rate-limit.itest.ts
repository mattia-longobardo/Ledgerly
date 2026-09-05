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

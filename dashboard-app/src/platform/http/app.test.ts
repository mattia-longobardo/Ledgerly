import { describe, expect, it } from "vitest";
import { createApiApp } from "./app";
import { testPrincipal } from "@/test/principal";

const deps = {
  db: {} as never,
  authenticate: async (req: Request) =>
    req.headers.get("x-test-user") ? { principal: testPrincipal(), method: "session" as const } : null,
  now: () => new Date("2026-09-02T10:00:00Z"),
  rateLimitEnabled: false,
};

/** Same app, but the caller arrived with a bearer token rather than a cookie. */
const tokenDeps = {
  ...deps,
  authenticate: async (req: Request) =>
    req.headers.get("x-test-user") ? { principal: testPrincipal(), method: "token" as const } : null,
};

describe("api app", () => {
  it("serves the OpenAPI document to an authenticated caller", async () => {
    const res = await createApiApp(deps).request("/api/v1/openapi.json", { headers: { "x-test-user": "1" } });
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe("Finance Dashboard API");
  });
  it("answers 401 with the error envelope when unauthenticated", async () => {
    const res = await createApiApp(deps).request("/api/v1/openapi.json");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(typeof body.error.requestId).toBe("string");
  });
  it("answers 404 with the envelope for unknown routes", async () => {
    const res = await createApiApp(deps).request("/api/v1/nope", { headers: { "x-test-user": "1" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
  it("refuses a cookie-authenticated write without X-Requested-With", async () => {
    const res = await createApiApp(deps).request("/api/v1/nope", {
      method: "POST",
      headers: { "x-test-user": "1" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("csrf_required");
  });
  it("lets the same write through once the header is present", async () => {
    const res = await createApiApp(deps).request("/api/v1/nope", {
      method: "POST",
      headers: { "x-test-user": "1", "x-requested-with": "fetch" },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
  it("does not ask a token-authenticated write for the header", async () => {
    const res = await createApiApp(tokenDeps).request("/api/v1/nope", {
      method: "POST",
      headers: { "x-test-user": "1" },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

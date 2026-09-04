import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { unusedDb } from "@/test/integration-deps";
import { describeCurrentSession, loadUsers } from "./load-settings";

describe("describeCurrentSession", () => {
  it("reads the user agent and the forwarded ip", () => {
    const session = describeCurrentSession(
      new Headers({ "user-agent": "Mozilla/5.0 Firefox/141.0", "x-forwarded-for": "10.0.0.4, 10.0.0.1" }),
    );
    expect(session).toEqual({ userAgent: "Mozilla/5.0 Firefox/141.0", ip: "10.0.0.4", current: true });
  });

  it("falls back to a readable placeholder when the headers say nothing", () => {
    expect(describeCurrentSession(new Headers())).toEqual({
      userAgent: "Unknown device",
      ip: null,
      current: true,
    });
  });
});

describe("loadUsers", () => {
  it("refuses a principal without admin.users before touching the database", async () => {
    // `unusedDb` is a real, unconnected client rather than `{} as never`: if the
    // permission check were ever moved below the query, this test would fail
    // with a connection error instead of silently passing on a stub.
    await expect(loadUsers(unusedDb, testPrincipal({ roles: ["member"] }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { roleFromIdToken } from "./roles";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
const token = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject("u1").sign(secret);

describe("roleFromIdToken", () => {
  it("grants admin to members of the admin group", async () => {
    expect(roleFromIdToken(await token({ groups: ["finance-admins", "x"] }), "finance-admins")).toBe("admin");
  });

  it("returns null otherwise, so SSO never demotes anyone", async () => {
    expect(roleFromIdToken(await token({ groups: ["finance-users"] }), "finance-admins")).toBeNull();
    expect(roleFromIdToken(await token({}), "finance-admins")).toBeNull();
    expect(roleFromIdToken(await token({ groups: "finance-admins" }), "finance-admins")).toBeNull();
  });
});

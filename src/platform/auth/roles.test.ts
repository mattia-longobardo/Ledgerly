import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { roleFromIdToken } from "./roles";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
const token = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject("u1").sign(secret);

describe("roleFromIdToken", () => {
  it("grants admin to members of the admin group", async () => {
    expect(roleFromIdToken(await token({ groups: ["ledgerly-admins", "x"] }), "ledgerly-admins")).toBe(
      "admin",
    );
  });

  it("returns null otherwise, so SSO never demotes anyone", async () => {
    expect(roleFromIdToken(await token({ groups: ["ledgerly-users"] }), "ledgerly-admins")).toBeNull();
    expect(roleFromIdToken(await token({}), "ledgerly-admins")).toBeNull();
    expect(roleFromIdToken(await token({ groups: "ledgerly-admins" }), "ledgerly-admins")).toBeNull();
  });
});

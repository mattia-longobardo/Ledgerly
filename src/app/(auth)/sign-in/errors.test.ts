import { describe, expect, it } from "vitest";
import { signInErrorKey } from "./errors";

describe("signInErrorKey", () => {
  it("maps provider and Better Auth error codes to messages", () => {
    expect(signInErrorKey("oidc")).toBe("oidc");
    expect(signInErrorKey("invitation_required")).toBe("invitationRequired");
    expect(signInErrorKey("INVALID_EMAIL_OR_PASSWORD")).toBe("credentials");
    expect(signInErrorKey("BANNED_USER")).toBe("banned");
    expect(signInErrorKey("anything-else")).toBe("generic");
    expect(signInErrorKey("constructor")).toBe("generic");
    expect(signInErrorKey(undefined)).toBeNull();
  });

  it("reads the first value when Better Auth appended its own error code", () => {
    expect(signInErrorKey(["oidc", "access_denied"])).toBe("oidc");
    expect(signInErrorKey(["oidc", "constructor"])).toBe("oidc");
    expect(signInErrorKey([])).toBeNull();
  });

  it("explains an Authentik sign-in refused for a known reason", () => {
    expect(signInErrorKey(["oidc", "account_not_linked"])).toBe("accountNotLinked");
    expect(signInErrorKey(["oidc", "BANNED_USER"])).toBe("banned");
  });
});

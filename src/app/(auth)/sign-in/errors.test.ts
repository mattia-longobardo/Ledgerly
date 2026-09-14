import { describe, expect, it } from "vitest";
import { signInErrorKey } from "./errors";

describe("signInErrorKey", () => {
  it("maps provider and Better Auth error codes to messages", () => {
    expect(signInErrorKey("oidc")).toBe("oidc");
    expect(signInErrorKey("invitation_required")).toBe("invitationRequired");
    expect(signInErrorKey("INVALID_EMAIL_OR_PASSWORD")).toBe("credentials");
    expect(signInErrorKey("anything-else")).toBe("generic");
    expect(signInErrorKey(undefined)).toBeNull();
  });
});

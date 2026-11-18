import { describe, expect, it } from "vitest";
import { RESET_PASSWORD_TOKEN_TTL_SECONDS } from "./auth";
import { invitationEmail, passwordResetEmail } from "./emails";
import { INVITATION_TTL_DAYS } from "./invitations";

const RESET_HOURS = RESET_PASSWORD_TOKEN_TTL_SECONDS / 3600;

describe("emails", () => {
  it("include the link and follow the locale", () => {
    const en = invitationEmail("https://x.test/invite/abc", INVITATION_TTL_DAYS);
    const it_ = invitationEmail("https://x.test/invite/abc", INVITATION_TTL_DAYS, "it");
    expect(en.text).toContain("https://x.test/invite/abc");
    expect(it_.text).toContain("https://x.test/invite/abc");
    expect(en.subject).not.toBe(it_.subject);
    expect(passwordResetEmail("https://x.test/r", RESET_HOURS, "it").text).toContain("https://x.test/r");
  });

  it("renders the real TTL, not a hard-coded one, into the copy", () => {
    expect(invitationEmail("https://x.test/i", 7).text).toContain("7 days");
    expect(invitationEmail("https://x.test/i", 1).text).toContain("1 day");
    expect(invitationEmail("https://x.test/i", 7, "it").text).toContain("7 giorni");
    expect(passwordResetEmail("https://x.test/r", 1).text).toContain("1 hour");
    expect(passwordResetEmail("https://x.test/r", 2).text).toContain("2 hours");
    expect(passwordResetEmail("https://x.test/r", 1, "it").text).toContain("1 ora");
  });
});

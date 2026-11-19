import { beforeEach, describe, expect, it, vi } from "vitest";
import { revokeOtherSessionsAction } from "./actions";

const {
  requireSession,
  hasSsoAccount,
  updateUser,
  revokeSession,
  revokeOtherSessions,
  findSessionToken,
  getPreferences,
  updatePreferences,
  revalidatePath,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  hasSsoAccount: vi.fn(),
  updateUser: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  findSessionToken: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/session", () => ({ requireSession }));
vi.mock("@domain/platform/auth/accounts", () => ({ hasSsoAccount }));
vi.mock("@domain/platform/auth/auth", () => ({
  getAuth: () => ({ api: { updateUser, revokeSession, revokeOtherSessions } }),
}));
vi.mock("@domain/modules/users/service", () => ({ findSessionToken, getPreferences, updatePreferences }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@domain/platform/integrations/service", () => ({ rescheduleConnections: vi.fn(async () => 0) }));

const CTX = {
  userId: "alice",
  role: "user" as const,
  locale: "en" as const,
  timeZone: "Europe/Rome",
  numberFormat: "it-IT" as const,
};
/** A provider error whose message carries a credential in a URL query string. */
const LEAKY_ERROR = new Error("revoke failed at https://auth.example.test/revoke?token=secret-token");

describe("session revocation failures", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue(CTX);
    findSessionToken.mockReset().mockResolvedValue("the-owner-session-token");
    revokeSession.mockReset().mockRejectedValue(LEAKY_ERROR);
    revokeOtherSessions.mockReset().mockRejectedValue(LEAKY_ERROR);
  });

  it.each([["the other sessions", () => revokeOtherSessionsAction()]])(
    "reports failure and logs the error redacted when revoking %s",
    async (_, revoke) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await revoke()).toEqual({ ok: false, error: "failed" });
      expect(log).toHaveBeenCalledWith(
        "[users] session revocation failed",
        expect.objectContaining({ message: "revoke failed at https://auth.example.test/revoke?[redacted]" }),
      );
      log.mockRestore();
    },
  );
});

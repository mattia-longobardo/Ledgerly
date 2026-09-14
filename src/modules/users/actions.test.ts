import { beforeEach, describe, expect, it, vi } from "vitest";
import { revokeSessionAction, updateNameAction } from "./actions";

const { requireSession, hasSsoAccount, updateUser, revokeSession, findSessionToken } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  hasSsoAccount: vi.fn(),
  updateUser: vi.fn(),
  revokeSession: vi.fn(),
  findSessionToken: vi.fn(),
}));

vi.mock("@/platform/auth/session", () => ({ requireSession }));
vi.mock("@/platform/auth/accounts", () => ({ hasSsoAccount }));
vi.mock("@/platform/auth/auth", () => ({
  getAuth: () => ({ api: { updateUser, revokeSession } }),
}));
vi.mock("./service", () => ({ findSessionToken, getPreferences: vi.fn(), updatePreferences: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CTX = {
  userId: "alice",
  role: "user" as const,
  locale: "en" as const,
  timeZone: "Europe/Rome",
  numberFormat: "it-IT" as const,
};
const FOREIGN_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("updateNameAction", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue(CTX);
    hasSsoAccount.mockReset();
    updateUser.mockReset();
  });

  it("refuses to rename an SSO-linked account, without calling Better Auth", async () => {
    hasSsoAccount.mockResolvedValueOnce(true);
    expect(await updateNameAction("New Name")).toEqual({ ok: false, error: "sso" });
    expect(hasSsoAccount).toHaveBeenCalledWith(CTX.userId);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("trims and saves a name when there is no SSO account", async () => {
    hasSsoAccount.mockResolvedValueOnce(false);
    expect(await updateNameAction("  Giulia Rossi  ")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { name: "Giulia Rossi" } }));
  });

  it("refuses a whitespace-only name", async () => {
    hasSsoAccount.mockResolvedValueOnce(false);
    expect(await updateNameAction("   ")).toEqual({ ok: false, error: "invalid" });
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("revokeSessionAction", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue(CTX);
    findSessionToken.mockReset();
    revokeSession.mockReset();
  });

  it("is a silent no-op for a session id that is not the caller's", async () => {
    findSessionToken.mockResolvedValueOnce(null);
    expect(await revokeSessionAction(FOREIGN_SESSION_ID)).toEqual({ ok: true });
    expect(findSessionToken).toHaveBeenCalledWith(CTX, FOREIGN_SESSION_ID);
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it("revokes the session through Better Auth when the token resolves", async () => {
    findSessionToken.mockResolvedValueOnce("the-owner-session-token");
    expect(await revokeSessionAction(FOREIGN_SESSION_ID)).toEqual({ ok: true });
    expect(revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: "the-owner-session-token" } }),
    );
  });
});

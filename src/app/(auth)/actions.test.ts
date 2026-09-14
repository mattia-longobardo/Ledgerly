import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptInviteAction } from "./actions";

const { acceptInvitation, signInEmail, InvitationError } = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  signInEmail: vi.fn(),
  InvitationError: class InvitationError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/platform/auth/auth", () => ({ getAuth: () => ({ api: { signInEmail } }) }));
vi.mock("@/platform/auth/invitations", () => ({ acceptInvitation, InvitationError }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const PASSWORD = "long-enough-password";
const valid = { name: " Giulia Rossi ", password: PASSWORD, confirm: PASSWORD };
/** The error `redirect()` throws carries its target as `NEXT_REDIRECT;<type>;<path>;<status>;`. */
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) });

describe("acceptInviteAction", () => {
  beforeEach(() => {
    acceptInvitation.mockReset();
    signInEmail.mockReset();
  });

  it("creates the account, signs the invitee in and opens the app", async () => {
    acceptInvitation.mockResolvedValueOnce({ userId: "u1", email: "giulia@example.test" });
    await expect(acceptInviteAction("tok", valid)).rejects.toMatchObject(redirectTo("/"));
    expect(acceptInvitation).toHaveBeenCalledWith(expect.anything(), {
      token: "tok",
      name: "Giulia Rossi",
      password: PASSWORD,
      confirm: PASSWORD,
    });
    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: "giulia@example.test", password: PASSWORD } }),
    );
  });

  it("sends the invitee to sign in by hand when the automatic sign-in fails", async () => {
    acceptInvitation.mockResolvedValueOnce({ userId: "u1", email: "giulia@example.test" });
    signInEmail.mockRejectedValueOnce(new Error("Too many requests"));
    await expect(acceptInviteAction("tok", valid)).rejects.toMatchObject(redirectTo("/sign-in"));
  });

  it.each([[""], ["   "], ["x".repeat(101)]])("refuses an unusable name (%#)", async (name) => {
    expect(await acceptInviteAction("tok", { ...valid, name })).toEqual({ error: "name" });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("refuses arguments that are not strings", async () => {
    const forged = { ...valid, password: 42 } as unknown as typeof valid;
    expect(await acceptInviteAction("tok", forged)).toEqual({ error: "invalid" });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that does not match", async () => {
    expect(await acceptInviteAction("tok", { ...valid, confirm: "something-else-entirely" })).toEqual({
      error: "mismatch",
    });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("passes on why the invitation was refused", async () => {
    acceptInvitation.mockRejectedValueOnce(new InvitationError("email_taken"));
    expect(await acceptInviteAction("tok", valid)).toEqual({ error: "email_taken" });
    expect(signInEmail).not.toHaveBeenCalled();
  });
});

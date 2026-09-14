import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const getSession = vi.hoisted(() => vi.fn());
const completeInvitationWithSso = vi.hoisted(() => vi.fn());

vi.mock("@/platform/auth/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/platform/auth/invitations", () => ({ completeInvitationWithSso }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const request = new Request("http://127.0.0.1:3000/invite/tok/complete");
const complete = (token = "tok") => GET(request, { params: Promise.resolve({ token }) });
/** The error `redirect()` throws carries its target as `NEXT_REDIRECT;<type>;<path>;<status>;`. */
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) });

describe("GET /invite/[token]/complete", () => {
  beforeEach(() => {
    getSession.mockReset();
    completeInvitationWithSso.mockReset();
  });

  it("sends a visitor without a session to /sign-in and leaves the invitation alone", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(complete()).rejects.toMatchObject(redirectTo("/sign-in"));
    expect(completeInvitationWithSso).not.toHaveBeenCalled();
  });

  it("applies the invitation to the signed-in user and opens the app", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", email: "giulia@example.test" } });
    completeInvitationWithSso.mockResolvedValueOnce("accepted");
    await expect(complete()).rejects.toMatchObject(redirectTo("/"));
    expect(completeInvitationWithSso).toHaveBeenCalledWith("tok", {
      userId: "u1",
      email: "giulia@example.test",
    });
  });

  it("returns to the invitation with the reason when it cannot be applied", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", email: "other@example.test" } });
    completeInvitationWithSso.mockResolvedValueOnce("email_mismatch");
    await expect(complete()).rejects.toMatchObject(redirectTo("/invite/tok?error=email_mismatch"));
  });

  it("keeps a malformed token inside the invitation path", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", email: "giulia@example.test" } });
    completeInvitationWithSso.mockResolvedValueOnce("invalid");
    await expect(complete("a/../b?x#y")).rejects.toMatchObject(
      redirectTo("/invite/a%2F..%2Fb%3Fx%23y?error=invalid"),
    );
  });
});

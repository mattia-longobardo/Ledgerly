import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { acceptInvitation, signInEmail, InvitationError } = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  signInEmail: vi.fn(),
  InvitationError: class InvitationError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@domain/platform/auth/auth", () => ({ getAuth: () => ({ api: { signInEmail } }) }));
vi.mock("@/platform/auth/invitations", () => ({ acceptInvitation, InvitationError }));
vi.mock("@ledgerly/domain/platform/env", () => ({
  readEnv: () => ({ BETTER_AUTH_URL: "https://ledgerly.example.test" }),
}));

const ORIGIN = "https://ledgerly.example.test";
const PASSWORD = "long-enough-password";
const valid = { name: "Giulia Rossi", password: PASSWORD, confirm: PASSWORD };

async function accept(body: unknown, origin: string | null = ORIGIN) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  const response = await POST(
    new Request(`${ORIGIN}/api/invite/tok/accept`, { method: "POST", headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ token: "tok" }) },
  );
  return { status: response.status, body: await response.json() };
}

describe("POST /api/invite/[token]/accept", () => {
  beforeEach(() => {
    acceptInvitation.mockReset();
    signInEmail.mockReset();
  });

  it("creates the account, signs the invitee in and sends them to the app", async () => {
    acceptInvitation.mockResolvedValueOnce({ userId: "u1", email: "giulia@example.test" });
    expect(await accept(valid)).toEqual({ status: 200, body: { next: "/" } });
    expect(acceptInvitation).toHaveBeenCalledWith(expect.anything(), { ...valid, token: "tok" });
    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: "giulia@example.test", password: PASSWORD } }),
    );
  });

  it("sends the invitee to sign in by hand when the automatic sign-in fails", async () => {
    acceptInvitation.mockResolvedValueOnce({ userId: "u1", email: "giulia@example.test" });
    signInEmail.mockRejectedValueOnce(new Error("Too many requests"));
    expect(await accept(valid)).toEqual({ status: 200, body: { next: "/sign-in" } });
  });

  it("answers the refusals of the action", async () => {
    expect(await accept({ ...valid, name: "  " })).toEqual({ status: 400, body: { error: "name" } });
    expect(await accept({ ...valid, password: 42 })).toEqual({ status: 400, body: { error: "invalid" } });
    // No fields at all: the name is missing first, as the action said.
    expect(await accept("not an object")).toEqual({ status: 400, body: { error: "name" } });
    expect(await accept({ ...valid, confirm: "something-else-entirely" })).toEqual({
      status: 400,
      body: { error: "mismatch" },
    });
    acceptInvitation.mockRejectedValueOnce(new InvitationError("email_taken"));
    expect(await accept(valid)).toEqual({ status: 400, body: { error: "email_taken" } });
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("refuses a call that does not come from a page of the instance", async () => {
    expect(await accept(valid, "https://elsewhere.example.test")).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(await accept(valid, null)).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const signedInFrom = vi.hoisted(() => vi.fn());
vi.mock("@/platform/auth/signed-in", () => ({ signedInFrom }));

const get = () => GET(new Request("http://127.0.0.1:3000/api/web/session"));

describe("GET /api/web/session", () => {
  it("answers null to a request without a session", async () => {
    signedInFrom.mockResolvedValueOnce(null);
    const response = await get();
    expect(await response.json()).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("gives the person, their preferences and the setup gate, and never the session", async () => {
    signedInFrom.mockResolvedValueOnce({
      user: { id: "u1", role: "admin", email: "u1@example.test", twoFactorEnabled: true, banned: false },
      session: { id: "s1", token: "t" },
      preferences: { locale: "it" },
      setupPending: false,
    });
    expect(await (await get()).json()).toEqual({
      user: { id: "u1", role: "admin", email: "u1@example.test" },
      preferences: { locale: "it" },
      setupPending: false,
    });
  });
});

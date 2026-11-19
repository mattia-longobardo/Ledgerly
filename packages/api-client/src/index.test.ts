import { SETTINGS } from "@ledgerly/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call } from "./index";

const PROFILE = {
  id: "7d4f1c2e-9b8a-4c3d-8e5f-1a2b3c4d5e6f",
  name: "Alex Example",
  email: "alex@example.test",
  role: "user",
  managedByProvider: false,
  twoFactor: false,
};

function answer(status: number, body: unknown) {
  const fetcher = vi.fn(
    async (...request: [string, RequestInit]) =>
      request && new Response(body === null ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe("call", () => {
  it("reads with the session and no proof of origin, and checks the answer's shape", async () => {
    const fetcher = answer(200, PROFILE);
    await expect(call(SETTINGS.profile.getProfile, {})).resolves.toEqual(PROFILE);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/profile");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).not.toHaveProperty("x-ledgerly-csrf");
  });

  it("writes with the header that proves the app sent it, and a JSON body", async () => {
    const fetcher = answer(200, { ...PROFILE, name: "Alex Sample" });
    await call(SETTINGS.profile.updateProfile, { body: { name: "Alex Sample" } });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({ "x-ledgerly-csrf": "1", "content-type": "application/json" });
    expect(init?.body).toBe(JSON.stringify({ name: "Alex Sample" }));
  });

  it("puts the path parameters in the address and answers nothing for a 204", async () => {
    const fetcher = answer(204, null);
    const id = "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e";
    await expect(call(SETTINGS.security.revokeSession, { params: { id } })).resolves.toBeNull();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/sessions/${id}`);
  });

  it("throws the refusal's code and reason", async () => {
    answer(409, { error: "conflict", reason: "sso" });
    await expect(call(SETTINGS.profile.updateProfile, { body: { name: "x" } })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      reason: "sso",
    });
  });

  it("refuses an answer that is not the declared shape", async () => {
    answer(200, { name: 1 });
    await expect(call(SETTINGS.profile.getProfile, {})).rejects.toBeInstanceOf(ApiError);
  });
});

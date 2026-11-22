import { beforeEach, describe, expect, it, vi } from "vitest";
import { originalLinkFor } from "@domain/modules/imports/service/original-link";
import { GET } from "./route";

const readOriginal = vi.hoisted(() => vi.fn());
const isActiveUser = vi.hoisted(() => vi.fn());
const sessionCtxOf = vi.hoisted(() => vi.fn());

vi.mock("@domain/platform/env", () => ({
  readEnv: () => ({ BETTER_AUTH_SECRET: "a-secret-of-at-least-thirty-two-characters" }),
}));
vi.mock("@domain/modules/imports/service", () => ({ readOriginal }));
vi.mock("@domain/platform/auth/accounts", () => ({ isActiveUser }));
vi.mock("@/platform/auth/signed-in", () => ({ sessionCtxOf }));

const DOCUMENT = "019a0000-0000-7000-8000-000000000001";
const open = (token: string, headers: HeadersInit = {}) =>
  GET(new Request(`http://127.0.0.1:3000/api/v1/originals/${token}`, { headers }), {
    params: Promise.resolve({ token }),
  });

describe("GET /api/v1/originals/{token}", () => {
  beforeEach(() => {
    readOriginal.mockReset().mockResolvedValue({
      bytes: new Uint8Array([37, 80, 68, 70]),
      mime: "application/pdf",
      fileName: "busta.pdf",
    });
    isActiveUser.mockReset().mockResolvedValue(true);
    sessionCtxOf.mockReset().mockResolvedValue(null);
  });

  it("serves the person's original inline, never cached, framable by this site alone", async () => {
    const response = await open(originalLinkFor(DOCUMENT, "u1").token);
    expect(response.status).toBe(200);
    expect(readOriginal).toHaveBeenCalledWith({ userId: "u1" }, DOCUMENT);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'self'",
      "referrer-policy": "no-referrer",
    });
  });

  it("refuses an address past its five minutes", async () => {
    const { token } = originalLinkFor(DOCUMENT, "u1", new Date(Date.now() - 5 * 60_000 - 1_000));
    const response = await open(token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden", reason: "link_expired" });
    expect(readOriginal).not.toHaveBeenCalled();
  });

  it("refuses an altered address", async () => {
    const { token } = originalLinkFor(DOCUMENT, "u1");
    const [, signature] = token.split(".");
    const another = Buffer.from(`${DOCUMENT}.u2.${Math.floor(Date.now() / 1000) + 300}`).toString(
      "base64url",
    );
    for (const altered of [`${another}.${signature}`, `${token}x`, "nothing"]) {
      const response = await open(altered);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden", reason: "link_invalid" });
    }
    expect(readOriginal).not.toHaveBeenCalled();
  });

  it("does not find a document of another person: the read is the person's of the address", async () => {
    readOriginal.mockResolvedValueOnce(null);
    const response = await open(originalLinkFor("019a0000-0000-7000-8000-0000000000ff", "u1").token);
    expect(response.status).toBe(404);
  });

  it("refuses the address of another person in a browser signed in as someone else", async () => {
    sessionCtxOf.mockResolvedValueOnce({ userId: "u2" });
    const response = await open(originalLinkFor(DOCUMENT, "u1").token, { cookie: "session=x" });
    expect(response.status).toBe(403);
    expect(readOriginal).not.toHaveBeenCalled();
  });

  it("refuses the address of a person blocked or gone since it was made", async () => {
    isActiveUser.mockResolvedValueOnce(false);
    const response = await open(originalLinkFor(DOCUMENT, "u1").token);
    expect(response.status).toBe(403);
    expect(readOriginal).not.toHaveBeenCalled();
  });
});

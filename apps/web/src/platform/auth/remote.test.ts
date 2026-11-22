import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, fetchConsent, fetchSignedIn } from "./remote";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
});

describe("apiOrigin", () => {
  it("is the same process when the web runs with the server", () => {
    vi.stubEnv("LEDGERLY_API_URL", undefined as unknown as string);
    vi.stubEnv("PORT", "3000");
    expect(apiOrigin()).toBe("http://127.0.0.1:3000");
  });

  it("is the server's container when the web runs alone", () => {
    vi.stubEnv("LEDGERLY_API_URL", "http://ledgerly:3000");
    expect(apiOrigin()).toBe("http://ledgerly:3000");
  });
});

describe("the server's answers", () => {
  it("sends the request's cookie and none of its other headers", async () => {
    vi.stubEnv("LEDGERLY_API_URL", "http://ledgerly:3000");
    fetchMock.mockResolvedValueOnce(Response.json(null));
    const browser = new Headers({ cookie: "a=1", authorization: "Bearer x", origin: "https://evil.test" });
    expect(await fetchConsent("client_id=c&sig=s", browser)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("http://ledgerly:3000/api/web/consent?client_id=c&sig=s", {
      headers: { cookie: "a=1" },
      cache: "no-store",
      redirect: "manual",
    });
  });

  it("treats a server that does not answer as an error, never as a signed-out visitor", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(fetchSignedIn(new Headers())).rejects.toThrow("502");
  });

  it("refuses an answer of another shape", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ user: { id: 1 } }));
    await expect(fetchSignedIn(new Headers())).rejects.toThrow();
  });

  it("gives null for a request without a session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(null));
    expect(await fetchSignedIn(new Headers())).toBeNull();
  });
});

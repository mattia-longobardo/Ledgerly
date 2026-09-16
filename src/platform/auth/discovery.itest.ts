import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { closeDatabase } from "../../../test/db";
import { type Auth, getAuth } from "./auth";
import { OIDC_PROVIDER_ID } from "./provider";

/** Stands in for the identity provider's discovery endpoint; serves the mock provider's real document when up. */
let mode: "down" | "hanging" | "up" = "down";
let discoveryDocument = "";
let server: Server;
let consoleError: MockInstance<typeof console.error>;

const hasSso = async (auth: Auth) =>
  (await auth.$context).socialProviders.some((provider) => provider.id === OIDC_PROVIDER_ID);

beforeAll(async () => {
  discoveryDocument = await (await fetch(process.env.OIDC_DISCOVERY_URL as string)).text();
  server = createServer((_request, response) => {
    if (mode === "up") response.writeHead(200, { "content-type": "application/json" }).end(discoveryDocument);
    if (mode === "down") response.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("OIDC_DISCOVERY_URL", `http://127.0.0.1:${port}/.well-known/openid-configuration`);
});

beforeEach(() => {
  (globalThis as { ledgerlyAuth?: unknown }).ledgerlyAuth = undefined;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

describe("getAuth when identity-provider discovery fails", () => {
  it("keeps serving without SSO, then retries with a doubling backoff until discovery succeeds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    mode = "down";

    const first = getAuth();
    expect(await hasSso(first)).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(`Provider "${OIDC_PROVIDER_ID}"`));
    vi.setSystemTime(start + 4_999);
    expect(getAuth()).toBe(first);

    vi.setSystemTime(start + 5_000);
    const second = getAuth();
    expect(second).not.toBe(first);
    expect(await hasSso(second)).toBe(false);
    vi.setSystemTime(start + 5_000 + 9_999);
    expect(getAuth()).toBe(second);

    mode = "up";
    vi.setSystemTime(start + 5_000 + 10_000);
    const recovered = getAuth();
    expect(recovered).not.toBe(second);
    expect(await hasSso(recovered)).toBe(true);
    vi.setSystemTime(start + 60 * 60_000);
    expect(getAuth()).toBe(recovered);
  });

  it("stops waiting for a discovery that never answers", async () => {
    mode = "hanging";
    expect(await hasSso(getAuth())).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Discovery for "${OIDC_PROVIDER_ID}" timed out after 5000 ms`),
    );
    // Let the abandoned request fail (and log) while console.error is still silenced.
    server.closeAllConnections();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Discovery fetch failed")),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://dashboard@localhost/dashboard",
  AUTH_URL: "https://dash.example.test",
  AUTH_SECRET: "a".repeat(40),
  OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  AUTHORIZED_SUB: "sub-123",
  PAPERLESS_URL: "https://paperless.example.test",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
};

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

/** env() caches per module graph, so each variant needs a fresh registry. */
async function loadGotify(gotify: { url?: string; token?: string }) {
  vi.resetModules();
  Object.assign(process.env, BASE_ENV);
  delete process.env.GOTIFY_URL;
  delete process.env.GOTIFY_TOKEN;
  if (gotify.url) process.env.GOTIFY_URL = gotify.url;
  if (gotify.token) process.env.GOTIFY_TOKEN = gotify.token;
  return import("./gotify");
}

const CONFIGURED = { url: "https://gotify.example.test/", token: "gotify-token" };

function body(i = 0): Record<string, unknown> {
  const init = (fetchMock.mock.calls[i]?.[1] ?? {}) as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("notify", () => {
  it("posts to /message with the X-Gotify-Key header", async () => {
    const { notify } = await loadGotify(CONFIGURED);

    await expect(notify({ title: "t", message: "m", priority: 5 })).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gotify.example.test/message");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Gotify-Key"]).toBe("gotify-token");
    expect(body()).toEqual({ title: "t", message: "m", priority: 5 });
  });

  it("is a no-op when Gotify is not configured", async () => {
    const { notify } = await loadGotify({});
    await expect(notify({ title: "t", message: "m", priority: 5 })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when Gotify is down", async () => {
    const { notify } = await loadGotify(CONFIGURED);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(notify({ title: "t", message: "m", priority: 5 })).resolves.toBe(false);
  });

  it("never throws when Gotify answers 500", async () => {
    const { notify } = await loadGotify(CONFIGURED);
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    await expect(notify({ title: "t", message: "m", priority: 5 })).resolves.toBe(false);
  });

  it("never throws when the environment itself is broken", async () => {
    vi.resetModules();
    Object.assign(process.env, BASE_ENV);
    process.env.GOTIFY_URL = "not-a-url";
    process.env.GOTIFY_TOKEN = "gotify-token";
    const { notify } = await import("./gotify");
    await expect(notify({ title: "t", message: "m", priority: 5 })).resolves.toBe(false);
    delete process.env.GOTIFY_URL;
  });
});

describe("alert helpers", () => {
  it("sends job failures at priority 8", async () => {
    const { alertJobFailure } = await loadGotify(CONFIGURED);
    await alertJobFailure({ job: "monthly_close", error: "wallet 401", monthKey: "2026-09-01" });
    expect(body().priority).toBe(8);
    expect(String(body().title)).toContain("monthly_close");
    expect(String(body().message)).toContain("wallet 401");
  });

  it("sends success-after-retry at priority 4", async () => {
    const { alertSuccessAfterRetry } = await loadGotify(CONFIGURED);
    await alertSuccessAfterRetry({ job: "sweep", attempts: 3 });
    expect(body().priority).toBe(4);
  });

  it("sends payslip-pending at priority 5 with a deep link", async () => {
    const { alertPayslipPending } = await loadGotify(CONFIGURED);
    await alertPayslipPending({ payslipId: 42, month: "2026-08-01" });
    expect(body().priority).toBe(5);
    expect(String(body().message)).toContain("https://dash.example.test/payroll/verify/42");
  });
});

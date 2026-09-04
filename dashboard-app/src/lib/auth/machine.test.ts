import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRON_SECRET_HEADER,
  WEBHOOK_SECRET_HEADER,
  constantTimeEqual,
  resetMachineAuthRateLimits,
  verifyCronSecret,
  verifyWebhookSecret,
} from "@/lib/auth/machine";

const CRON_SECRET = "cron-secret-0123456789abcdef";
const WEBHOOK_SECRET = "webhook-secret-0123456789abcdef";

// `env()` validates the whole schema, so every required variable has to be present.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dashboard:pw@localhost:5432/dashboard",
  AUTH_URL: "https://dashboard.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  OIDC_ISSUER: "https://auth.example/application/o/dashboard/",
  OIDC_CLIENT_ID: "dashboard",
  OIDC_CLIENT_SECRET: "client-secret",
  AUTHORIZED_SUB: "00000000-0000-0000-0000-000000000001",
  PAPERLESS_URL: "https://paperless.example",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET,
  WEBHOOK_SECRET,
  APP_ENCRYPTION_KEY: `unit:${Buffer.alloc(32, 9).toString("base64")}`,
});

function request(headers: Record<string, string> = {}, url = "https://dashboard.example/api/jobs/snapshot"): Request {
  return new Request(url, { method: "POST", headers });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetMachineAuthRateLimits();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("verifyCronSecret", () => {
  it("passes the correct secret", () => {
    expect(verifyCronSecret(request({ [CRON_SECRET_HEADER]: CRON_SECRET }))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns 404 (not 401/403) for a wrong secret", () => {
    const res = verifyCronSecret(request({ [CRON_SECRET_HEADER]: "wrong-secret-but-same-len" }));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
  });

  it("returns 404 when the header is missing", () => {
    expect(verifyCronSecret(request())?.status).toBe(404);
  });

  it("returns 404 when the header is present but empty", () => {
    expect(verifyCronSecret(request({ [CRON_SECRET_HEADER]: "" }))?.status).toBe(404);
  });

  it("does not accept the webhook secret", () => {
    expect(verifyCronSecret(request({ [CRON_SECRET_HEADER]: WEBHOOK_SECRET }))?.status).toBe(404);
  });

  it("logs a structured failure line that never contains the secret", () => {
    verifyCronSecret(request({ [CRON_SECRET_HEADER]: "totally-wrong" }));
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    const parsed: unknown = JSON.parse(line);
    expect(parsed).toMatchObject({
      event: "machine_auth_failure",
      kind: "cron",
      reason: "bad_secret",
      path: "/api/jobs/snapshot",
      method: "POST",
    });
    expect(line).not.toContain(CRON_SECRET);
    expect(line).not.toContain("totally-wrong");
  });
});

describe("verifyWebhookSecret", () => {
  it("passes the correct secret", () => {
    expect(verifyWebhookSecret(request({ [WEBHOOK_SECRET_HEADER]: WEBHOOK_SECRET }))).toBeNull();
  });

  it("does not accept the cron secret", () => {
    expect(verifyWebhookSecret(request({ [WEBHOOK_SECRET_HEADER]: CRON_SECRET }))?.status).toBe(404);
  });
});

describe("constantTimeEqual", () => {
  it("does not throw on a length mismatch and reports inequality", () => {
    expect(() => constantTimeEqual("a", "a-much-longer-secret-value")).not.toThrow();
    expect(constantTimeEqual("a", "a-much-longer-secret-value")).toBe(false);
    expect(constantTimeEqual("", CRON_SECRET)).toBe(false);
  });

  it("is true for identical values", () => {
    expect(constantTimeEqual(CRON_SECRET, CRON_SECRET)).toBe(true);
  });

  it("survives multi-byte input of differing byte length", () => {
    expect(() => constantTimeEqual("ünïcödé✓", "x")).not.toThrow();
    expect(constantTimeEqual("ünïcödé✓", "ünïcödé✓")).toBe(true);
  });
});

describe("rate limiter", () => {
  it("trips after 30 requests per minute for a secret kind", () => {
    const req = request({ [CRON_SECRET_HEADER]: CRON_SECRET });
    for (let i = 0; i < 30; i += 1) {
      expect(verifyCronSecret(req)).toBeNull();
    }
    const blocked = verifyCronSecret(req);
    expect(blocked?.status).toBe(404);
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(line)).toMatchObject({ reason: "rate_limited", kind: "cron" });
  });

  it("counts the two secret kinds independently", () => {
    const cronReq = request({ [CRON_SECRET_HEADER]: CRON_SECRET });
    for (let i = 0; i < 31; i += 1) verifyCronSecret(cronReq);
    expect(verifyWebhookSecret(request({ [WEBHOOK_SECRET_HEADER]: WEBHOOK_SECRET }))).toBeNull();
  });

  it("opens a fresh window once the previous one has elapsed", () => {
    vi.useFakeTimers();
    try {
      const req = request({ [CRON_SECRET_HEADER]: CRON_SECRET });
      for (let i = 0; i < 31; i += 1) verifyCronSecret(req);
      expect(verifyCronSecret(req)?.status).toBe(404);
      vi.advanceTimersByTime(60_001);
      expect(verifyCronSecret(req)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

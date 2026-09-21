import { afterEach, describe, expect, it, vi } from "vitest";
import { alertAdmins } from "./gotify";

/** `readEnv` caches, so each case gets its own module instance with its own environment. */
async function withEnv(env: Record<string, string | undefined>, body: () => Promise<void>) {
  vi.resetModules();
  const previous = { GOTIFY_URL: process.env.GOTIFY_URL, GOTIFY_TOKEN: process.env.GOTIFY_TOKEN };
  Object.assign(process.env, env);
  try {
    await body();
  } finally {
    Object.assign(process.env, previous);
  }
}

const BASE = {
  DATABASE_URL: "postgres://ledgerly:secret@db:5432/ledgerly",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "unit-secret-unit-secret-unit-secret-32",
  OIDC_DISCOVERY_URL: "http://127.0.0.1:9/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "ledgerly",
  OIDC_CLIENT_SECRET: "unused",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "9",
  MAIL_FROM: "Ledgerly <ledgerly@example.test>",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET: "ledgerly",
  APP_ENCRYPTION_KEY: "k1:gBubFxNEhi1CSofEa9MtLb5lSXHXROI4WupEIGMhsZU=",
  CRON_SECRET: "unit-cron-secret-unit-cron-secret-32",
  METRICS_TOKEN: "unit-metrics-token-unit-metrics-token",
};

afterEach(() => {
  vi.resetModules();
});

describe("alertAdmins", () => {
  it("does nothing, quietly, when Gotify is not configured", async () => {
    await withEnv({ ...BASE, GOTIFY_URL: "", GOTIFY_TOKEN: "" }, async () => {
      const { alertAdmins: fresh } = await import("./gotify");
      const fetching = vi.fn();
      expect(await fresh({ title: "t", message: "m" }, { fetch: fetching as unknown as typeof fetch })).toBe(
        "off",
      );
      expect(fetching).not.toHaveBeenCalled();
    });
  });

  it("posts the message to /message with the key in a header, never in the body", async () => {
    await withEnv({ ...BASE, GOTIFY_URL: "https://push.example/", GOTIFY_TOKEN: "the-key" }, async () => {
      const { alertAdmins: fresh } = await import("./gotify");
      const calls: { url: string; init: RequestInit }[] = [];
      const fetching = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch;
      expect(await fresh({ title: "Ledgerly", message: "boom", priority: 7 }, { fetch: fetching })).toBe(
        "sent",
      );
      expect(calls[0].url).toBe("https://push.example/message");
      expect((calls[0].init.headers as Record<string, string>)["X-Gotify-Key"]).toBe("the-key");
      expect(String(calls[0].init.body)).not.toContain("the-key");
      expect(JSON.parse(String(calls[0].init.body))).toEqual({
        title: "Ledgerly",
        message: "boom",
        priority: 7,
      });
    });
  });

  it("reports a refusal and a failure to reach it without throwing either", async () => {
    await withEnv({ ...BASE, GOTIFY_URL: "https://push.example", GOTIFY_TOKEN: "k" }, async () => {
      const { alertAdmins: fresh } = await import("./gotify");
      const refusing = (async () => ({ ok: false, status: 401 }) as Response) as unknown as typeof fetch;
      expect(await fresh({ title: "t", message: "m" }, { fetch: refusing })).toBe("failed");
      const throwing = (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch;
      expect(await fresh({ title: "t", message: "m" }, { fetch: throwing })).toBe("failed");
    });
  });
});

describe("the exported function", () => {
  it("is the one the jobs import", () => {
    expect(typeof alertAdmins).toBe("function");
  });
});

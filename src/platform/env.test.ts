import { describe, expect, it } from "vitest";
import { envSchema, isHttpsOrLoopback } from "./env";

const valid = {
  DATABASE_URL: "postgres://ledgerly:ledgerly@127.0.0.1:55432/ledgerly",
  BETTER_AUTH_URL: "https://ledgerly.example.test",
  BETTER_AUTH_SECRET: "a-real-secret-a-real-secret-a-real-secret",
  OIDC_DISCOVERY_URL: "https://auth.example.test/application/o/ledgerly/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "ledgerly",
  OIDC_CLIENT_SECRET: "client-secret",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "51025",
  MAIL_FROM: "Ledgerly <ledgerly@example.test>",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: "ledgerly",
  S3_SECRET_ACCESS_KEY: "ledgerly-dev-secret",
  S3_BUCKET: "ledgerly-test",
  APP_ENCRYPTION_KEY: "k1:PB4iEGbA1r5Ct3ySrU8MdGe9FB7bR9ZxKt4QmVxgZ0Y=",
  CRON_SECRET: "a-real-cron-secret-sixteen-plus-ok",
  METRICS_TOKEN: "a-real-metrics-token-thirty-two-chars-plus",
};

const production = (overrides: Record<string, string | undefined>) =>
  envSchema.safeParse({ ...valid, NODE_ENV: "production", ...overrides });

const failingKeys = (result: ReturnType<typeof production>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

describe("envSchema in production", () => {
  it("accepts https URLs and a generated secret", () => {
    expect(production({}).success).toBe(true);
  });

  it("requires https for the app and the identity provider", () => {
    const result = production({
      BETTER_AUTH_URL: "http://ledgerly.example.test",
      OIDC_DISCOVERY_URL: "http://auth.example.test/.well-known/openid-configuration",
    });
    expect(failingKeys(result)).toEqual(["BETTER_AUTH_URL", "OIDC_DISCOVERY_URL"]);
  });

  it("allows plain http on a loopback host (the end-to-end suite)", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      expect(
        production({ BETTER_AUTH_URL: `http://${host}`, OIDC_DISCOVERY_URL: `http://${host}/x` }).success,
      ).toBe(true);
    }
  });

  it("does not mistake a lookalike host for loopback", () => {
    expect(failingKeys(production({ BETTER_AUTH_URL: "http://127.0.0.1.example.test" }))).toEqual([
      "BETTER_AUTH_URL",
    ]);
  });

  it("rejects the .env.example placeholder secret", () => {
    expect(
      failingKeys(production({ BETTER_AUTH_SECRET: "change-me-change-me-change-me-change-me" })),
    ).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("rejects the .env.example placeholder CRON_SECRET", () => {
    expect(failingKeys(production({ CRON_SECRET: "dev-cron-secret-dev-cron-secret-dev" }))).toEqual([
      "CRON_SECRET",
    ]);
  });

  it("rejects the .env.example placeholder APP_ENCRYPTION_KEY", () => {
    expect(
      failingKeys(production({ APP_ENCRYPTION_KEY: "dev:1fXJEH66bW3y0iE+bgEqimdJ1uEjw3fXyqeUmHosTdA=" })),
    ).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("rejects the .env.example placeholder METRICS_TOKEN", () => {
    expect(failingKeys(production({ METRICS_TOKEN: "dev-metrics-token-dev-metrics-token" }))).toEqual([
      "METRICS_TOKEN",
    ]);
  });

  it("does not throw when a URL field is malformed", () => {
    expect(() => production({ BETTER_AUTH_URL: "not-a-url" })).not.toThrow();
    expect(production({ BETTER_AUTH_URL: "not-a-url" }).success).toBe(false);
  });

  it("requires TLS when SMTP_USER is set", () => {
    expect(failingKeys(production({ SMTP_USER: "mailer" }))).toEqual(["SMTP_REQUIRE_TLS"]);
  });

  it("accepts SMTP_USER when SMTP_SECURE is true", () => {
    expect(production({ SMTP_USER: "mailer", SMTP_SECURE: "true" }).success).toBe(true);
  });

  it("accepts SMTP_USER when SMTP_REQUIRE_TLS is true", () => {
    expect(production({ SMTP_USER: "mailer", SMTP_REQUIRE_TLS: "true" }).success).toBe(true);
  });

  it("does not require TLS when SMTP_USER is unset", () => {
    expect(production({}).success).toBe(true);
  });

  it("requires METRICS_TOKEN", () => {
    expect(failingKeys(production({ METRICS_TOKEN: undefined }))).toEqual(["METRICS_TOKEN"]);
  });
});

describe("APP_ENCRYPTION_KEY", () => {
  const keyRing = (value: string | undefined) =>
    failingKeys(envSchema.safeParse({ ...valid, APP_ENCRYPTION_KEY: value }));

  it("is required: without it nothing can be sealed", () => {
    expect(keyRing(undefined)).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("rejects a key that is not 32 bytes of base64", () => {
    expect(keyRing("k1:dG9vLXNob3J0")).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("rejects an entry without a key id", () => {
    expect(keyRing("PB4iEGbA1r5Ct3ySrU8MdGe9FB7bR9ZxKt4QmVxgZ0Y=")).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("accepts a ring of a new key and the one it replaces", () => {
    expect(
      keyRing(
        "k2:PB4iEGbA1r5Ct3ySrU8MdGe9FB7bR9ZxKt4QmVxgZ0Y=,k1:gBubFxNEhi1CSofEa9MtLb5lSXHXROI4WupEIGMhsZU=",
      ),
    ).toEqual([]);
  });
});

describe("envSchema outside production", () => {
  it("allows http and the placeholder secret for local development", () => {
    const result = envSchema.safeParse({
      ...valid,
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://ledgerly.lan:3000",
      OIDC_DISCOVERY_URL: "http://auth.lan/.well-known/openid-configuration",
      BETTER_AUTH_SECRET: "change-me-change-me-change-me-change-me",
    });
    expect(result.success).toBe(true);
  });
});

describe("TRUSTED_PROXY_IPS", () => {
  const trustedProxies = (value: string | undefined) => {
    const result = envSchema.safeParse({ ...valid, TRUSTED_PROXY_IPS: value });
    return result.success ? result.data.TRUSTED_PROXY_IPS : null;
  };

  it("trusts no proxy when unset", () => {
    expect(trustedProxies(undefined)).toEqual([]);
  });

  it("reads comma-separated IPs and CIDR ranges", () => {
    expect(trustedProxies(" 172.18.0.2, 10.0.0.0/24,fd00::/8 ,, ")).toEqual([
      "172.18.0.2",
      "10.0.0.0/24",
      "fd00::/8",
    ]);
  });

  it("rejects an entry that is not an IP or a CIDR range", () => {
    expect(trustedProxies("172.18.0.2, traefik")).toBeNull();
    expect(trustedProxies("10.0.0.0/33")).toBeNull();
  });
});

describe("isHttpsOrLoopback", () => {
  it("accepts https and loopback http, rejects everything else", () => {
    expect(isHttpsOrLoopback("https://example.test")).toBe(true);
    expect(isHttpsOrLoopback("http://127.0.0.1:3000")).toBe(true);
    expect(isHttpsOrLoopback("http://localhost:3000")).toBe(true);
    expect(isHttpsOrLoopback("http://example.test")).toBe(false);
  });

  it("never throws on a value that is not a parseable URL", () => {
    expect(() => isHttpsOrLoopback("not a url")).not.toThrow();
    expect(isHttpsOrLoopback("not a url")).toBe(true);
  });
});

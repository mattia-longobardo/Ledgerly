import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

const valid = {
  DATABASE_URL: "postgres://finance:finance@127.0.0.1:55432/finance",
  BETTER_AUTH_URL: "https://finance.example.test",
  BETTER_AUTH_SECRET: "a-real-secret-a-real-secret-a-real-secret",
  OIDC_DISCOVERY_URL: "https://auth.example.test/application/o/finance/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "finance",
  OIDC_CLIENT_SECRET: "client-secret",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "51025",
  MAIL_FROM: "Finance Dashboard <finance@example.test>",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: "finance",
  S3_SECRET_ACCESS_KEY: "finance-dev-secret",
  S3_BUCKET: "finance-test",
  CRON_SECRET: "a-real-cron-secret-sixteen-plus",
};

const production = (overrides: Record<string, string>) =>
  envSchema.safeParse({ ...valid, NODE_ENV: "production", ...overrides });

const failingKeys = (result: ReturnType<typeof production>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

describe("envSchema in production", () => {
  it("accepts https URLs and a generated secret", () => {
    expect(production({}).success).toBe(true);
  });

  it("requires https for the app and the identity provider", () => {
    const result = production({
      BETTER_AUTH_URL: "http://finance.example.test",
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
});

describe("envSchema outside production", () => {
  it("allows http and the placeholder secret for local development", () => {
    const result = envSchema.safeParse({
      ...valid,
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://finance.lan:3000",
      OIDC_DISCOVERY_URL: "http://auth.lan/.well-known/openid-configuration",
      BETTER_AUTH_SECRET: "change-me-change-me-change-me-change-me",
    });
    expect(result.success).toBe(true);
  });
});

import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authLogger, redactForLog } from "./logger";

const SECRET = "s3cr3t-token-value";

function databaseError() {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint "sessions_token_unique"'),
    {
      code: "23505",
      detail: `Key (token)=(${SECRET}) already exists.`,
    },
  );
  return new DrizzleQueryError('insert into "sessions" ("token") values ($1)', [SECRET], cause);
}

/** Everything a console would print for the value: message, stack and own properties. */
function printed(value: unknown): string {
  if (!(value instanceof Error)) return String(value);
  return [value.message, value.stack, JSON.stringify(value), value.cause ? printed(value.cause) : ""].join(
    "\n",
  );
}

describe("redactForLog", () => {
  it("drops the parameters of a failed query but keeps the SQL and the error code", () => {
    const redacted = redactForLog(databaseError());
    expect(printed(redacted)).not.toContain(SECRET);
    expect(redacted).toBeInstanceOf(Error);
    expect((redacted as Error).message).toBe('Failed query: insert into "sessions" ("token") values ($1)');
    expect((redacted as Error).cause).toMatchObject({ code: "23505" });
  });

  it("strips URL query strings, where OAuth codes and tokens travel", () => {
    const error = new Error(`fetch failed: https://auth.example.test/token?code=${SECRET}&state=x`);
    const redacted = redactForLog(error) as Error;
    expect(printed(redacted)).not.toContain(SECRET);
    expect(redacted.message).toBe("fetch failed: https://auth.example.test/token?[redacted]");
    expect(redactForLog(`callback http://127.0.0.1:3000/api/auth/callback/authentik?code=${SECRET}`)).toBe(
      "callback http://127.0.0.1:3000/api/auth/callback/authentik?[redacted]",
    );
  });

  it("strips the parameter line of a query error that was interpolated into text", () => {
    expect(redactForLog(`Error: ${databaseError().message}`)).not.toContain(SECRET);
  });

  it("passes other values through", () => {
    expect(redactForLog({ provider: "authentik" })).toEqual({ provider: "authentik" });
  });
});

describe("authLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes redacted messages and arguments to the console at the given level", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authLogger.log?.("error", `Discovery fetch failed: https://idp.test/x?token=${SECRET}`, databaseError());
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0].map(printed).join("\n")).not.toContain(SECRET);
  });
});

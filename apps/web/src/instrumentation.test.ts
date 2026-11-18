import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { describeEnvFailure, register } from "./instrumentation";

/** A process that is allowed to keep running after `process.exit(1)`, so the test can inspect it. */
function stubbedProcess() {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return { exit, logged, line: () => logged.mock.calls.map((call) => String(call[0])).join("\n") };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("describeEnvFailure", () => {
  it("names every rejected variable on one line", () => {
    const error = new ZodError([
      { code: "custom", path: ["APP_ENCRYPTION_KEY"], message: "Invalid key ring" },
      { code: "custom", path: ["CRON_SECRET"], message: "Too small" },
    ]);
    expect(describeEnvFailure(error)).toBe("APP_ENCRYPTION_KEY: Invalid key ring; CRON_SECRET: Too small");
  });

  it("describes an error that is not a ZodError, and one that is not an Error at all", () => {
    expect(describeEnvFailure(new Error("no key ring"))).toBe("no key ring");
    expect(describeEnvFailure("no key ring")).toBe("no key ring");
  });
});

describe("register", () => {
  it("refuses to start when a check fails, instead of leaving a server listening", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    // Compose passes an unset variable as "", which is how a forgotten secret really arrives.
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    const { exit, logged, line } = stubbedProcess();

    register();

    expect(exit).toHaveBeenCalledWith(1);
    // One line, not a ZodError dump: the whole point is a log the next probe cannot rotate away.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(line()).toContain("[env] refusing to start");
    expect(line()).toContain("APP_ENCRYPTION_KEY");
    expect(line()).not.toContain("\n");
  });

  it("does not print the rejected value", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_ENCRYPTION_KEY", "k1:this-is-not-canonical-base64-material");
    const { line } = stubbedProcess();

    register();

    expect(line()).toContain("APP_ENCRYPTION_KEY");
    expect(line()).not.toContain("this-is-not-canonical-base64-material");
  });

  it("stays out of `next build`, which has none of the secrets it would check", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    const { exit, logged } = stubbedProcess();

    register();

    expect(exit).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it("stays out of the edge runtime, which owns none of these checks", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    const { exit, logged } = stubbedProcess();

    register();

    expect(exit).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });
});

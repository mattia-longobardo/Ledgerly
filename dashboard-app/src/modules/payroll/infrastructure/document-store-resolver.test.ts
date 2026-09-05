import { describe, expect, it } from "vitest";
import { storeFromDriver } from "./document-store-resolver";

describe("storeFromDriver", () => {
  it("builds a local store from an explicit path", () => {
    const res = storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "development", credentials: null });
    expect(res?.driver).toBe("local");
    expect(res?.store.provider).toBe("local");
  });

  it("returns null for the local driver with no path — never a silently invented directory", () => {
    expect(storeFromDriver({ driver: "local", localPath: undefined, nodeEnv: "development", credentials: null })).toBeNull();
  });

  it("refuses the local driver in production (Ruling R4-16: the container is read-only)", () => {
    expect(() =>
      storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "production", credentials: null }),
    ).toThrow(/local document store is not usable in production/i);
  });

  it("builds a silo store from a complete credential", () => {
    const res = storeFromDriver({
      driver: "silo",
      localPath: undefined,
      nodeEnv: "production",
      credentials: {
        endpoint: "https://silo.internal",
        bucket: "payroll",
        region: "us-east-1",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      },
    });
    expect(res?.driver).toBe("silo");
    expect(res?.store.provider).toBe("silo");
  });

  it("returns null for the silo driver with no connection — the setup state, not an error", () => {
    expect(storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: "production", credentials: null })).toBeNull();
  });
});

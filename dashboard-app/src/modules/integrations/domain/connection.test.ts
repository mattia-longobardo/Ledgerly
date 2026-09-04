import { describe, expect, it } from "vitest";
import {
  DISCONNECT_POLICIES,
  describeDisconnectPolicy,
  isUsable,
  nextStatusAfterSync,
  statusAfterTest,
} from "./connection";
import type { IntegrationConnection } from "@/platform/integrations/types";

const base: IntegrationConnection = {
  id: "c1",
  userId: "u1",
  provider: "wallet",
  status: "connected",
  settings: {},
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  disconnectPolicy: "keep",
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("connection domain", () => {
  it("maps a test result onto a status", () => {
    expect(statusAfterTest({ ok: true, message: "ok" })).toBe("connected");
    expect(statusAfterTest({ ok: false, message: "401" })).toBe("error");
  });

  it("only a connected connection is usable", () => {
    expect(isUsable(base)).toBe(true);
    for (const status of ["disconnected", "error", "disabled"] as const) {
      expect(isUsable({ ...base, status })).toBe(false);
    }
  });

  it("a failed sync moves the connection to error and a good one back to connected", () => {
    expect(nextStatusAfterSync(true)).toBe("error");
    expect(nextStatusAfterSync(false)).toBe("connected");
  });

  it("describes all three disconnect policies, each saying what happens to the data", () => {
    expect(DISCONNECT_POLICIES).toEqual(["keep", "archive", "purge"]);
    // Every sentence has to say the credential goes — that is the one promise
    // shared by all three (spec §8.4) and the UI shows this text verbatim.
    for (const policy of DISCONNECT_POLICIES) {
      expect(describeDisconnectPolicy(policy)).toMatch(/credential is deleted/);
    }
    expect(describeDisconnectPolicy("keep")).toMatch(/history stay/);
    expect(describeDisconnectPolicy("archive")).toMatch(/archived/);
    expect(describeDisconnectPolicy("purge")).toMatch(/deleted\.$/);
    // Three distinct sentences, not one repeated.
    expect(new Set(DISCONNECT_POLICIES.map(describeDisconnectPolicy)).size).toBe(3);
  });
});

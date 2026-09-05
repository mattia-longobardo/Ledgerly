import { describe, expect, it } from "vitest";
import { deletionDecision, type Account } from "./account";

const base: Account = {
  id: "a", userId: "u", groupId: null, name: "Cash", type: "cash", currency: "EUR", origin: "manual", provider: null,
  status: "active", includeInNetWorth: true, notes: null, sortOrder: 0, version: 1, archivedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("deletionDecision", () => {
  it("manual + unreferenced → hard delete", () => {
    expect(deletionDecision(base, { hasLiveProviderLink: false, hasReferences: false })).toBe("hard_delete");
  });
  it("manual + referenced → archive", () => {
    expect(deletionDecision(base, { hasLiveProviderLink: false, hasReferences: true })).toBe("archive");
  });
  it("synced with a live link → blocked", () => {
    expect(deletionDecision({ ...base, origin: "synced", provider: "wallet" }, { hasLiveProviderLink: true, hasReferences: false })).toBe("blocked_linked");
  });
  it("synced but missing upstream → archive", () => {
    expect(deletionDecision({ ...base, origin: "synced", status: "unavailable" }, { hasLiveProviderLink: false, hasReferences: false })).toBe("archive");
  });
});

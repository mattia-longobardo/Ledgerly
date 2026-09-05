import { describe, expect, it } from "vitest";
import { pairTransfers, type TransferCandidate } from "./transaction";

describe("pairTransfers", () => {
  it("pairs two legs sharing an external transfer reference, deterministically", () => {
    const candidates: TransferCandidate[] = [
      { id: "11111111-0000-7000-8000-000000000001", accountId: "acc-a", amount: "-50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "22222222-0000-7000-8000-000000000002", accountId: "acc-b", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "33333333-0000-7000-8000-000000000003", accountId: "acc-c", amount: "-10.00", occurredAt: new Date("2026-09-01"), externalTransferRef: null },
    ];
    const groups = pairTransfers(candidates);
    expect(groups.get("11111111-0000-7000-8000-000000000001")).toBe("11111111-0000-7000-8000-000000000001");
    expect(groups.get("22222222-0000-7000-8000-000000000002")).toBe("11111111-0000-7000-8000-000000000001");
    expect(groups.has("33333333-0000-7000-8000-000000000003")).toBe(false);
  });

  it("does not pair a lone leg even if it carries a reference", () => {
    const candidates: TransferCandidate[] = [
      { id: "id-1", accountId: "acc-a", amount: "-50.00", occurredAt: new Date(), externalTransferRef: "xfer-solo" },
    ];
    expect(pairTransfers(candidates).size).toBe(0);
  });

  it("does not pair two legs with matching amount and date but no shared reference", () => {
    // Same day, opposite amounts, different accounts — looks exactly like a
    // transfer, but with no externalTransferRef there is nothing to key the
    // pair on, so it must stay two separate, unpaired transactions.
    const candidates: TransferCandidate[] = [
      { id: "id-a", accountId: "acc-a", amount: "-50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: null },
      { id: "id-b", accountId: "acc-b", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: null },
    ];
    expect(pairTransfers(candidates).size).toBe(0);
  });

  it("keeps two independent transfer references from cross-contaminating", () => {
    const candidates: TransferCandidate[] = [
      { id: "a1", accountId: "acc-a", amount: "-50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "a2", accountId: "acc-b", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-1" },
      { id: "b1", accountId: "acc-c", amount: "-20.00", occurredAt: new Date("2026-09-02"), externalTransferRef: "xfer-2" },
      { id: "b2", accountId: "acc-d", amount: "20.00", occurredAt: new Date("2026-09-02"), externalTransferRef: "xfer-2" },
    ];
    const groups = pairTransfers(candidates);
    expect(groups.get("a1")).toBe("a1");
    expect(groups.get("a2")).toBe("a1");
    expect(groups.get("b1")).toBe("b1");
    expect(groups.get("b2")).toBe("b1");
  });

  it("groups every leg sharing a reference, even when more than two share it", () => {
    // Three legs on one reference is a data anomaly (a real transfer has
    // exactly two sides), but the rule is unambiguous either way: it never
    // guesses which two of the three "really" belong together — it groups
    // everyone who shares the reference under one deterministic id.
    const candidates: TransferCandidate[] = [
      { id: "zzz", accountId: "acc-a", amount: "-50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-dup" },
      { id: "aaa", accountId: "acc-b", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-dup" },
      { id: "mmm", accountId: "acc-c", amount: "50.00", occurredAt: new Date("2026-09-01"), externalTransferRef: "xfer-dup" },
    ];
    const groups = pairTransfers(candidates);
    expect(groups.get("zzz")).toBe("aaa");
    expect(groups.get("aaa")).toBe("aaa");
    expect(groups.get("mmm")).toBe("aaa");
  });

  it("returns an empty result for no candidates, never a fabricated pairing", () => {
    expect(pairTransfers([]).size).toBe(0);
  });
});

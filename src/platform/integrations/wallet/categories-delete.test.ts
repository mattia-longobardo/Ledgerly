import { describe, expect, it, vi } from "vitest";
import { DELETE_BATCH, deleteWalletCategories, type WalletCategoryWriter } from "./categories";

vi.mock("../service", () => ({
  listConnections: async () => connections,
  readCredentials: async () => ({ token }),
}));

let connections: { id: string; provider: string }[] = [];
let token = "wallet-token";

/** A writer that records what it was asked to delete and answers however the test says. */
function writer(
  answer: (ids: readonly string[]) => { externalId: string; ok: boolean; error: string | null }[],
): WalletCategoryWriter & { batches: string[][] } {
  const batches: string[][] = [];
  return {
    batches,
    async remove(ids) {
      batches.push([...ids]);
      return answer(ids);
    },
    async rename() {
      throw new Error("rename: not part of a deletion");
    },
    async create() {
      throw new Error("create: not part of a deletion");
    },
  };
}

const ctx = { userId: "u1" };
const allFine = (ids: readonly string[]) => ids.map((externalId) => ({ externalId, ok: true, error: null }));

describe("deleteWalletCategories", () => {
  it("does nothing at all when the category was never linked to Wallet", async () => {
    const wallet = writer(allFine);
    expect(await deleteWalletCategories(ctx, [], { writer: wallet })).toEqual({ state: "not_linked" });
    expect(wallet.batches).toEqual([]);
  });

  it("deletes the ids it was given and counts them", async () => {
    const wallet = writer(allFine);
    expect(await deleteWalletCategories(ctx, ["w1", "w2"], { writer: wallet })).toEqual({
      state: "deleted",
      count: 2,
    });
    expect(wallet.batches).toEqual([["w1", "w2"]]);
  });

  it("never sends more than a batch per request", async () => {
    const wallet = writer(allFine);
    const ids = Array.from({ length: DELETE_BATCH + 3 }, (_, i) => `w${i}`);
    await deleteWalletCategories(ctx, ids, { writer: wallet });
    expect(wallet.batches).toHaveLength(2);
    expect(wallet.batches[0]).toHaveLength(DELETE_BATCH);
    expect(wallet.batches[1]).toHaveLength(3);
  });

  it("passes Wallet's own reason back rather than inventing one", async () => {
    const wallet = writer((ids) =>
      ids.map((externalId) => ({
        externalId,
        ok: false,
        error: "still referenced by 3 records",
      })),
    );
    expect(await deleteWalletCategories(ctx, ["w1", "w2"], { writer: wallet })).toEqual({
      state: "refused",
      reasons: ["still referenced by 3 records"],
    });
  });

  it("reports a refusal even when part of the batch landed: the person has to know", async () => {
    const wallet = writer((ids) =>
      ids.map((externalId, index) => ({
        externalId,
        ok: index === 0,
        error: index === 0 ? null : "in use",
      })),
    );
    expect(await deleteWalletCategories(ctx, ["w1", "w2"], { writer: wallet })).toMatchObject({
      state: "refused",
    });
  });

  it("answers rather than throwing when the call itself fails", async () => {
    const wallet: WalletCategoryWriter = {
      async remove() {
        throw new Error("connect ECONNREFUSED");
      },
      async rename() {
        throw new Error("unused");
      },
      async create() {
        throw new Error("unused");
      },
    };
    expect(await deleteWalletCategories(ctx, ["w1"], { writer: wallet })).toEqual({
      state: "failed",
      reason: "connect ECONNREFUSED",
    });
  });

  it("is a no-op when there is no Wallet connection at all", async () => {
    connections = [];
    expect(await deleteWalletCategories(ctx, ["w1"])).toEqual({ state: "not_linked" });
  });

  it("says so rather than calling Wallet when the stored token is empty", async () => {
    connections = [{ id: "c1", provider: "wallet" }];
    token = "";
    expect(await deleteWalletCategories(ctx, ["w1"])).toEqual({
      state: "failed",
      reason: "invalid_credentials",
    });
  });
});

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyProviderAccounts, saveBalanceEntry } from "@/modules/accounts/service";
import { listAccounts } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { createCategory } from "@/modules/transactions/taxonomy";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { linkExternal, resolveExternal } from "@/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { markPosted, postEntry, postPending, type PostingClient, retryPosting } from "./posting";
import { ruleDetail } from "./queries";
import { CATEGORY_NOT_LINKED } from "./rules";
import { interestEntries } from "./schema";
import { createRule, type RuleInput } from "./service";

let ctx: Ctx;
let entryId: string;

/** A fake Wallet: what it holds, and every POST it received. */
function fakeWallet(
  options: { existing?: { id: string; amountCents: bigint }[]; fail?: Error; noId?: boolean } = {},
) {
  const posts: {
    accountId: string;
    amountCents: bigint;
    on: string;
    note: string;
    categoryId?: string | null;
  }[] = [];
  const client: PostingClient = {
    async recordsWithNote() {
      return (options.existing ?? []).map((record) => ({ ...record, note: "marker" }));
    },
    async createRecord(input) {
      posts.push(input);
      if (options.fail) throw options.fail;
      return { id: options.noId ? null : `wr-${posts.length}` };
    },
  };
  return { client, posts };
}

async function postingOf(id: string) {
  const [row] = await getDb()
    .select({ posting: interestEntries.posting, error: interestEntries.postingError })
    .from(interestEntries)
    .where(and(eq(interestEntries.id, id)));
  return row;
}

/** The fixture's rule again, on the same account and period, with a category to publish under. */
async function ruleWithCategory(categoryId: string | null): Promise<string> {
  const [account] = await listAccounts(ctx);
  const input: RuleInput = {
    accountId: account.id,
    taxRate: "0",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: "2026-02-01",
    validTo: "2026-02-28",
    mode: "post_to_provider",
    postingCategoryId: categoryId,
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  };
  const rule = await createRule(ctx, input);
  return (await ruleDetail(ctx, rule.id)).settlements[0].entry.id;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    {
      provider: WALLET_PROVIDER,
      providerAccountId: "wa-saving",
      name: "Revolut Saving",
      type: "savings",
      currency: "EUR",
    },
  ]);
  const [account] = await listAccounts(ctx);
  await saveBalanceEntry(ctx, account.id, { on: "2025-12-31", cents: 1_000_000n });
  const rule = await createRule(ctx, {
    accountId: account.id,
    taxRate: "0",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: "2026-01-01",
    validTo: "2026-01-31",
    mode: "post_to_provider",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });
  entryId = (await ruleDetail(ctx, rule.id)).settlements[0].entry.id;
});

afterAll(closeDatabase);

describe("publishing a settlement to Wallet (spec §7.6)", () => {
  it("posts the net on the settlement day, with the marker, and links the record", async () => {
    const wallet = fakeWallet();
    expect(await postEntry(ctx, entryId, { client: wallet.client })).toBe("posted");
    expect(wallet.posts).toEqual([
      expect.objectContaining({ accountId: "wa-saving", amountCents: 3_100n, on: "2026-02-01" }),
    ]);
    expect(wallet.posts[0].note).toContain(`ledgerly-interest:${entryId}`);
    const links = await resolveExternal(ctx, WALLET_PROVIDER, "interest_entry", ["wr-1"]);
    expect(links.get("wr-1")).toBe(entryId);
    // Posted is posted: a second pass sends nothing.
    expect(await postPending(ctx, wallet.client)).toBe(0);
    expect(wallet.posts).toHaveLength(1);
  });

  it("takes a record already carrying the marker instead of posting again", async () => {
    const wallet = fakeWallet({ existing: [{ id: "wr-old", amountCents: 3_100n }] });
    expect(await postEntry(ctx, entryId, { client: wallet.client })).toBe("posted");
    expect(wallet.posts).toHaveLength(0);
  });

  it("refuses a marked record with another amount, as unsure", async () => {
    const wallet = fakeWallet({ existing: [{ id: "wr-old", amountCents: 999n }] });
    expect(await postEntry(ctx, entryId, { client: wallet.client })).toBe("indeterminate");
    expect(wallet.posts).toHaveLength(0);
  });

  it("keeps a failed POST unsure, never repeats it by itself, and retries only when asked", async () => {
    const failing = fakeWallet({ fail: new Error("HTTP 503") });
    expect(await postEntry(ctx, entryId, { client: failing.client })).toBe("indeterminate");
    expect(await postingOf(entryId)).toMatchObject({ posting: "indeterminate", error: "HTTP 503" });
    expect(await postPending(ctx, failing.client)).toBe(0);
    expect(failing.posts).toHaveLength(1);

    const working = fakeWallet();
    expect(await retryPosting(ctx, entryId, working.client)).toBe("posted");
  });

  it("calls a success without an id unsure, and lets the person mark it posted", async () => {
    expect(await postEntry(ctx, entryId, { client: fakeWallet({ noId: true }).client })).toBe(
      "indeterminate",
    );
    await markPosted(ctx, entryId);
    expect((await postingOf(entryId)).posting).toBe("posted");
  });

  it("posts once when two runs start together", async () => {
    const wallet = fakeWallet();
    const outcomes = await Promise.all([
      postEntry(ctx, entryId, { client: wallet.client }),
      postEntry(ctx, entryId, { client: wallet.client }),
    ]);
    expect(wallet.posts).toHaveLength(1);
    expect(outcomes).toContain("posted");
  });

  it("gives the claim back when there is no Wallet connection to post with", async () => {
    expect(await postEntry(ctx, entryId)).toBe("none");
    expect(await postingOf(entryId)).toMatchObject({ posting: "none", error: "no_connection" });
  });

  it("files the record under the Wallet category the rule's category is linked to", async () => {
    const category = await createCategory(ctx, {
      name: "Interessi",
      parentId: null,
      type: "income",
      color: null,
    });
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: category.id,
      externalId: "wc-interest",
    });
    const withCategory = await ruleWithCategory(category.id);
    const wallet = fakeWallet();

    expect(await postEntry(ctx, withCategory, { client: wallet.client })).toBe("posted");
    expect(wallet.posts[0].categoryId).toBe("wc-interest");
    // Nothing to report: the settlement is posted, filed, and says nothing more.
    expect(await postingOf(withCategory)).toMatchObject({ posting: "posted", error: null });
  });

  it("posts all the same without a category when the rule's category is not linked, and says so", async () => {
    const category = await createCategory(ctx, {
      name: "Interessi",
      parentId: null,
      type: "income",
      color: null,
    });
    const withCategory = await ruleWithCategory(category.id);
    const wallet = fakeWallet();

    expect(await postEntry(ctx, withCategory, { client: wallet.client })).toBe("posted");
    expect(wallet.posts).toHaveLength(1);
    expect(wallet.posts[0].categoryId).toBeNull();
    // The money is in Wallet; the outcome of the settlement carries the one thing that is missing.
    expect(await postingOf(withCategory)).toMatchObject({
      posting: "posted",
      error: CATEGORY_NOT_LINKED,
    });
  });

  it("says nothing about a category for a rule that was never given one", async () => {
    const wallet = fakeWallet();
    expect(await postEntry(ctx, await ruleWithCategory(null), { client: wallet.client })).toBe("posted");
    expect(wallet.posts[0].categoryId).toBeNull();
  });

  it("never posts for another user", async () => {
    const other = await newContext();
    await expect(postEntry(other, entryId, { client: fakeWallet().client })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(markPosted(other, entryId)).rejects.toMatchObject({ code: "not_found" });
  });
});

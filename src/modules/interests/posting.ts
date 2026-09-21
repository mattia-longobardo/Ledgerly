import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import {
  externalIdsOf,
  linkExternal,
  listConnections,
  readCredentials,
} from "@/platform/integrations/service";
import { createWalletClient, type WalletClient } from "@/platform/integrations/wallet/client";
import { CATEGORY_NOT_LINKED, type PostingState, settlementNote } from "./rules";
import { interestAccruals, interestEntries, interestRules } from "./schema";
import { InterestError, tiersOf } from "./service";

/** The part of the Wallet client posting needs; a test hands in a fake. */
export type PostingClient = Pick<WalletClient, "recordsWithNote" | "createRecord">;

/** The marker a published settlement carries in its Wallet note: one per settlement. */
export function postingMarker(entryId: string): string {
  return `ledgerly-interest:${entryId}`;
}

const MAX_ERROR = 500;

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR);
}

async function walletClient(ctx: Pick<Ctx, "userId">): Promise<PostingClient | null> {
  const connection = (await listConnections(ctx)).find((one) => one.provider === WALLET_PROVIDER);
  if (!connection || connection.state === "revoked") return null;
  const { token } = await readCredentials(ctx, connection.id);
  return createWalletClient(token);
}

/**
 * Wallet's own id of the category a rule publishes under (spec §7.6, §9.1), from the `category`
 * links of `provider_links` — the same links the category sync files. `null` when the rule has no
 * category, or when the one it has has never been linked to a Wallet category: the settlement is
 * then published **without** a category and the entry says so ({@link CATEGORY_NOT_LINKED}).
 *
 * Deliberately not the owner's `interest.py` ladder, which reads `/categories` and matches on the
 * name: a name match would file the money under whatever category happens to be called that today.
 * The link is the fact; there is no fallback, and nothing here creates a category.
 */
async function providerCategoryId(
  ctx: Pick<Ctx, "userId">,
  categoryId: string | null,
): Promise<string | null> {
  if (categoryId === null) return null;
  const links = await externalIdsOf(ctx, WALLET_PROVIDER, "category", [categoryId]);
  return links.get(categoryId) ?? null;
}

async function setPosting(
  ctx: Pick<Ctx, "userId">,
  entryId: string,
  posting: PostingState,
  error: string | null,
): Promise<void> {
  await getDb()
    .update(interestEntries)
    .set({ posting, postingError: error, postedAt: posting === "posted" ? new Date() : null })
    .where(and(eq(interestEntries.id, entryId), userScoped(ctx).owns(interestEntries)));
}

/**
 * What the published record says about itself. The sentence is `settlementNote`'s; the rest is
 * fetching what it needs — the rule's tiers, and the balance of every day this settlement actually
 * accrued on. Reads only, outside any transaction (spec §4.3).
 */
async function noteFor(
  ctx: Pick<Ctx, "userId">,
  rule: typeof interestRules.$inferSelect,
  entry: typeof interestEntries.$inferSelect,
): Promise<string> {
  const tiers = (await tiersOf(ctx, [rule.id])).get(rule.id) ?? [];
  const days = await getDb()
    .select({ balanceCents: interestAccruals.balanceCents })
    .from(interestAccruals)
    .where(
      and(
        eq(interestAccruals.entryId, entry.id),
        userScoped(ctx).owns(interestAccruals),
        eq(interestAccruals.status, "accrued"),
      ),
    )
    .orderBy(asc(interestAccruals.on));
  return settlementNote({
    tiers,
    taxRate: rule.taxRate,
    basis: rule.dayBasis === "360" ? 360 : 365,
    balances: days.flatMap((day) => (day.balanceCents === null ? [] : [day.balanceCents])),
    grossCents: entry.grossCents,
  });
}

/**
 * Publishes one settlement to Wallet (spec §7.6, §9.1; plan F4 §3.4.6), with the defence against a
 * double posting:
 *
 * 1. **claim** it in the database first — `none` (or, on "Retry", `indeterminate`) to `claimed` in
 *    one conditional update, so two runs at once cannot both go on;
 * 2. **look** for a record already carrying its marker on that day — a crash after a POST leaves
 *    exactly that — and, if its amount is ours, take it as the posting;
 * 3. otherwise **post**, once;
 * 4. an answer is `posted`; a failure after the POST was sent is `indeterminate`, kept visible and
 *    never repeated by itself. A failure before anything was sent gives the claim back (`none`).
 *
 * No transaction is open while Wallet is called (spec §4.3).
 */
export async function postEntry(
  ctx: Pick<Ctx, "userId">,
  entryId: string,
  options: { client?: PostingClient; retry?: boolean } = {},
): Promise<PostingState> {
  const [row] = await getDb()
    .select({ entry: interestEntries, rule: interestRules })
    .from(interestEntries)
    .innerJoin(interestRules, eq(interestRules.id, interestEntries.ruleId))
    .where(and(eq(interestEntries.id, entryId), userScoped(ctx).owns(interestEntries)));
  if (!row) throw new InterestError("not_found");
  const { entry, rule } = row;
  if (rule.mode !== "post_to_provider" || entry.netCents <= 0n) return entry.posting;

  const from: PostingState[] = options.retry ? ["indeterminate"] : ["none"];
  const claimed = await getDb()
    .update(interestEntries)
    .set({ posting: "claimed", postingError: null })
    .where(
      and(
        eq(interestEntries.id, entryId),
        userScoped(ctx).owns(interestEntries),
        inArray(interestEntries.posting, from),
      ),
    )
    .returning({ id: interestEntries.id });
  if (claimed.length === 0) return entry.posting;

  let sent = false;
  try {
    const account = await getAccount(ctx, rule.accountId);
    const providerId = account?.providerAccountId ?? null;
    const client = options.client ?? (await walletClient(ctx));
    if (providerId === null || client === null) {
      await setPosting(ctx, entryId, "none", providerId === null ? "not_synced" : "no_connection");
      return "none";
    }
    // Resolved before the duplicate check so a settlement taken over from an existing record
    // reports the missing link too: the fact is about the rule, not about this one POST.
    const category = await providerCategoryId(ctx, rule.postingCategoryId);
    const uncategorised = rule.postingCategoryId !== null && category === null;
    const note = uncategorised ? CATEGORY_NOT_LINKED : null;
    const marker = postingMarker(entryId);
    const existing = await client.recordsWithNote({ accountId: providerId, on: entry.settleOn, marker });
    let recordId: string | null;
    if (existing.length > 0) {
      const same = existing.find((record) => record.amountCents === entry.netCents);
      if (!same) {
        await setPosting(
          ctx,
          entryId,
          "indeterminate",
          `A Wallet record carries ${marker} with another amount`,
        );
        return "indeterminate";
      }
      recordId = same.id;
    } else {
      sent = true;
      const created = await client.createRecord({
        accountId: providerId,
        amountCents: entry.netCents,
        on: entry.settleOn,
        note: `${marker} · ${await noteFor(ctx, rule, entry)}`,
        categoryId: category,
      });
      recordId = created.id;
      if (recordId === null) {
        await setPosting(ctx, entryId, "indeterminate", "Wallet answered without the new record's id");
        return "indeterminate";
      }
    }
    await getDb().transaction(async (tx) => {
      await tx
        .update(interestEntries)
        // `posted` with a note, not a failure: the money is in Wallet, only its filing is not.
        .set({ posting: "posted", postedAt: new Date(), postingError: note })
        .where(and(eq(interestEntries.id, entryId), userScoped(ctx).owns(interestEntries)));
      await linkExternal(
        ctx,
        {
          provider: WALLET_PROVIDER,
          entityType: "interest_entry",
          entityId: entryId,
          externalId: recordId as string,
        },
        new Date(),
        tx,
      );
    });
    return "posted";
  } catch (error) {
    console.error("[interests] posting failed", redactForLog(error));
    const state: PostingState = sent ? "indeterminate" : "none";
    await setPosting(ctx, entryId, state, describe(error));
    return state;
  }
}

/** "Retry" on an unsure settlement: the same steps, starting from `indeterminate`. */
export function retryPosting(ctx: Pick<Ctx, "userId">, entryId: string, client?: PostingClient) {
  return postEntry(ctx, entryId, { client, retry: true });
}

/** "Mark as posted": the person checked Wallet and the record is there. */
export async function markPosted(ctx: Pick<Ctx, "userId">, entryId: string): Promise<void> {
  const updated = await getDb()
    .update(interestEntries)
    .set({ posting: "posted", postedAt: new Date(), postingError: null })
    .where(
      and(
        eq(interestEntries.id, entryId),
        userScoped(ctx).owns(interestEntries),
        inArray(interestEntries.posting, ["indeterminate"]),
      ),
    )
    .returning({ id: interestEntries.id });
  if (updated.length === 0) throw new InterestError("not_found");
}

/** Every settlement of a publishing rule still to post: what the accrual job does after settling. */
export async function postPending(ctx: Pick<Ctx, "userId">, client?: PostingClient): Promise<number> {
  const pending = await getDb()
    .select({ id: interestEntries.id })
    .from(interestEntries)
    .innerJoin(interestRules, eq(interestRules.id, interestEntries.ruleId))
    .where(
      and(
        userScoped(ctx).owns(interestEntries),
        eq(interestEntries.posting, "none"),
        eq(interestRules.mode, "post_to_provider"),
      ),
    );
  let posted = 0;
  for (const entry of pending) {
    if ((await postEntry(ctx, entry.id, { client })) === "posted") posted += 1;
  }
  return posted;
}

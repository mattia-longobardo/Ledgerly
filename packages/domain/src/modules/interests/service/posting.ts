// Publishing a settlement on the source that writes (spec §7.6, §9.1; plan F4 §3.4.6), through the
// port `LedgerPosting` (audit INT-1): this file never names the provider, the application wires it.
import { and, asc, eq, inArray } from "drizzle-orm";
import { getAccount } from "../../accounts";
import { redactForLog } from "../../../platform/auth/logger";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { externalIdsOf, linkExternal } from "../../../platform/integrations/service";
import { type LedgerPosting, postingPort } from "../ports";
import { CATEGORY_NOT_LINKED, type PostingState, settlementNote } from "../rules";
import { interestAccruals, interestEntries, interestRules } from "../schema";
import { type InterestEntry, InterestError, type InterestRule, tiersOf } from "./records";

type Who = Pick<Ctx, "userId">;

/** The marker a published settlement carries in its note on the source: one per settlement. */
function postingMarker(entryId: string): string {
  return `ledgerly-interest:${entryId}`;
}

const MAX_ERROR = 500;

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR);
}

/**
 * The source's own id of the category a rule publishes under (spec §7.6, §9.1), from the `category`
 * links of `provider_links` — the same links the category sync files. `null` when the rule has no
 * category, or when the one it has has never been linked to one of the source: the settlement is
 * then published **without** a category and the entry says so ({@link CATEGORY_NOT_LINKED}).
 *
 * Deliberately not the owner's `interest.py` ladder, which reads `/categories` and matches on the
 * name: a name match would file the money under whatever category happens to be called that today.
 * The link is the fact; there is no fallback, and nothing here creates a category.
 */
async function providerCategoryId(ctx: Who, categoryId: string | null): Promise<string | null> {
  if (categoryId === null) return null;
  const links = await externalIdsOf(ctx, postingPort().provider, "category", [categoryId]);
  return links.get(categoryId) ?? null;
}

/** The note a posted settlement keeps when its category has no counterpart on the source. */
async function categoryNote(
  ctx: Who,
  rule: InterestRule,
): Promise<{ category: string | null; note: string | null }> {
  const category = await providerCategoryId(ctx, rule.postingCategoryId);
  return {
    category,
    note: rule.postingCategoryId !== null && category === null ? CATEGORY_NOT_LINKED : null,
  };
}

async function setPosting(
  ctx: Who,
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
async function noteFor(ctx: Who, rule: InterestRule, entry: InterestEntry): Promise<string> {
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

/** The settlement is on the source as `recordId`: mark it posted and remember the link, together. */
async function settlePosted(ctx: Who, entryId: string, recordId: string, note: string | null): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .update(interestEntries)
      // `posted` with a note, not a failure: the money is on the source, only its filing is not.
      .set({ posting: "posted", postedAt: new Date(), postingError: note })
      .where(and(eq(interestEntries.id, entryId), userScoped(ctx).owns(interestEntries)));
    await linkExternal(
      ctx,
      {
        provider: postingPort().provider,
        entityType: "interest_entry",
        entityId: entryId,
        externalId: recordId,
      },
      new Date(),
      tx,
    );
  });
}

/** A settlement with its rule, of this person and, when given, of `ruleId`. */
async function entryWithRule(ctx: Who, entryId: string, ruleId?: string) {
  const [row] = await getDb()
    .select({ entry: interestEntries, rule: interestRules })
    .from(interestEntries)
    .innerJoin(interestRules, eq(interestRules.id, interestEntries.ruleId))
    .where(
      and(
        eq(interestEntries.id, entryId),
        userScoped(ctx).owns(interestEntries),
        ruleId === undefined ? undefined : eq(interestEntries.ruleId, ruleId),
      ),
    );
  if (!row) throw new InterestError("not_found");
  return row;
}

/** Claims a settlement from `from` in one conditional update: false when another run has it. */
async function claim(ctx: Who, entryId: string, from: PostingState, postingError?: null): Promise<boolean> {
  const claimed = await getDb()
    .update(interestEntries)
    .set(postingError === undefined ? { posting: "claimed" } : { posting: "claimed", postingError })
    .where(
      and(
        eq(interestEntries.id, entryId),
        userScoped(ctx).owns(interestEntries),
        inArray(interestEntries.posting, [from]),
      ),
    )
    .returning({ id: interestEntries.id });
  return claimed.length > 0;
}

/** The record already carrying the settlement's marker: its id, `other` for another amount, or null. */
async function existingRecord(ledger: LedgerPosting, providerId: string, entry: InterestEntry) {
  const records = await ledger.recordsWithNote({
    accountId: providerId,
    on: entry.settleOn,
    marker: postingMarker(entry.id),
  });
  if (records.length === 0) return null;
  return records.find((record) => record.amountCents === entry.netCents)?.id ?? ("other" as const);
}

/** Steps 2-4 of {@link postEntry}, on a settlement already claimed. */
async function publishClaimed(
  ctx: Who,
  row: { rule: InterestRule; entry: InterestEntry },
  client: LedgerPosting | undefined,
): Promise<PostingState> {
  const { rule, entry } = row;
  let sent = false;
  try {
    const providerId = (await getAccount(ctx, rule.accountId))?.providerAccountId ?? null;
    const ledger = client ?? (await postingPort().ledgerOf(ctx));
    if (providerId === null || ledger === null) {
      await setPosting(ctx, entry.id, "none", providerId === null ? "not_synced" : "no_connection");
      return "none";
    }
    // Resolved before the duplicate check so a settlement taken over from an existing record
    // reports the missing link too: the fact is about the rule, not about this one POST.
    const { category, note } = await categoryNote(ctx, rule);
    let recordId = await existingRecord(ledger, providerId, entry);
    if (recordId === "other") {
      const reason = `A record on the source carries ${postingMarker(entry.id)} with another amount`;
      await setPosting(ctx, entry.id, "indeterminate", reason);
      return "indeterminate";
    }
    if (recordId === null) {
      sent = true;
      const text = `${postingMarker(entry.id)} · ${await noteFor(ctx, rule, entry)}`;
      recordId = (
        await ledger.createRecord({
          accountId: providerId,
          amountCents: entry.netCents,
          on: entry.settleOn,
          note: text,
          categoryId: category,
        })
      ).id;
      if (recordId === null) {
        await setPosting(ctx, entry.id, "indeterminate", "The source answered without the new record's id");
        return "indeterminate";
      }
    }
    await settlePosted(ctx, entry.id, recordId, note);
    return "posted";
  } catch (error) {
    console.error("[interests] posting failed", redactForLog(error));
    const state: PostingState = sent ? "indeterminate" : "none";
    await setPosting(ctx, entry.id, state, describe(error));
    return state;
  }
}

/**
 * Publishes one settlement on the source (spec §7.6, §9.1; plan F4 §3.4.6), with the defence against
 * a double posting:
 *
 * 1. **claim** it in the database first — `none` (or, on "Retry", `indeterminate`) to `claimed` in
 *    one conditional update, so two runs at once cannot both go on;
 * 2. **look** for a record already carrying its marker on that day — a crash after a POST leaves
 *    exactly that — and, if its amount is ours, take it as the posting;
 * 3. otherwise **post**, once;
 * 4. an answer is `posted`; a failure after the POST was sent is `indeterminate`, kept visible and
 *    never repeated by itself. A failure before anything was sent gives the claim back (`none`).
 *
 * No transaction is open while the source is called (spec §4.3). With `ruleId`, only a settlement of
 * that rule.
 */
export async function postEntry(
  ctx: Who,
  entryId: string,
  options: { client?: LedgerPosting; retry?: boolean; ruleId?: string } = {},
): Promise<PostingState> {
  const row = await entryWithRule(ctx, entryId, options.ruleId);
  if (row.rule.mode !== "post_to_provider" || row.entry.netCents <= 0n) return row.entry.posting;
  if (!(await claim(ctx, entryId, options.retry ? "indeterminate" : "none", null))) return row.entry.posting;
  return publishClaimed(ctx, row, options.client);
}

/** One unsure settlement looked up on the source: true when its record is there, with our amount. */
async function lookUpOne(
  ctx: Who,
  ledger: LedgerPosting,
  row: { rule: InterestRule; entry: InterestEntry },
): Promise<boolean> {
  const { entry, rule } = row;
  if (!(await claim(ctx, entry.id, "indeterminate"))) return false;
  try {
    const providerId = (await getAccount(ctx, rule.accountId))?.providerAccountId ?? null;
    const recordId = providerId === null ? null : await existingRecord(ledger, providerId, entry);
    if (recordId === null || recordId === "other") {
      await setPosting(ctx, entry.id, "indeterminate", entry.postingError);
      return false;
    }
    await settlePosted(ctx, entry.id, recordId, (await categoryNote(ctx, rule)).note);
    return true;
  } catch (error) {
    console.error("[interests] looking up an unsure posting failed", redactForLog(error));
    await setPosting(ctx, entry.id, "indeterminate", entry.postingError);
    return false;
  }
}

/**
 * The daily second look at every unsure settlement: it **only looks** — never posts — for the
 * record carrying the settlement's marker on its day. One with the same amount makes the settlement
 * `posted`, exactly as "Retry" would have found it; anything else leaves it unsure, with its reason
 * untouched, for "Retry" or "Mark as posted". Claimed first like a posting, so a "Retry" pressed at
 * the same moment cannot run alongside it. Returns how many it found.
 */
export async function lookUpUnsure(ctx: Who, client?: LedgerPosting): Promise<number> {
  const unsure = await getDb()
    .select({ entry: interestEntries, rule: interestRules })
    .from(interestEntries)
    .innerJoin(interestRules, eq(interestRules.id, interestEntries.ruleId))
    .where(
      and(
        userScoped(ctx).owns(interestEntries),
        eq(interestEntries.posting, "indeterminate"),
        eq(interestRules.mode, "post_to_provider"),
      ),
    )
    .orderBy(asc(interestEntries.settleOn), asc(interestEntries.id));
  if (unsure.length === 0) return 0;
  const ledger = client ?? (await postingPort().ledgerOf(ctx));
  if (ledger === null) return 0;
  let found = 0;
  for (const row of unsure) {
    if (await lookUpOne(ctx, ledger, row)) found += 1;
  }
  return found;
}

/** "Mark as posted": the person checked the source and the record is there; one of `ruleId`'s. */
export async function markPosted(ctx: Who, ruleId: string, entryId: string): Promise<void> {
  const updated = await getDb()
    .update(interestEntries)
    .set({ posting: "posted", postedAt: new Date(), postingError: null })
    .where(
      and(
        eq(interestEntries.id, entryId),
        eq(interestEntries.ruleId, ruleId),
        userScoped(ctx).owns(interestEntries),
        inArray(interestEntries.posting, ["indeterminate"]),
      ),
    )
    .returning({ id: interestEntries.id });
  if (updated.length === 0) throw new InterestError("not_found");
}

/** Every settlement of a publishing rule still to post: what the accrual job does after settling. */
export async function postPending(ctx: Who, client?: LedgerPosting): Promise<number> {
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

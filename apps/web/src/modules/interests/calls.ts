// The calls of Interests to `/api/v1` (rewrite plan R3): each keeps the name and the answer of the
// Server Action it replaces, so the dialog and the posting cell read one shape. Thresholds and rates
// are read in the person's number format here, on the client, and go on the wire as decimal strings
// (`amountInput`, a plain percentage); the conversion of a percentage to the stored fraction is the
// domain's.
import { DAY_BASES, interests, SETTLEMENTS } from "@ledgerly/api-contract/interests";
import { pockets as pocketRoutes } from "@ledgerly/api-contract/pockets";
import { profile } from "@ledgerly/api-contract/settings";
import { call } from "@ledgerly/api-client";
import { numberStyle } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";
import { decimalOf, refusal } from "@/platform/writes";
import { readRate } from "./ui/present";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };
type PostingResult = { ok: true; state: string } | { ok: false; error: string };

/** The rule dialog, as typed. */
interface RuleFormInput {
  accountId: string;
  validFrom: string;
  validTo: string;
  /** The hour the rule accrues at, "0"–"23"; empty is the default hour. */
  runHour: string;
  tiers: { upTo: string; rate: string }[];
  tax: string;
  dayBasis: string;
  settlement: string;
  payeeMatch: string;
  /** The category the rule has, sent back as it is; empty is none. */
  categoryId: string;
  active: boolean;
}

/** What a write changes: the list, the rule's page, and the pockets that show the interest. */
function changed(): void {
  invalidate(
    interests.listInterestRules,
    interests.getInterestRule,
    pocketRoutes.listPockets,
    pocketRoutes.getPocket,
  );
}

async function bodyOf(input: RuleFormInput) {
  const style = numberStyle(await read(profile.getPreferences, {}));
  const rate = (typed: string) => readRate(typed, style);
  const last = input.tiers.length - 1;
  return {
    accountId: input.accountId,
    validFrom: input.validFrom,
    validTo: input.validTo === "" ? null : input.validTo,
    runHour: input.runHour === "" ? null : Number(input.runHour),
    tiers: await Promise.all(
      input.tiers.map(async (tier, index) => ({
        upTo: index === last ? null : await decimalOf(tier.upTo),
        rate: rate(tier.rate),
      })),
    ),
    tax: rate(input.tax === "" ? "0" : input.tax),
    // From the dialog's selects: always one of the lists.
    dayBasis: DAY_BASES.find((basis) => basis === input.dayBasis) ?? "365",
    settlement: SETTLEMENTS.find((settlement) => settlement === input.settlement) ?? "monthly",
    payeeMatch: input.payeeMatch,
    // No rule publishes on its source any more (decision H37): the route refuses that mode.
    mode: "analyze_only" as const,
    categoryId: input.categoryId === "" ? null : input.categoryId,
    state: input.active ? ("active" as const) : ("paused" as const),
  };
}

async function attempt<T extends { ok: true }>(
  work: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    const result = await work();
    changed();
    return result;
  } catch (error) {
    return refusal(error);
  }
}

export function createRuleAction(input: RuleFormInput): Promise<ActionResult> {
  return attempt(async () => {
    const { id } = await call(interests.createInterestRule, { body: await bodyOf(input) });
    return { ok: true as const, id };
  });
}

export function updateRuleAction(id: string, input: RuleFormInput): Promise<ActionResult> {
  return attempt(async () => {
    await call(interests.updateInterestRule, { params: { id }, body: await bodyOf(input) });
    return { ok: true as const, id };
  });
}

export function setRuleStateAction(id: string, state: "active" | "paused"): Promise<ActionResult> {
  return attempt(async () => {
    await call(interests.setInterestRuleState, { params: { id }, body: { state } });
    return { ok: true as const, id };
  });
}

/** "Post now" (from not posted) or "Retry" (from unsure): the route publishes once. */
export function postEntryAction(ruleId: string, entryId: string, retry: boolean): Promise<PostingResult> {
  return attempt(async () => {
    const { posting } = await call(interests.postInterestSettlement, {
      params: { id: ruleId, entryId },
      body: { retry },
    });
    return { ok: true as const, state: posting };
  });
}

/** "Mark as posted": the person saw the record on the source. */
export function markPostedAction(ruleId: string, entryId: string): Promise<PostingResult> {
  return attempt(async () => {
    const { posting } = await call(interests.markInterestSettlementPosted, {
      params: { id: ruleId, entryId },
    });
    return { ok: true as const, state: posting };
  });
}

// src/modules/interests/actions.ts — the Interests Server Actions (spec §4.2): validate → service →
// revalidate. Rates and amounts arrive as typed text, in the user's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import { readRate } from "./ui/present";
import { markPosted, postEntry } from "@ledgerly/domain/interests";
import {
  createRule,
  DAY_BASES,
  InterestError,
  type PlainRule,
  ruleInputOf,
  setRuleState,
  SETTLEMENTS,
  updateRule,
} from "@ledgerly/domain/interests";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof InterestError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(id?: string): void {
  revalidatePath("/interests");
  if (id) revalidatePath(`/interests/${id}`);
  revalidatePath("/pockets");
}

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
  publish: boolean;
  /** The category a published settlement is filed under in Wallet; empty is none. */
  categoryId: string;
  active: boolean;
}

/** The dialog in plain decimal form: the person's separators read, the rest as the wire has it. */
function toInput(input: RuleFormInput, ctx: Ctx) {
  const plain: PlainRule = {
    accountId: input.accountId,
    validFrom: input.validFrom,
    validTo: input.validTo === "" ? null : input.validTo,
    runHour: input.runHour === "" ? null : z.coerce.number().int().min(0).max(23).parse(input.runHour),
    tiers: input.tiers.map((tier, index) => ({
      upTo:
        index === input.tiers.length - 1 ? null : centsToDecimal(parseAmount(tier.upTo, ctx.numberFormat)),
      rate: readRate(tier.rate, ctx.numberFormat),
    })),
    tax: readRate(input.tax === "" ? "0" : input.tax, ctx.numberFormat),
    dayBasis: z.enum(DAY_BASES).parse(input.dayBasis),
    settlement: z.enum(SETTLEMENTS).parse(input.settlement),
    payeeMatch: input.payeeMatch,
    mode: input.publish ? "post_to_provider" : "analyze_only",
    categoryId: input.categoryId === "" ? null : z.uuid().parse(input.categoryId),
    state: input.active ? "active" : "paused",
  };
  return ruleInputOf(plain);
}

export async function createRuleAction(input: RuleFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const rule = await createRule(ctx, toInput(input, ctx));
    revalidate(rule.id);
    return { ok: true, id: rule.id };
  } catch (error) {
    return failed(error);
  }
}

export async function updateRuleAction(id: string, input: RuleFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateRule(ctx, id, toInput(input, ctx));
    revalidate(id);
    return { ok: true, id };
  } catch (error) {
    return failed(error);
  }
}

export async function setRuleStateAction(id: string, state: "active" | "paused"): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setRuleState(ctx, id, z.enum(["active", "paused"]).parse(state));
    revalidate(id);
    return { ok: true, id };
  } catch (error) {
    return failed(error);
  }
}

type PostingResult = { ok: true; state: string } | { ok: false; error: string };

/** "Post now" (from not posted) or "Retry" (from unsure): the protocol of `postEntry`. */
export async function postEntryAction(
  ruleId: string,
  entryId: string,
  retry: boolean,
): Promise<PostingResult> {
  const ctx = await requireSession();
  try {
    const state = await postEntry(ctx, entryId, { retry, ruleId });
    revalidate(ruleId);
    return { ok: true, state };
  } catch (error) {
    return failed(error);
  }
}

/** "Mark as posted": the person saw the record in Wallet. */
export async function markPostedAction(ruleId: string, entryId: string): Promise<PostingResult> {
  const ctx = await requireSession();
  try {
    await markPosted(ctx, ruleId, entryId);
    revalidate(ruleId);
    return { ok: true, state: "posted" };
  } catch (error) {
    return failed(error);
  }
}

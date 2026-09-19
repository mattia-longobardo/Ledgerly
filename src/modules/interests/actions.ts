// src/modules/interests/actions.ts — the Interests Server Actions (spec §4.2): validate → service →
// revalidate. Rates and amounts arrive as typed text, in the user's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { percentToFraction } from "./rules";
import { markPosted, postEntry, retryPosting } from "./posting";
import { createRule, InterestError, setRuleState, updateRule } from "./service";

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

/** A typed percentage ("2,75" in Italian, "2.75" in English) as the stored fraction. */
function rate(text: string, ctx: Ctx): string {
  const cleaned = text.replace(/[\s %]/g, "");
  const plain =
    ctx.numberFormat === "en-US"
      ? cleaned.replaceAll(",", "")
      : cleaned.replaceAll(".", "").replace(",", ".");
  return percentToFraction(plain);
}

export interface RuleFormInput {
  accountId: string;
  validFrom: string;
  validTo: string;
  tiers: { upTo: string; rate: string }[];
  tax: string;
  dayBasis: string;
  settlement: string;
  payeeMatch: string;
  publish: boolean;
  active: boolean;
}

function toInput(input: RuleFormInput, ctx: Ctx) {
  return {
    accountId: input.accountId,
    validFrom: input.validFrom,
    validTo: input.validTo === "" ? null : input.validTo,
    tiers: input.tiers.map((tier, index) => ({
      upToCents: index === input.tiers.length - 1 ? null : parseAmount(tier.upTo, ctx.numberFormat),
      annualRate: rate(tier.rate, ctx),
    })),
    taxRate: rate(input.tax === "" ? "0" : input.tax, ctx),
    dayBasis: z.enum(["365", "360"]).parse(input.dayBasis),
    settlement: z.enum(["daily", "monthly", "quarterly", "annual"]).parse(input.settlement),
    payeeMatch: input.payeeMatch,
    mode: input.publish ? ("post_to_provider" as const) : ("analyze_only" as const),
    state: input.active ? ("active" as const) : ("paused" as const),
  };
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

export type PostingResult = { ok: true; state: string } | { ok: false; error: string };

/** "Post now" (from not posted) or "Retry" (from unsure): the protocol of `postEntry`. */
export async function postEntryAction(
  ruleId: string,
  entryId: string,
  retry: boolean,
): Promise<PostingResult> {
  const ctx = await requireSession();
  try {
    const state = retry ? await retryPosting(ctx, entryId) : await postEntry(ctx, entryId);
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
    await markPosted(ctx, entryId);
    revalidate(ruleId);
    return { ok: true, state: "posted" };
  } catch (error) {
    return failed(error);
  }
}

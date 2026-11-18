// modules/transactions/categorize/user-rules-actions.ts — the Server Actions of the rules
// (categories-and-rules.md §4): validate → service → revalidate. A page gets numbers and texts
// already formatted, never a movement's other columns.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@ledgerly/domain/platform/dates";
import { formatDate, formatMoney } from "@ledgerly/domain/platform/format";
import { TransactionError } from "@ledgerly/domain/transactions";
import {
  applyRule,
  createRule,
  deleteRule,
  previewRule,
  previewSavedRule,
  type RulePreview,
  reorderRules,
  restoreRule,
  setRuleActive,
  undoRuleApply,
  updateRule,
} from "@ledgerly/domain/transactions";

type Session = Awaited<ReturnType<typeof requireSession>>;
export type RuleResult = { ok: true } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof TransactionError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/settings/rules");
  revalidatePath("/expenses", "layout");
  revalidatePath("/budgets");
  revalidatePath("/");
}

const idSchema = z.uuid();

/** A preview as the editor and the dialog "Apply" draw it. */
export interface PreviewView {
  matched: number;
  kept: number;
  changes: number;
  rows: { id: string; date: string; payee: string; amount: string }[];
  /** Set when some movements join or leave Transfers (§3.5). */
  retyped: { count: number; amount: string; year: number; from: "income" | "expense" | null } | null;
  /** The rule's category, for a saved rule. */
  categoryId?: string;
}

function previewView(ctx: Session, preview: RulePreview): PreviewView {
  return {
    matched: preview.matched,
    kept: preview.kept,
    changes: preview.changes,
    rows: preview.rows.map((row) => ({
      id: row.id,
      date: formatDate(civilDateIn(row.on, ctx.timeZone), "long", ctx.locale),
      payee: row.payee ?? "",
      amount: formatMoney(row.amountCents, ctx.numberFormat),
    })),
    retyped:
      preview.retyped.count === 0 || preview.retyped.since === null
        ? null
        : {
            count: preview.retyped.count,
            amount: formatMoney(preview.retyped.sumCents, ctx.numberFormat),
            year: Number(civilDateIn(preview.retyped.since, ctx.timeZone).slice(0, 4)),
            from: preview.retyped.fromType,
          },
  };
}

/** The live preview of the editor: `null` for a rule that is not valid yet. */
export async function previewRuleAction(input: unknown, ruleId: string | null): Promise<PreviewView | null> {
  const ctx = await requireSession();
  try {
    return previewView(ctx, await previewRule(ctx, input, ruleId === null ? null : idSchema.parse(ruleId)));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof TransactionError) return null;
    throw error;
  }
}

/** The dialog "Apply to existing transactions": what it would change. */
export async function previewSavedRuleAction(id: string): Promise<PreviewView | null> {
  const ctx = await requireSession();
  try {
    const preview = await previewSavedRule(ctx, idSchema.parse(id));
    return { ...previewView(ctx, preview), categoryId: preview.rule.categoryId };
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof TransactionError) return null;
    throw error;
  }
}

/** "Save": a new rule or a change; answers how many movements already here it would change. */
export async function saveRuleAction(
  id: string | null,
  input: unknown,
): Promise<{ ok: true; id: string; changes: number } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const rule =
      id === null ? await createRule(ctx, input) : await updateRule(ctx, idSchema.parse(id), input);
    revalidate();
    return { ok: true, id: rule.id, changes: (await previewSavedRule(ctx, rule.id)).changes };
  } catch (error) {
    return failed(error);
  }
}

export async function setRuleActiveAction(id: string, active: boolean): Promise<RuleResult> {
  const ctx = await requireSession();
  try {
    await setRuleActive(ctx, idSchema.parse(id), z.boolean().parse(active));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** "Delete" and its "Undo". */
export async function deleteRuleAction(id: string, deleted: boolean): Promise<RuleResult> {
  const ctx = await requireSession();
  try {
    if (z.boolean().parse(deleted)) await deleteRule(ctx, idSchema.parse(id));
    else await restoreRule(ctx, idSchema.parse(id));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function reorderRulesAction(ids: string[]): Promise<RuleResult> {
  const ctx = await requireSession();
  try {
    await reorderRules(ctx, z.array(idSchema).max(500).parse(ids));
    revalidatePath("/settings/rules");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** "Apply" (§4.6): all or nothing, with its "Undo". */
export async function applyRuleAction(
  id: string,
): Promise<{ ok: true; count: number; undoId: string | null } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const done = await applyRule(ctx, idSchema.parse(id));
    revalidate();
    return { ok: true, ...done };
  } catch (error) {
    return failed(error);
  }
}

export async function undoRuleApplyAction(undoId: string): Promise<RuleResult> {
  const ctx = await requireSession();
  try {
    await undoRuleApply(ctx, idSchema.parse(undoId));
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

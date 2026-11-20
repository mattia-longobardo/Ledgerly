// The calls of Settings › Rules to `/api/v1` (rewrite plan R3): each keeps the name and the answer of
// the Server Action of `categorize/user-rules-actions.ts` it replaces, so the board reads one shape.
// A preview comes back formatted in the person's own format, as the action gave it.
import { categories, categoryBoard, profile } from "@ledgerly/api-contract/settings";
import { movements, review, rules, spending } from "@ledgerly/api-contract/transactions";
import { ApiError, call, type RouteInput, type RouteOutput } from "@ledgerly/api-client";
import { centsToDecimal, parseCents } from "@ledgerly/format/cents";
import {
  formatDate,
  formatMoney,
  type NumberFormat,
  numberStyle,
  parseAmount,
} from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";

/** A rule as the editor sends it: its amounts are decimal strings. */
export type RuleInput = RouteInput<typeof rules.createRule>["body"];
/** A condition as the server answers it. */
export type RuleCondition = RouteOutput<typeof rules.listRules>["rules"][number]["conditions"][number];

type RuleResult = { ok: true } | { ok: false; error: string };
type Preview = RouteOutput<typeof rules.previewRule>;

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

/** An amount typed in the person's format as the decimal of the contract; null when it is not one. */
export function ruleAmount(text: string, format: NumberFormat): string | null {
  try {
    const cents = parseAmount(text, format);
    return cents < 0n ? null : centsToDecimal(cents);
  } catch {
    return null;
  }
}

/** The use case's code: the route names it as the refusal's reason, or as the refusal itself. */
const codeOf = (error: unknown): string | null =>
  error instanceof ApiError && error.status < 500 ? (error.reason ?? error.code) : null;

function failed(error: unknown): { ok: false; error: string } {
  const code = codeOf(error);
  if (code === null) throw error;
  return { ok: false, error: code };
}

/** What a rule's write changes: the rules, and the movements and totals it may recategorize. */
function changed(): void {
  invalidate(
    rules.listRules,
    movements.getTransactionsView,
    movements.listTransactions,
    movements.getTransaction,
    spending.getSpending,
    review.getReview,
    categories.listCategories,
    categoryBoard.getCategoriesBoard,
  );
}

async function writing(work: () => Promise<unknown>, after = changed): Promise<RuleResult> {
  try {
    await work();
  } catch (error) {
    return failed(error);
  }
  after();
  return { ok: true };
}

async function previewView(preview: Preview): Promise<PreviewView> {
  const prefs = await read(profile.getPreferences, {});
  const format = numberStyle(prefs);
  return {
    matched: preview.matched,
    kept: preview.kept,
    changes: preview.changes,
    rows: preview.rows.map((row) => ({
      id: row.id,
      date: formatDate(row.on, "long", prefs.locale),
      payee: row.payee ?? "",
      amount: formatMoney(parseCents(row.amount), format),
    })),
    retyped:
      preview.retyped === null
        ? null
        : {
            count: preview.retyped.count,
            amount: formatMoney(parseCents(preview.retyped.amount), format),
            year: Number(preview.retyped.since.slice(0, 4)),
            from: preview.retyped.from,
          },
  };
}

/** A refusal is "no preview"; anything else is thrown. */
async function previewing<T extends Preview>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (codeOf(error) !== null) return null;
    throw error;
  }
}

/** The live preview of the editor: `null` for a rule that is not valid yet. */
export async function previewRuleAction(
  input: RuleInput,
  ruleId: string | null,
): Promise<PreviewView | null> {
  const preview = await previewing(() => call(rules.previewRule, { body: { rule: input, ruleId } }));
  return preview === null ? null : previewView(preview);
}

/** The dialog "Apply to existing transactions": what it would change. */
export async function previewSavedRuleAction(id: string): Promise<PreviewView | null> {
  const preview = await previewing(() => call(rules.previewSavedRule, { params: { id } }));
  return preview === null ? null : { ...(await previewView(preview)), categoryId: preview.categoryId };
}

/** "Save": a new rule or a change; answers how many movements already here it would change. */
export async function saveRuleAction(
  id: string | null,
  input: RuleInput,
): Promise<{ ok: true; id: string; changes: number } | { ok: false; error: string }> {
  try {
    const saved =
      id === null
        ? await call(rules.createRule, { body: input })
        : await call(rules.updateRule, { params: { id }, body: input });
    changed();
    return { ok: true, ...saved };
  } catch (error) {
    return failed(error);
  }
}

export function setRuleActiveAction(id: string, active: boolean): Promise<RuleResult> {
  return writing(() => call(rules.setRuleActive, { params: { id }, body: { active } }));
}

/** "Delete" and its "Undo". */
export function deleteRuleAction(id: string, deleted: boolean): Promise<RuleResult> {
  return writing(() =>
    deleted ? call(rules.deleteRule, { params: { id } }) : call(rules.restoreRule, { params: { id } }),
  );
}

/** The order changes only the rules. */
export function reorderRulesAction(ids: string[]): Promise<RuleResult> {
  return writing(
    () => call(rules.reorderRules, { body: { ids } }),
    () => invalidate(rules.listRules),
  );
}

/** "Apply" (§4.6): all or nothing, with its "Undo". */
export async function applyRuleAction(
  id: string,
): Promise<{ ok: true; count: number; undoId: string | null } | { ok: false; error: string }> {
  try {
    const done = await call(rules.applyRule, { params: { id } });
    changed();
    return { ok: true, ...done };
  } catch (error) {
    return failed(error);
  }
}

export function undoRuleApplyAction(undoId: string): Promise<RuleResult> {
  return writing(() => call(rules.undoRuleApply, { params: { undoId } }));
}

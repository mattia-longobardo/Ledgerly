// The editor of a rule filled before a person writes it (categories-and-rules.md §4.7, §5.4): from a
// movement, or with a category chosen. One rule for the page and for `GET /rules/draft`.
import type { Ctx } from "../../../../platform/context";
import { getTransaction } from "../../queries";
import { memoryKey } from "../text";
import type { RuleCondition } from "../user-rules";

interface RuleDraft {
  name: string;
  conditions: RuleCondition[];
  /** The category asked, else the movement's: the caller drops one that cannot be chosen. */
  categoryId: string | null;
}

/** From a movement (`from`), else with a category; `null` when neither gives a draft. */
export async function ruleDraft(
  ctx: Pick<Ctx, "userId">,
  wanted: { from: string | null; category: string | null },
): Promise<RuleDraft | null> {
  if (wanted.from !== null) {
    const movement = await getTransaction(ctx, wanted.from);
    if (movement === null) return null;
    const text = memoryKey({ ...movement, counterparty: movement.counterpartyName });
    const conditions: RuleCondition[] = [];
    if (movement.counterpartyName) {
      conditions.push({
        field: "counterparty",
        op: "equals",
        value: movement.counterpartyName.slice(0, 100),
      });
    } else if (text !== "") {
      conditions.push({ field: "text", op: "contains", value: text.slice(0, 100) });
    }
    conditions.push({ field: "account", accountIds: [movement.accountId] });
    return {
      name: (movement.counterpartyName ?? movement.payee ?? text).slice(0, 80),
      conditions,
      categoryId: wanted.category ?? movement.categoryId,
    };
  }
  if (wanted.category === null) return null;
  return {
    name: "",
    conditions: [{ field: "text", op: "contains", value: "" }],
    categoryId: wanted.category,
  };
}

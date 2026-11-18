// modules/transactions/ui/macros.ts — the page of the categories as data (categories-and-rules.md
// §2, §5.2, §5.3): the three macros, their groups and categories, with the totals of a period.
// Pure, on the server: the page reads the categories and the totals, this decides where each
// amount is drawn.
import { type CategoryMacroTotal, shareOf } from "../queries";
import { type CategoryType, CATEGORY_TYPES } from "../rules";

/** Income, Expenses, Transfers: the type of a category, always in this order (CR1). */
export const MACROS = CATEGORY_TYPES;
export type Macro = CategoryType;

/** A category as the page needs it: `parentId` null is a group (or, under Transfers, a category). */
export interface MacroCategory {
  id: string;
  name: string;
  parentId: string | null;
  type: CategoryType;
  archived: boolean;
}

export interface Amount {
  count: number;
  totalCents: bigint;
  inCents: bigint;
  outCents: bigint;
}

export interface CategoryLine extends Amount {
  category: MacroCategory;
  /** Percentage of the macro, one decimal: `0` under Transfers, which has no whole (§5.2). */
  share: number;
}

export interface GroupLine extends CategoryLine {
  /** The movements filed on the group itself: the line "Only “{group}”". `null` when none. */
  only: Amount | null;
  children: CategoryLine[];
}

export interface MacroView extends Amount {
  macro: Macro;
  /** Under Transfers each line is a category with no children (CR2). */
  groups: GroupLine[];
  /** Income and Expenses: "To categorise". Transfers: "Between your accounts". `null` when none. */
  rest: Amount | null;
}

const ZERO: Amount = { count: 0, totalCents: 0n, inCents: 0n, outCents: 0n };

function add(a: Amount, b: Amount): Amount {
  return {
    count: a.count + b.count,
    totalCents: a.totalCents + b.totalCents,
    inCents: a.inCents + b.inCents,
    outCents: a.outCents + b.outCents,
  };
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/** Biggest first; at a tie, by name (§5.2): a line at zero falls to the end of its list. */
function byTotal(a: CategoryLine, b: CategoryLine): number {
  const size = abs(b.totalCents) - abs(a.totalCents);
  if (size !== 0n) return size > 0n ? 1 : -1;
  return a.category.name.localeCompare(b.category.name) || a.category.id.localeCompare(b.category.id);
}

/**
 * The three macros of a period. A movement counts in the macro of its own type (§5.3), so the total
 * of each macro is always the header of Expenses for the same days and accounts. From N3.3 the type
 * follows the category's macro (`macro.ts`); a movement whose sign leaves it in another macro (a
 * refund under a category of Expenses) shows its category in the macro of its type too.
 */
export function macroViews(
  categories: readonly MacroCategory[],
  totals: readonly CategoryMacroTotal[],
): MacroView[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const childrenOf = new Map<string, MacroCategory[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    childrenOf.set(category.parentId, [...(childrenOf.get(category.parentId) ?? []), category]);
  }

  return MACROS.map((macro) => {
    const own = new Map<string | null, Amount>();
    for (const row of totals) {
      if (row.type !== macro) continue;
      own.set(row.categoryId, add(own.get(row.categoryId) ?? ZERO, row));
    }
    const amountOf = (id: string): Amount => own.get(id) ?? ZERO;
    const whole = [...own.values()].reduce(add, ZERO);
    const line = (category: MacroCategory, amount: Amount): CategoryLine => ({
      category,
      ...amount,
      share: macro === "transfer" ? 0 : shareOf(amount.totalCents, whole.totalCents),
    });
    const counts = (id: string) => own.has(id);

    let groups: GroupLine[];
    if (macro === "transfer") {
      // A flat list (CR2): every category of the macro, a group of it with its children too, and any
      // other category that has transfers in the period.
      groups = categories
        .filter((category) => category.type === "transfer" || counts(category.id))
        .map((category) => ({ ...line(category, amountOf(category.id)), only: null, children: [] }));
    } else {
      groups = categories
        .filter((category) => category.parentId === null || !byId.has(category.parentId))
        .filter(
          (group) =>
            group.type === macro ||
            counts(group.id) ||
            (childrenOf.get(group.id) ?? []).some((child) => counts(child.id)),
        )
        .map((group) => {
          const children = (childrenOf.get(group.id) ?? [])
            .filter((child) => child.type === macro || counts(child.id))
            .map((child) => line(child, amountOf(child.id)))
            .sort(byTotal);
          const only = counts(group.id) ? amountOf(group.id) : null;
          const amount = children.reduce<Amount>((sum, child) => add(sum, child), only ?? ZERO);
          return { ...line(group, amount), only, children };
        });
    }
    groups.sort(byTotal);
    const rest = own.get(null) ?? null;
    return { macro, ...whole, groups, rest };
  });
}

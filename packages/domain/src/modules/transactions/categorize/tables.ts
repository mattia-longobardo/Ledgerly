/**
 * The static tables of the automatic categories (rewrite plan, 04-now.md §4.4, "Tabelle statiche"):
 * merchant type → group, brand → group, bank code → structure. Data files in the image, the same
 * for everybody; the rules that read them name no shop and no bank. A table points at one of the
 * default groups (`groups.json`), never at a person's category: the cascade is handed the
 * person's category for each group.
 */
import brands from "./tables/brands.json";
import groups from "./tables/groups.json";
import merchantTypes from "./tables/merchant-types.json";
import structure from "./tables/structure.json";
import { normalise } from "./text";

export type GroupKey = string;

/** One of the default groups a new person starts from (decision K4; ux/n3-categories-manual.md §7.2). */
interface DefaultGroup {
  key: GroupKey;
  /** QC7 (categories-and-rules.md): two groups of Income, and two categories of Transfers. */
  type: "expense" | "income" | "transfer";
  en: string;
  it: string;
  examples: { en: string; it: string };
}

export const DEFAULT_GROUPS: readonly DefaultGroup[] = groups as DefaultGroup[];

/** What a table says about a movement: the group, and whether the entry stands for one thing only. */
interface TableAnswer {
  group: GroupKey;
  ambiguous: boolean;
}

interface MerchantType {
  from: number;
  to: number;
  group: string;
  ambiguous?: boolean;
}

/** The group of a merchant category code; of two ranges that hold it, the narrower one answers. */
export function merchantTypeGroup(code: string | null): TableAnswer | null {
  const number = code !== null && /^\d{4}$/.test(code.trim()) ? Number(code.trim()) : null;
  if (number === null) return null;
  const holding = (merchantTypes as MerchantType[])
    .filter((entry) => number >= entry.from && number <= entry.to)
    .sort((a, b) => a.to - a.from - (b.to - b.from));
  const entry = holding[0];
  return entry ? { group: entry.group, ambiguous: entry.ambiguous === true } : null;
}

interface Brand {
  brand: string;
  match: string[];
  group: string;
  ambiguous?: boolean;
}

/**
 * The brand a text names, matched on whole words of the normalised text: "coop" is in "coop
 * lombardia" and not in "cooperativa". The longest match wins.
 */
export function brandGroup(text: string): (TableAnswer & { brand: string }) | null {
  const padded = ` ${normalise(text)
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  let best: { entry: Brand; length: number } | null = null;
  for (const entry of brands as Brand[]) {
    for (const match of entry.match) {
      if (padded.includes(` ${match} `) && (best === null || match.length > best.length)) {
        best = { entry, length: match.length };
      }
    }
  }
  return best
    ? { brand: best.entry.brand, group: best.entry.group, ambiguous: best.entry.ambiguous === true }
    : null;
}

/** What the bank's own code says the movement is, when it says it: a salary, or a fee. */
type Structure = "salary" | "fee";

/** The group each structure belongs to. */
export const STRUCTURE_GROUP: Record<Structure, GroupKey> = { salary: "income", fee: "taxes_fees" };

export function structureOf(bankCode: string | null): Structure | null {
  if (bankCode === null) return null;
  const words = new Set(normalise(bankCode).split(" "));
  for (const kind of ["salary", "fee"] as const) {
    if ((structure as Record<Structure, string[]>)[kind].some((word) => words.has(word))) return kind;
  }
  return null;
}

// The answer of `GET /categories/board` as the board draws it: every figure is a field of the route,
// formatted in the person's number format, and every link keeps the period and the accounts of
// Expenses (categories-and-rules.md §5.2). Nothing is summed here.
import type { categoryBoard } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, formatPercent, type NumberFormat } from "@ledgerly/format/format";
import { withParams } from "@ledgerly/ui/url";
import { sourcePageOf } from "@/modules/transactions/client";
import type { BoardLine, BoardMacro } from "./board-model";

type Board = RouteOutput<typeof categoryBoard.getCategoriesBoard>;
type Macro = Board["macros"][number];
type Line = Macro["groups"][number]["children"][number];

/** What the mapping needs from the screen: the format, the links' parameters and two sentences. */
interface BoardFormat {
  numberFormat: NumberFormat;
  /** The period and the accounts, as Expenses writes them. */
  carry: Record<string, string | undefined>;
  range: { from: string; to: string };
  accounts: readonly string[];
  sourceText: (source: { name: string; names: string[] }) => string;
}

const HERE = "/expenses/categories";

function lineOf(line: Line, format: BoardFormat): BoardLine {
  const money = (amount: string) => formatMoney(parseCents(amount), format.numberFormat);
  return {
    id: line.id,
    name: line.name,
    parentId: line.parentId,
    type: line.type,
    color: line.color,
    chosenColor: line.chosenColor,
    archived: line.archived,
    canMerge: line.canMerge,
    usage: line.usage,
    count: line.count,
    total: money(line.total),
    zero: line.count === 0,
    share: line.share,
    shareText: formatPercent(line.share / 100, format.numberFormat),
    inTotal: money(line.in),
    outTotal: money(line.out),
    href: withParams(`${HERE}/${line.id}`, format.carry, {}),
    budget: line.budget ? { limit: money(line.budget.limit), status: line.budget.status } : null,
    source:
      line.source && line.source.names.length > 0
        ? { text: format.sourceText(line.source), href: sourcePageOf(line.source.provider) }
        : null,
  };
}

/** «To categorize» opens «To review» on the period; under Transfers, the movements between accounts. */
function restHref(macro: Macro["macro"], format: BoardFormat): string {
  if (macro === "transfer") return withParams("/expenses", format.carry, { type: "transfer" });
  const accounts = format.accounts.length > 0 ? format.accounts.join(",") : undefined;
  return withParams("/expenses/review", {}, { ...format.range, acc: accounts });
}

export function boardOf(board: Board, format: BoardFormat): BoardMacro[] {
  const money = (amount: string) => formatMoney(parseCents(amount), format.numberFormat);
  return board.macros.map((view) => ({
    macro: view.macro,
    total: money(view.total),
    count: view.count,
    inTotal: money(view.in),
    outTotal: money(view.out),
    groups: view.groups.map((group) => ({
      ...lineOf(group, format),
      only: group.only
        ? {
            total: money(group.only.total),
            count: group.only.count,
            href: withParams("/expenses", format.carry, { cat: group.id }),
          }
        : null,
      children: group.children.map((child) => lineOf(child, format)),
    })),
    rest: view.rest
      ? {
          count: view.rest.count,
          total: money(view.rest.total),
          inTotal: money(view.rest.in),
          outTotal: money(view.rest.out),
          href: restHref(view.macro, format),
        }
      : null,
  }));
}

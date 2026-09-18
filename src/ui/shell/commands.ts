import type { Route } from "next";
import type { NavLink } from "./nav-types";

export function filterCommands(links: NavLink[], query: string): NavLink[] {
  const needle = query.trim().toLowerCase();
  return needle ? links.filter((link) => link.label.toLowerCase().includes(needle)) : links;
}

/** A payee the palette found, as the search hands it over (spec §7.2). */
export interface PayeeMatch {
  payee: string;
  count: number;
}

/**
 * One option in the palette's single listbox. Pages and payees share the cursor, so the arrow keys
 * walk from the last page into the first payee without the caller tracking two indices.
 */
export interface PaletteOption {
  id: string;
  label: string;
  hint: string;
  href: Route;
  group: "pages" | "payees";
}

/** Where a payee leads: the Expenses screen already reads its search from `q` (spec §7.2). */
export function payeeHref(payee: string): Route {
  return `/expenses?q=${encodeURIComponent(payee)}` as Route;
}

export function paletteOptions(
  pages: readonly NavLink[],
  payees: readonly PayeeMatch[],
  groupLabel: (link: NavLink) => string,
): PaletteOption[] {
  return [
    ...pages.map((link) => ({
      id: `page:${link.id}`,
      label: link.label,
      hint: groupLabel(link),
      href: link.href,
      group: "pages" as const,
    })),
    ...payees.map((match) => ({
      id: `payee:${match.payee}`,
      label: match.payee,
      hint: String(match.count),
      href: payeeHref(match.payee),
      group: "payees" as const,
    })),
  ];
}

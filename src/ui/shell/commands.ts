import type { NavLink } from "./nav-types";

export function filterCommands(links: NavLink[], query: string): NavLink[] {
  const needle = query.trim().toLowerCase();
  return needle ? links.filter((link) => link.label.toLowerCase().includes(needle)) : links;
}

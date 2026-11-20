// What the board of the categories draws (categories-and-rules.md §5.2): a macro, its groups and their
// categories with every amount already formatted, the dialog open on it, and the groups this browser
// keeps open.
import type { Route } from "next";
import { useMemo, useSyncExternalStore } from "react";
import type { CategoryType } from "@ledgerly/domain/transactions/client";

export type Macro = CategoryType;
export const MACROS: readonly Macro[] = ["income", "expense", "transfer"];

/** One category, or a group, as the board draws it: every amount already formatted. */
export interface BoardLine {
  id: string;
  name: string;
  parentId: string | null;
  type: CategoryType;
  color: string;
  chosenColor: string | null;
  archived: boolean;
  /** A category a source gives cannot be merged (`mergeCategories`). */
  canMerge: boolean;
  /** Its movements of all time: what archiving and deleting leave or take. */
  usage: number;
  count: number;
  total: string;
  zero: boolean;
  /** Of the macro, 0-100, for the bar; `shareText` is the same in the person's number format. */
  share: number;
  shareText: string;
  inTotal: string;
  outTotal: string;
  href: Route;
  budget: { limit: string; status: "on_track" | "near" | "over" } | null;
  source: { text: string; href: Route | null } | null;
}

export interface BoardGroup extends BoardLine {
  only: { total: string; count: number; href: Route } | null;
  children: BoardLine[];
}

export interface BoardMacro {
  macro: Macro;
  total: string;
  count: number;
  inTotal: string;
  outTotal: string;
  groups: BoardGroup[];
  rest: { count: number; total: string; inTotal: string; outTotal: string; href: Route } | null;
}

export type Dialog =
  | { kind: "group"; macro: "income" | "expense" }
  | { kind: "add"; group: BoardLine | null; macro: Macro }
  | { kind: "color"; line: BoardLine }
  | { kind: "move"; line: BoardLine }
  | { kind: "macro"; line: BoardLine; children: number }
  | { kind: "merge"; line: BoardLine; hasChildren: boolean }
  | { kind: "archive"; line: BoardLine; children: number }
  | { kind: "delete"; line: BoardLine; children: number };

const STORAGE_KEY = "ledgerly.categories.open";

/**
 * The groups this browser keeps open (§5.2): `localStorage`, read as an external store so the
 * server's page (all closed) and the browser's agree at hydration. Without storage the choice
 * lives in memory until the page is left.
 */
const listeners = new Set<() => void>();
let memory: string | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memory ?? "[]";
  } catch {
    return memory ?? "[]";
  }
}

function parseOpen(value: string): Set<string> {
  try {
    const list: unknown = JSON.parse(value);
    return new Set(Array.isArray(list) ? list.filter((one) => typeof one === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveOpen(open: Set<string>): void {
  memory = JSON.stringify([...open]);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // Kept in memory: every group opens closed next time.
  }
  for (const listener of listeners) listener();
}

/** The ids of the groups open in this browser. */
export function useOpenGroups(): Set<string> {
  const stored = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return useMemo(() => parseOpen(stored), [stored]);
}

/** Opens a closed group and closes an open one. */
export function toggleGroup(open: Set<string>, id: string): void {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  saveOpen(next);
}

/** Every line of the board once, the groups and their categories of all three macros. */
export function linesOf(macros: readonly BoardMacro[]): BoardLine[] {
  const all = macros.flatMap((one) => one.groups.flatMap((group) => [group, ...group.children]));
  return [...new Map(all.map((line) => [line.id, line])).values()];
}

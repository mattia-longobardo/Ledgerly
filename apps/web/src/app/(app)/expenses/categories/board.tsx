"use client";

import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { type CategoryType, NAME_MAX } from "@ledgerly/domain/transactions/client";
import { Badge } from "@ledgerly/ui/badge";
import { Button, ButtonLink, LinkButton } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Modal } from "@ledgerly/ui/modal";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Segmented } from "@ledgerly/ui/segmented";
import { notify } from "@ledgerly/ui/toast";
import {
  archiveWithUndoAction,
  createCategoryAction,
  mergeCategoriesAction,
  moveCategoryAction,
  restoreCategoriesAction,
  restoreCategoryAction,
  saveCategoryAction,
  undoMergeAction,
} from "../../settings/categories/actions";
import { ColorDot, ColorSwatchPicker } from "../../settings/categories/color-swatch";
import { DeleteCategoryDialog } from "../../settings/categories/delete-dialog";
import { MacroMoveDialog } from "./macro-dialog";

type Macro = CategoryType;
const MACROS: readonly Macro[] = ["income", "expense", "transfer"];

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

interface BoardGroup extends BoardLine {
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

const STORAGE_KEY = "ledgerly.categories.open";
const BUDGET_DOT = { on_track: "bg-pos", near: "bg-warn", over: "bg-neg" } as const;

type Dialog =
  | { kind: "group"; macro: "income" | "expense" }
  | { kind: "add"; group: BoardLine | null; macro: Macro }
  | { kind: "color"; line: BoardLine }
  | { kind: "move"; line: BoardLine }
  | { kind: "macro"; line: BoardLine; children: number }
  | { kind: "merge"; line: BoardLine; hasChildren: boolean }
  | { kind: "archive"; line: BoardLine; children: number }
  | { kind: "delete"; line: BoardLine; children: number };

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

function saveOpen(open: Set<string>): void {
  memory = JSON.stringify([...open]);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // Kept in memory: every group opens closed next time.
  }
  for (const listener of listeners) listener();
}

/**
 * The page of the categories (categories-and-rules.md §5.2, §5.5, §5.6): one macro at a time, its
 * groups closed by default, each with its categories, totals, shares and budget; the menu of each
 * row renames, recolours, moves, merges, archives and deletes. Moving, merging and archiving say
 * what they did in a toast with "Undo". The data comes formatted from the server.
 */
export function CategoriesBoard({
  macros,
  initialMacro,
  empty,
}: {
  macros: BoardMacro[];
  initialMacro: Macro;
  /** What the page says with no category at all, in place of the macros. */
  empty?: ReactNode;
}) {
  const t = useTranslations("expenses.categories");
  const ts = useTranslations("settings.categories");
  const [macro, setMacro] = useState<Macro>(initialMacro);
  const stored = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const open = useMemo(() => parseOpen(stored), [stored]);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const router = useRouter();

  const view = macros.find((one) => one.macro === macro) ?? macros[0];
  const macroName = (key: Macro) => t(`macro.${key}`);
  const all = macros.flatMap((one) => one.groups.flatMap((group) => [group, ...group.children]));
  const lines = [...new Map(all.map((line) => [line.id, line])).values()];
  const groupsOf = (type: CategoryType) =>
    lines.filter((line) => line.parentId === null && line.type === type && !line.archived);
  const childrenOf = (id: string) => lines.filter((line) => line.parentId === id);

  function choose(next: Macro) {
    setMacro(next);
    // The address keeps the macro, so a reload or a shared link opens on it.
    const url = new URL(window.location.href);
    if (next === "expense") url.searchParams.delete("macro");
    else url.searchParams.set("macro", next);
    window.history.replaceState(window.history.state, "", url);
  }

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveOpen(next);
  }

  function setAll(on: boolean) {
    const next = new Set(open);
    for (const group of view.groups) {
      if (on) next.add(group.id);
      else next.delete(group.id);
    }
    saveOpen(next);
  }

  function messageFor(code: string, name = "", where = ""): string {
    if (code === "duplicate") return t("errors.duplicate", { name, group: where });
    if (code === "invalid") return ts("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return ts("errors.notFound");
    if (code === "invalid_parent") return ts("errors.invalidParent");
    return ts("errors.failed");
  }

  function close() {
    setDialog(null);
    setError(null);
  }

  /** Name, group, type and colour as `updateCategory` wants them, with one of them changed. */
  function inputOf(line: BoardLine, changes: { name?: string; color?: string | null }) {
    return {
      name: changes.name ?? line.name,
      parentId: line.parentId ?? "",
      type: line.type,
      // A sub-category has no colour of its own: it is its group's.
      color: line.parentId === null ? (changes.color === undefined ? line.chosenColor : changes.color) : null,
    };
  }

  function rename(line: BoardLine, name: string) {
    const trimmed = name.trim();
    if (trimmed === line.name) {
      setRenaming(null);
      return;
    }
    startTransition(async () => {
      const result = await saveCategoryAction(line.id, inputOf(line, { name: trimmed }));
      if (!result.ok) {
        notify(messageFor(result.error, trimmed, whereOf(line)), "error");
        return;
      }
      setRenaming(null);
      notify(t("renamed", { name: trimmed }));
    });
  }

  function whereOf(line: { parentId: string | null; type: CategoryType }): string {
    const group = line.parentId === null ? undefined : lines.find((one) => one.id === line.parentId);
    return group?.name ?? macroName(line.type);
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || (dialog.kind !== "group" && dialog.kind !== "add")) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const color = String(data.get("color") ?? "") || null;
    const group = dialog.kind === "add" ? dialog.group : null;
    const type = dialog.macro;
    startTransition(async () => {
      const result = await createCategoryAction({
        name,
        parentId: group?.id ?? "",
        type,
        color: group ? null : color,
      });
      if (!result.ok) {
        setError(messageFor(result.error, name, group?.name ?? macroName(type)));
        return;
      }
      close();
      if (group && !open.has(group.id)) toggle(group.id);
      notify(ts("saved"));
    });
  }

  function onColor(line: BoardLine, color: string | null) {
    startTransition(async () => {
      const result = await saveCategoryAction(line.id, inputOf(line, { color }));
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      close();
      notify(ts("saved"));
    });
  }

  function onMove(line: BoardLine, parentId: string) {
    const target = lines.find((one) => one.id === parentId);
    startTransition(async () => {
      const result = await moveCategoryAction(line.id, parentId);
      if (!result.ok) {
        setError(messageFor(result.error, line.name, target?.name ?? ""));
        return;
      }
      close();
      const back = result.fromId;
      notify(t("move.done", { name: line.name, group: target?.name ?? "" }), "success", {
        label: t("undo"),
        onClick: () =>
          void moveCategoryAction(line.id, back).then((undone) =>
            notify(undone.ok ? t("undone") : messageFor(undone.error), undone.ok ? "success" : "error"),
          ),
      });
    });
  }

  function onMerge(line: BoardLine, keepId: string) {
    const keep = lines.find((one) => one.id === keepId);
    startTransition(async () => {
      const result = await mergeCategoriesAction(keepId, line.id);
      if (!result.ok) {
        setError(ts("errors.failed"));
        return;
      }
      close();
      notify(t("merge.done", { name: line.name, keep: keep?.name ?? "", count: result.moved }), "success", {
        label: t("undo"),
        onClick: () =>
          void undoMergeAction(result.undo).then((undone) =>
            notify(undone.ok ? t("undone") : ts("errors.failed"), undone.ok ? "success" : "error"),
          ),
      });
    });
  }

  function onArchive(line: BoardLine) {
    startTransition(async () => {
      const result = await archiveWithUndoAction(line.id);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      close();
      notify(t("archive.done", { name: line.name }), "success", {
        label: t("undo"),
        onClick: () =>
          void restoreCategoriesAction(result.ids).then((undone) =>
            notify(undone.ok ? t("undone") : messageFor(undone.error), undone.ok ? "success" : "error"),
          ),
      });
    });
  }

  function onRestore(line: BoardLine) {
    startTransition(async () => {
      const result = await restoreCategoryAction(line.id);
      notify(result.ok ? ts("restoredToast") : messageFor(result.error), result.ok ? "success" : "error");
    });
  }

  function menu(line: BoardLine, isGroup: boolean) {
    const children = isGroup ? childrenOf(line.id) : [];
    const items: { label: string; onSelect: () => void; danger?: boolean }[] = [];
    if (line.archived) {
      items.push({ label: ts("restore"), onSelect: () => onRestore(line) });
    } else {
      items.push({
        label: t("rename"),
        // After the menu has closed and given the focus back to its button: the field takes it then.
        onSelect: () => window.setTimeout(() => setRenaming(line.id), 0),
      });
      if (line.parentId === null) {
        items.push({ label: t("color"), onSelect: () => setDialog({ kind: "color", line }) });
      }
      if (isGroup && line.type !== "transfer") {
        items.push({
          label: t("addCategory"),
          onSelect: () => setDialog({ kind: "add", group: line, macro: line.type }),
        });
        items.push({ label: t("openGroup"), onSelect: () => router.push(line.href) });
      }
      if (line.parentId !== null && line.type !== "transfer") {
        items.push({ label: t("move.group"), onSelect: () => setDialog({ kind: "move", line }) });
      }
      // A group, or a category of Transfers (§5.6): its movements count as the macro of arrival.
      if (line.parentId === null || line.type === "transfer") {
        items.push({
          label: t("macroMove.open"),
          onSelect: () => setDialog({ kind: "macro", line, children: childrenOf(line.id).length }),
        });
      }
      if (line.canMerge) {
        items.push({
          label: t("merge.open"),
          onSelect: () => setDialog({ kind: "merge", line, hasChildren: children.length > 0 }),
        });
      }
      items.push({
        label: ts("archive"),
        onSelect: () =>
          setDialog({ kind: "archive", line, children: children.filter((c) => !c.archived).length }),
      });
    }
    items.push({
      label: ts("delete"),
      danger: true,
      onSelect: () => setDialog({ kind: "delete", line, children: children.length }),
    });
    return <ActionMenu label={t("actions", { name: line.name })} items={items} />;
  }

  /** "From {source}: …" under a category that a source's categories count under (N3 §6.4). */
  function sourceNote(line: BoardLine) {
    if (!line.source) return null;
    return line.source.href === null ? (
      <span className="truncate text-sm text-muted">{line.source.text}</span>
    ) : (
      <Link
        href={line.source.href}
        className="focus-ring inline-flex min-h-6 max-w-full items-center truncate rounded-xs text-sm text-muted hover:underline"
      >
        <span className="truncate">{line.source.text}</span>
      </Link>
    );
  }

  /** The name of a row: a link to its page, or the field that renames it. */
  function nameOf(line: BoardLine, strong: boolean) {
    if (renaming === line.id) {
      return (
        <Input
          aria-label={t("nameOf", { name: line.name })}
          defaultValue={line.name}
          maxLength={NAME_MAX}
          autoFocus
          disabled={pending}
          className="h-7 min-w-0 flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter") rename(line, event.currentTarget.value);
            if (event.key === "Escape") {
              setRenaming(null);
              requestAnimationFrame(() => document.getElementById(`${ids}-${line.id}`)?.focus());
            }
          }}
        />
      );
    }
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          id={`${ids}-${line.id}`}
          href={line.href}
          title={line.name}
          className={cn(
            "focus-ring inline-flex min-h-6 max-w-full items-center truncate rounded-xs hover:underline",
            strong && "font-semibold",
            line.zero && "text-muted",
          )}
        >
          <span className="truncate">{line.name}</span>
        </Link>
        {sourceNote(line)}
      </span>
    );
  }

  /** Total, share and the budget of a row (§5.2); under Transfers, out and in. */
  function figures(line: BoardLine, bar: boolean) {
    if (view.macro === "transfer") {
      return (
        <span className="flex shrink-0 gap-4 text-sm tabular-nums">
          <span className={cn(line.zero && "text-muted")}>
            <span className="text-muted">{t("out")} </span>
            {line.outTotal}
          </span>
          <span className={cn(line.zero && "text-muted")}>
            <span className="text-muted">{t("in")} </span>
            {line.inTotal}
          </span>
        </span>
      );
    }
    return (
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 max-md:order-last max-md:w-full max-md:justify-start max-md:pl-8">
        <span
          className={cn("w-28 text-right font-medium tabular-nums max-md:w-auto", line.zero && "text-muted")}
        >
          {line.total}
        </span>
        <span className="w-12 text-right text-sm text-muted tabular-nums max-md:w-auto">
          {line.shareText}
        </span>
        {bar && (
          <span className="w-40 max-md:w-24">
            <ProgressBar
              value={line.share / 100}
              label={t("shareOf", { name: line.name })}
              color={line.color}
            />
          </span>
        )}
        {line.budget && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            {t("budget", { limit: line.budget.limit })}
            <span aria-hidden className={cn("size-2 rounded-full", BUDGET_DOT[line.budget.status])} />
            <span className="sr-only">{t(`budgetStatus.${line.budget.status}`)}</span>
          </span>
        )}
      </span>
    );
  }

  const visible = (line: BoardLine) => showArchived || !line.archived;
  const hasArchived = lines.some((line) => line.archived);
  const shown = view.groups.filter(visible);

  return (
    <div className="flex flex-col gap-4">
      {empty || (
        <>
          {/* The three cards on a wide screen; on a phone the switch alone says the same (§7.2). */}
          <div className="grid grid-cols-3 gap-3 max-md:hidden">
            {macros.map((one) => (
              <button
                key={one.macro}
                type="button"
                aria-pressed={one.macro === macro}
                onClick={() => {
                  choose(one.macro);
                  document.getElementById(`${ids}-macro`)?.scrollIntoView({ block: "start" });
                }}
                className="focus-ring rounded-card text-left"
              >
                <Card className={cn("flex h-full flex-col gap-1", one.macro === macro && "border-accent")}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{macroName(one.macro)}</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {one.macro === "transfer" ? one.outTotal : one.total}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{t("count", { count: one.count })}</span>
                  {one.macro === "transfer" && (
                    <span className="text-sm text-muted">
                      {t("transferSplit", { in: one.inTotal, out: one.outTotal })}
                    </span>
                  )}
                </Card>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("macroLabel")}
          value={macro}
          onChange={choose}
          options={MACROS.map((key) => ({ value: key, label: macroName(key) }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          {!empty && view.macro !== "transfer" && (
            <Button size="sm" onClick={() => setAll(!view.groups.every((group) => open.has(group.id)))}>
              {view.groups.every((group) => open.has(group.id)) ? t("collapseAll") : t("expandAll")}
            </Button>
          )}
          {hasArchived && (
            <Checkbox
              label={t("showArchived")}
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => setDialog({ kind: "group", macro: macro === "income" ? "income" : "expense" })}
          >
            {t("newGroup")}
          </Button>
        </div>
      </div>

      {!empty && (
        <section aria-labelledby={`${ids}-macro`} className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
            <h2 id={`${ids}-macro`} className="scroll-mt-20 text-lg font-semibold">
              {macroName(view.macro)}
            </h2>
            <span data-testid="macro-total" className="font-semibold tabular-nums max-md:text-xl">
              {view.macro === "transfer"
                ? t("transferSplit", { in: view.inTotal, out: view.outTotal })
                : view.total}
            </span>
          </div>

          <ul className="flex flex-col">
            {shown.map((group) => {
              const isOpen = open.has(group.id);
              const listId = `${ids}-list-${group.id}`;
              if (view.macro === "transfer") {
                return (
                  <li
                    key={group.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2"
                  >
                    <ColorDot color={group.color} />
                    {nameOf(group, false)}
                    {group.archived && <Badge tone="neutral">{ts("archived")}</Badge>}
                    {figures(group, false)}
                    {menu(group, false)}
                  </li>
                );
              }
              const children = group.children.filter(visible);
              return (
                <li key={group.id} className="border-b border-border">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <button
                      type="button"
                      id={`${ids}-${group.id}`}
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      onClick={() => toggle(group.id)}
                      className="focus-ring flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded-xs text-left font-semibold max-md:min-h-11"
                      title={group.name}
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0 text-muted motion-safe:transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                      <ColorDot color={group.color} />
                      {renaming === group.id ? null : (
                        <span className={cn("truncate", group.zero && "text-muted")}>{group.name}</span>
                      )}
                    </button>
                    {renaming === group.id && nameOf(group, true)}
                    {group.archived && <Badge tone="neutral">{ts("archived")}</Badge>}
                    {figures(group, true)}
                    <span className="inline-grid max-md:size-11 max-md:place-items-center">
                      {menu(group, true)}
                    </span>
                    {group.source && (
                      <span className="flex w-full min-w-0 pl-8 max-md:order-last">{sourceNote(group)}</span>
                    )}
                  </div>
                  <ul id={listId} hidden={!isOpen} className="flex flex-col pb-1">
                    {group.only && (
                      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8">
                        <Link
                          href={group.only.href}
                          className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center rounded-xs text-muted hover:underline"
                        >
                          {t("onlyGroup", { group: group.name })}
                        </Link>
                        <span className="w-28 text-right tabular-nums">{group.only.total}</span>
                      </li>
                    )}
                    {children.map((child) => (
                      <li key={child.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8">
                        <ColorDot color={child.color} />
                        {nameOf(child, false)}
                        {child.archived && <Badge tone="neutral">{ts("archived")}</Badge>}
                        {figures(child, false)}
                        <span className="inline-grid max-md:size-11 max-md:place-items-center">
                          {menu(child, false)}
                        </span>
                      </li>
                    ))}
                    {!group.archived && (
                      <li className="py-1 pl-8">
                        <LinkButton onClick={() => setDialog({ kind: "add", group, macro: group.type })}>
                          {t("addCategory")}
                        </LinkButton>
                      </li>
                    )}
                  </ul>
                </li>
              );
            })}
            {view.rest && (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 text-muted">
                  {view.macro === "transfer"
                    ? t("betweenAccounts")
                    : t("toCategorize", { count: view.rest.count })}
                </span>
                {view.macro === "transfer" ? (
                  <span className="flex shrink-0 gap-4 text-sm tabular-nums">
                    <span>
                      <span className="text-muted">{t("out")} </span>
                      {view.rest.outTotal}
                    </span>
                    <span>
                      <span className="text-muted">{t("in")} </span>
                      {view.rest.inTotal}
                    </span>
                  </span>
                ) : (
                  <span className="w-28 text-right tabular-nums">{view.rest.total}</span>
                )}
                <ButtonLink size="sm" href={view.rest.href}>
                  {view.macro === "transfer" ? t("open") : t("review")}
                </ButtonLink>
              </li>
            )}
          </ul>
          {view.macro === "transfer" && (
            <div className="pt-2">
              <LinkButton onClick={() => setDialog({ kind: "add", group: null, macro: "transfer" })}>
                {t("addTransferCategory")}
              </LinkButton>
            </div>
          )}
        </section>
      )}

      {/* New group, and a new category under a group or under Transfers (§5.5). */}
      <Modal
        open={dialog?.kind === "group" || dialog?.kind === "add"}
        onOpenChange={(next) => !next && close()}
        title={
          dialog?.kind === "group"
            ? t("newGroup")
            : dialog?.kind === "add" && dialog.group === null
              ? t("addTransferCategory")
              : t("addCategory")
        }
        width={420}
        footer={
          <>
            <Button size="sm" onClick={close}>
              {ts("cancel")}
            </Button>
            <Button
              type="submit"
              form={`${ids}-create`}
              variant="primary"
              size="sm"
              disabled={pending}
              aria-busy={pending}
            >
              {ts("save")}
            </Button>
          </>
        }
      >
        {(dialog?.kind === "group" || dialog?.kind === "add") && (
          <form id={`${ids}-create`} onSubmit={onCreate} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={ts("name")} htmlFor={`${ids}-name`}>
              <Input id={`${ids}-name`} name="name" maxLength={NAME_MAX} required autoFocus />
            </Field>
            {dialog.kind === "group" ? (
              <div className="flex flex-col gap-1.5">
                <span aria-hidden className="text-sm font-medium">
                  {t("macroLabel")}
                </span>
                <Segmented
                  label={t("macroLabel")}
                  value={dialog.macro}
                  onChange={(next) => setDialog({ kind: "group", macro: next })}
                  options={(["income", "expense"] as const).map((key) => ({
                    value: key,
                    label: macroName(key),
                  }))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted">
                {dialog.group
                  ? t("addIn", { macro: macroName(dialog.macro), group: dialog.group.name })
                  : macroName(dialog.macro)}
              </p>
            )}
            {(dialog.kind === "group" || dialog.group === null) && (
              <ColorField id={`${ids}-color`} initial={null} disabled={pending} />
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "color"}
        onOpenChange={(next) => !next && close()}
        title={dialog?.kind === "color" ? t("colorOf", { name: dialog.line.name }) : t("color")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={close}>
              {ts("cancel")}
            </Button>
            <Button
              type="submit"
              form={`${ids}-color-form`}
              variant="primary"
              size="sm"
              disabled={pending}
              aria-busy={pending}
            >
              {ts("save")}
            </Button>
          </>
        }
      >
        {dialog?.kind === "color" && (
          <form
            id={`${ids}-color-form`}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onColor(dialog.line, String(new FormData(event.currentTarget).get("color") ?? "") || null);
            }}
          >
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <ColorField id={`${ids}-recolor`} initial={dialog.line.chosenColor} disabled={pending} />
          </form>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "move"}
        onOpenChange={(next) => !next && close()}
        title={t("move.group")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={close}>
              {ts("cancel")}
            </Button>
            <Button
              type="submit"
              form={`${ids}-move`}
              variant="primary"
              size="sm"
              disabled={pending}
              aria-busy={pending}
            >
              {t("move.action")}
            </Button>
          </>
        }
      >
        {dialog?.kind === "move" && (
          <form
            id={`${ids}-move`}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onMove(dialog.line, String(new FormData(event.currentTarget).get("parentId") ?? ""));
            }}
          >
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <p className="text-sm text-muted">
              {t("move.body", { name: dialog.line.name, macro: macroName(dialog.line.type) })}
            </p>
            <Field label={ts("group")} htmlFor={`${ids}-parent`}>
              <Select id={`${ids}-parent`} name="parentId" required defaultValue="">
                <option value="" disabled>
                  {t("move.pick")}
                </option>
                {groupsOf(dialog.line.type)
                  .filter((group) => group.id !== dialog.line.parentId)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "merge"}
        onOpenChange={(next) => !next && close()}
        title={ts("merge.dialog.title")}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={close}>
              {ts("cancel")}
            </Button>
            <Button
              type="submit"
              form={`${ids}-merge`}
              variant="primary"
              size="sm"
              disabled={pending}
              aria-busy={pending}
            >
              {t("merge.action")}
            </Button>
          </>
        }
      >
        {dialog?.kind === "merge" && (
          <form
            id={`${ids}-merge`}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onMerge(dialog.line, String(new FormData(event.currentTarget).get("keepId") ?? ""));
            }}
          >
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={t("merge.keep")} htmlFor={`${ids}-keep`}>
              <Select id={`${ids}-keep`} name="keepId" required defaultValue="">
                <option value="" disabled>
                  {t("merge.pick")}
                </option>
                {lines
                  .filter(
                    (one) =>
                      one.id !== dialog.line.id &&
                      one.type === dialog.line.type &&
                      one.canMerge &&
                      !one.archived &&
                      // Sub-categories can only move under a group: a third level is refused.
                      (!dialog.hasChildren || one.parentId === null),
                  )
                  .map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.parentId === null ? one.name : `${whereOf(one)} › ${one.name}`}
                    </option>
                  ))}
              </Select>
            </Field>
            <p className="text-sm text-muted">
              {t("merge.body", { name: dialog.line.name, count: dialog.line.usage })}
            </p>
          </form>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "archive"}
        onOpenChange={(next) => !next && close()}
        title={dialog?.kind === "archive" ? t("archive.title", { name: dialog.line.name }) : ts("archive")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={close}>
              {ts("cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => dialog?.kind === "archive" && onArchive(dialog.line)}
            >
              {ts("archive")}
            </Button>
          </>
        }
      >
        {dialog?.kind === "archive" && (
          <div className="flex flex-col gap-2">
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <p>{t("archive.body", { count: dialog.line.usage, name: dialog.line.name })}</p>
            {dialog.children > 0 && <p>{t("archive.children", { count: dialog.children })}</p>}
          </div>
        )}
      </Modal>

      {dialog?.kind === "macro" && (
        <MacroMoveDialog
          key={dialog.line.id}
          line={dialog.line}
          childCount={dialog.children}
          groupsOf={groupsOf}
          onClose={close}
        />
      )}

      <DeleteCategoryDialog
        category={dialog?.kind === "delete" ? dialog.line : null}
        subCategories={dialog?.kind === "delete" ? dialog.children : 0}
        onClose={close}
      />
    </div>
  );
}

/** The colour of a group or of a category of Transfers: automatic until one is picked. */
function ColorField({ id, initial, disabled }: { id: string; initial: string | null; disabled: boolean }) {
  const ts = useTranslations("settings.categories");
  const [color, setColor] = useState<string | null>(initial);
  return (
    <Field label={ts("color")} htmlFor={id} hint={ts("colorHint")}>
      <ColorSwatchPicker
        id={id}
        name="color"
        value={color}
        clearLabel={ts("autoColor")}
        disabled={disabled}
        onChange={setColor}
      />
    </Field>
  );
}

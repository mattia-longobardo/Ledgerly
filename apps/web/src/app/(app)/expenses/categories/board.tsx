"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { Button, ButtonLink, LinkButton } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Checkbox } from "@ledgerly/ui/input";
import { Link } from "@ledgerly/ui/router";
import { Segmented } from "@ledgerly/ui/segmented";
import { DeleteCategoryDialog } from "../../settings/finance/delete-dialog";
import {
  ArchiveDialog,
  ColorDialog,
  CreateDialog,
  type DialogContext,
  MergeDialog,
  MoveDialog,
} from "./board-dialogs";
import {
  type BoardGroup,
  type BoardLine,
  type BoardMacro,
  type Dialog,
  linesOf,
  type Macro,
  MACROS,
  saveOpen,
  toggleGroup,
  useOpenGroups,
} from "./board-model";
import { ChildRow, GroupHeading, type RowContext } from "./board-rows";
import { useBoardWrites } from "./board-writes";
import { MacroMoveDialog } from "./macro-dialog";

/** The three cards on a wide screen; on a phone the switch alone says the same (§7.2). */
function MacroCards({
  macros,
  macro,
  onChoose,
}: {
  macros: BoardMacro[];
  macro: Macro;
  onChoose: (next: Macro) => void;
}) {
  const text = useTranslations("expenses.categories");
  return (
    <div className="grid grid-cols-3 gap-3 max-md:hidden">
      {macros.map((one) => (
        <button
          key={one.macro}
          type="button"
          aria-pressed={one.macro === macro}
          onClick={() => onChoose(one.macro)}
          className="focus-ring rounded-card text-left"
        >
          <Card className={cn("flex h-full flex-col gap-1", one.macro === macro && "border-accent")}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{text(`macro.${one.macro}`)}</span>
              <span className="text-lg font-semibold tabular-nums">{one.total}</span>
            </span>
            <span className="text-sm text-muted">{text("count", { count: one.count })}</span>
          </Card>
        </button>
      ))}
    </div>
  );
}

/** A group with its categories, closed by default (§5.2). */
function GroupItem({
  group,
  open,
  visible,
  board,
}: {
  group: BoardGroup;
  open: Set<string>;
  visible: (line: BoardLine) => boolean;
  board: RowContext;
}) {
  const text = useTranslations("expenses.categories");
  const isOpen = open.has(group.id);
  const listId = `${board.ids}-list-${group.id}`;
  return (
    <li className="border-b border-border">
      <GroupHeading
        group={group}
        isOpen={isOpen}
        listId={listId}
        onToggle={() => toggleGroup(open, group.id)}
        board={board}
      />
      <ul id={listId} hidden={!isOpen} className="flex flex-col pb-1">
        {group.only && (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8">
            <Link
              href={group.only.href}
              className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center rounded-xs text-muted hover:underline"
            >
              {text("onlyGroup", { group: group.name })}
            </Link>
            <span className="w-28 text-right tabular-nums">{group.only.total}</span>
          </li>
        )}
        {group.children.filter(visible).map((child) => (
          <ChildRow key={child.id} line={child} board={board} />
        ))}
        {!group.archived && (
          <li className="py-1 pl-8">
            <LinkButton onClick={() => board.setDialog({ kind: "add", group, macro: group.type })}>
              {text("addCategory")}
            </LinkButton>
          </li>
        )}
      </ul>
    </li>
  );
}

/** «To categorize» of a macro. */
function RestRow({ view }: { view: BoardMacro }) {
  const text = useTranslations("expenses.categories");
  if (!view.rest) return null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 flex-1 text-muted">{text("toCategorize", { count: view.rest.count })}</span>
      <span className="w-28 text-right tabular-nums">{view.rest.total}</span>
      <ButtonLink size="sm" href={view.rest.href}>
        {text("review")}
      </ButtonLink>
    </li>
  );
}

/** The macro on screen: its total, its groups and what is left. */
function MacroSection({
  view,
  open,
  visible,
  board,
}: {
  view: BoardMacro;
  open: Set<string>;
  visible: (line: BoardLine) => boolean;
  board: RowContext;
}) {
  const text = useTranslations("expenses.categories");
  return (
    <section aria-labelledby={`${board.ids}-macro`} className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h2 id={`${board.ids}-macro`} className="scroll-mt-20 text-lg font-semibold">
          {text(`macro.${view.macro}`)}
        </h2>
        <span data-testid="macro-total" className="font-semibold tabular-nums max-md:text-xl">
          {view.total}
        </span>
      </div>
      <ul className="flex flex-col">
        {view.groups.filter(visible).map((group) => (
          <GroupItem key={group.id} group={group} open={open} visible={visible} board={board} />
        ))}
        <RestRow view={view} />
      </ul>
    </section>
  );
}

/** The switch of the macro, «Expand all», «Show archived» and «New group». */
function Toolbar({
  view,
  macro,
  onChoose,
  open,
  showArchived,
  empty,
  board,
}: {
  view: BoardMacro;
  macro: Macro;
  onChoose: (next: Macro) => void;
  open: Set<string>;
  showArchived: { shown: boolean; set: (next: boolean) => void } | null;
  empty: boolean;
  board: RowContext;
}) {
  const text = useTranslations("expenses.categories");
  const allOpen = view.groups.every((group) => open.has(group.id));
  const setAll = (opening: boolean) => {
    const next = new Set(open);
    for (const group of view.groups) {
      if (opening) next.add(group.id);
      else next.delete(group.id);
    }
    saveOpen(next);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented
        label={text("macroLabel")}
        value={macro}
        onChange={onChoose}
        options={MACROS.map((key) => ({ value: key, label: text(`macro.${key}`) }))}
      />
      <div className="flex flex-wrap items-center gap-3">
        {!empty && (
          <Button size="sm" onClick={() => setAll(!allOpen)}>
            {allOpen ? text("collapseAll") : text("expandAll")}
          </Button>
        )}
        {showArchived && (
          <Checkbox
            label={text("showArchived")}
            checked={showArchived.shown}
            onChange={(event) => showArchived.set(event.currentTarget.checked)}
          />
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={board.pending}
          onClick={() => board.setDialog({ kind: "group", macro: macro === "income" ? "income" : "expense" })}
        >
          {text("newGroup")}
        </Button>
      </div>
    </div>
  );
}

/** The macro on screen; the address keeps it, so a reload or a shared link opens on it. */
function useMacro(initial: Macro) {
  const [macro, setMacro] = useState<Macro>(initial);
  const choose = (next: Macro) => {
    setMacro(next);
    const url = new URL(window.location.href);
    if (next === "expense") url.searchParams.delete("macro");
    else url.searchParams.set("macro", next);
    window.history.replaceState(window.history.state, "", url);
  };
  return [macro, choose] as const;
}

/** The dialog open on the board, its error and the row being renamed. */
function useBoardState(lines: readonly BoardLine[]) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setDialog(null);
    setError(null);
  };
  const writes = useBoardWrites({ lines, close, fail: setError });
  return { dialog, setDialog, renaming, setRenaming, error, close, writes };
}

function BoardDialogs({ board }: { board: DialogContext }) {
  const { dialog } = board;
  return (
    <>
      <CreateDialog board={board} />
      <ColorDialog board={board} />
      <MoveDialog board={board} />
      <MergeDialog board={board} />
      <ArchiveDialog board={board} />
      {dialog?.kind === "macro" && (
        <MacroMoveDialog
          key={dialog.line.id}
          line={dialog.line}
          childCount={dialog.children}
          groupsOf={board.groupsOf}
          onClose={board.close}
        />
      )}
      <DeleteCategoryDialog
        category={dialog?.kind === "delete" ? dialog.line : null}
        subCategories={dialog?.kind === "delete" ? dialog.children : 0}
        onClose={board.close}
      />
    </>
  );
}

type BoardState = ReturnType<typeof useBoardState>;

function rowContextOf(ids: string, state: BoardState, lines: readonly BoardLine[]): RowContext {
  return {
    ids,
    renaming: state.renaming,
    pending: state.writes.pending,
    childrenOf: (id) => lines.filter((line) => line.parentId === id),
    setDialog: state.setDialog,
    setRenaming: state.setRenaming,
    rename: (line, name) =>
      name.trim() === line.name
        ? state.setRenaming(null)
        : state.writes.rename(line, name.trim(), () => state.setRenaming(null)),
    restore: state.writes.restore,
  };
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
  const ids = useId();
  const [macro, choose] = useMacro(initialMacro);
  const open = useOpenGroups();
  const [showArchived, setShowArchived] = useState(false);
  const lines = linesOf(macros);
  const state = useBoardState(lines);
  const view = macros.find((one) => one.macro === macro) ?? macros[0];
  const groupsOf = (type: Macro) =>
    lines.filter((line) => line.parentId === null && line.type === type && !line.archived);
  const rows = rowContextOf(ids, state, lines);
  const dialogs: DialogContext = {
    ...state,
    ids,
    lines,
    groupsOf,
    opened: (groupId) => !open.has(groupId) && toggleGroup(open, groupId),
  };
  const visible = (line: BoardLine) => showArchived || !line.archived;
  const pick = (next: Macro) => {
    choose(next);
    document.getElementById(`${ids}-macro`)?.scrollIntoView({ block: "start" });
  };
  const archivedToggle = lines.some((line) => line.archived)
    ? { shown: showArchived, set: setShowArchived }
    : null;
  return (
    <div className="flex flex-col gap-4">
      {empty || <MacroCards macros={macros} macro={macro} onChoose={pick} />}
      <Toolbar
        view={view}
        macro={macro}
        onChoose={choose}
        open={open}
        showArchived={archivedToggle}
        empty={Boolean(empty)}
        board={rows}
      />
      {!empty && <MacroSection view={view} open={open} visible={visible} board={rows} />}
      <BoardDialogs board={dialogs} />
    </div>
  );
}

"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAME_MAX } from "@ledgerly/domain/transactions/client";
import { Badge } from "@ledgerly/ui/badge";
import { cn } from "@ledgerly/ui/cn";
import { ColorDot } from "@ledgerly/ui/color-picker";
import { Input } from "@ledgerly/ui/input";
import { ActionMenu } from "@ledgerly/ui/menu";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import type { BoardGroup, BoardLine, Dialog } from "./board-model";

const BUDGET_DOT = { on_track: "bg-pos", near: "bg-warn", over: "bg-neg" } as const;

/** What every row of the board reads from the board: its state and what its menu opens. */
export interface RowContext {
  /** The prefix of the ids of the page's elements. */
  ids: string;
  renaming: string | null;
  pending: boolean;
  transfer: boolean;
  childrenOf: (id: string) => BoardLine[];
  setDialog: (dialog: Dialog) => void;
  setRenaming: (id: string | null) => void;
  rename: (line: BoardLine, name: string) => void;
  restore: (line: BoardLine) => void;
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** The items of a line in use: rename, colour, add, open, move, change macro, merge, archive. */
function liveItems({
  line,
  isGroup,
  board,
  push,
  text,
  settingsText,
}: {
  line: BoardLine;
  isGroup: boolean;
  board: RowContext;
  push: (href: BoardLine["href"]) => void;
  text: ReturnType<typeof useTranslations<"expenses.categories">>;
  settingsText: ReturnType<typeof useTranslations<"settings.categories">>;
}) {
  const children = isGroup ? board.childrenOf(line.id) : [];
  const items: MenuItem[] = [
    // After the menu has closed and given the focus back to its button: the field takes it then.
    { label: text("rename"), onSelect: () => window.setTimeout(() => board.setRenaming(line.id), 0) },
  ];
  if (line.parentId === null)
    items.push({ label: text("color"), onSelect: () => board.setDialog({ kind: "color", line }) });
  if (isGroup && line.type !== "transfer") {
    items.push({
      label: text("addCategory"),
      onSelect: () => board.setDialog({ kind: "add", group: line, macro: line.type }),
    });
    items.push({ label: text("openGroup"), onSelect: () => push(line.href) });
  }
  if (line.parentId !== null && line.type !== "transfer")
    items.push({ label: text("move.group"), onSelect: () => board.setDialog({ kind: "move", line }) });
  // A group, or a category of Transfers (§5.6): its movements count as the macro of arrival.
  if (line.parentId === null || line.type === "transfer") {
    const count = board.childrenOf(line.id).length;
    items.push({
      label: text("macroMove.open"),
      onSelect: () => board.setDialog({ kind: "macro", line, children: count }),
    });
  }
  if (line.canMerge) {
    const hasChildren = children.length > 0;
    items.push({
      label: text("merge.open"),
      onSelect: () => board.setDialog({ kind: "merge", line, hasChildren }),
    });
  }
  const unarchived = children.filter((child) => !child.archived).length;
  items.push({
    label: settingsText("archive"),
    onSelect: () => board.setDialog({ kind: "archive", line, children: unarchived }),
  });
  return items;
}

function RowMenu({ line, isGroup, board }: { line: BoardLine; isGroup: boolean; board: RowContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const router = useRouter();
  const children = isGroup ? board.childrenOf(line.id).length : 0;
  const items = line.archived
    ? [{ label: settingsText("restore"), onSelect: () => board.restore(line) }]
    : liveItems({ line, isGroup, board, push: (href) => router.push(href), text, settingsText });
  items.push({
    label: settingsText("delete"),
    danger: true,
    onSelect: () => board.setDialog({ kind: "delete", line, children }),
  });
  return <ActionMenu label={text("actions", { name: line.name })} items={items} />;
}

/** "From {source}: …" under a category that a source's categories count under (N3 §6.4). */
function SourceNote({ line }: { line: BoardLine }) {
  if (!line.source) return null;
  if (line.source.href === null)
    return <span className="truncate text-sm text-muted">{line.source.text}</span>;
  return (
    <Link
      href={line.source.href}
      className="focus-ring inline-flex min-h-6 max-w-full items-center truncate rounded-xs text-sm text-muted hover:underline"
    >
      <span className="truncate">{line.source.text}</span>
    </Link>
  );
}

function RenameField({ line, board }: { line: BoardLine; board: RowContext }) {
  const text = useTranslations("expenses.categories");
  return (
    <Input
      aria-label={text("nameOf", { name: line.name })}
      defaultValue={line.name}
      maxLength={NAME_MAX}
      autoFocus
      disabled={board.pending}
      className="h-7 min-w-0 flex-1"
      onKeyDown={(event) => {
        if (event.key === "Enter") board.rename(line, event.currentTarget.value);
        if (event.key === "Escape") {
          board.setRenaming(null);
          requestAnimationFrame(() => document.getElementById(`${board.ids}-${line.id}`)?.focus());
        }
      }}
    />
  );
}

/** The name of a row: a link to its page, or the field that renames it. */
function LineName({ line, strong, board }: { line: BoardLine; strong: boolean; board: RowContext }) {
  if (board.renaming === line.id) return <RenameField line={line} board={board} />;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <Link
        id={`${board.ids}-${line.id}`}
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
      <SourceNote line={line} />
    </span>
  );
}

/** Out and in, as Transfers shows a line or the movements between accounts. */
export function TransferFigures({
  outTotal,
  inTotal,
  muted,
}: {
  outTotal: string;
  inTotal: string;
  muted: boolean;
}) {
  const text = useTranslations("expenses.categories");
  return (
    <span className="flex shrink-0 gap-4 text-sm tabular-nums">
      <span className={cn(muted && "text-muted")}>
        <span className="text-muted">{text("out")} </span>
        {outTotal}
      </span>
      <span className={cn(muted && "text-muted")}>
        <span className="text-muted">{text("in")} </span>
        {inTotal}
      </span>
    </span>
  );
}

function BudgetMark({ budget }: { budget: NonNullable<BoardLine["budget"]> }) {
  const text = useTranslations("expenses.categories");
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      {text("budget", { limit: budget.limit })}
      <span aria-hidden className={cn("size-2 rounded-full", BUDGET_DOT[budget.status])} />
      <span className="sr-only">{text(`budgetStatus.${budget.status}`)}</span>
    </span>
  );
}

/** Total, share and the budget of a row (§5.2); under Transfers, out and in. */
function Figures({ line, bar, transfer }: { line: BoardLine; bar: boolean; transfer: boolean }) {
  const text = useTranslations("expenses.categories");
  if (transfer) return <TransferFigures outTotal={line.outTotal} inTotal={line.inTotal} muted={line.zero} />;
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 max-md:order-last max-md:w-full max-md:justify-start max-md:pl-8">
      <span
        className={cn("w-28 text-right font-medium tabular-nums max-md:w-auto", line.zero && "text-muted")}
      >
        {line.total}
      </span>
      <span className="w-12 text-right text-sm text-muted tabular-nums max-md:w-auto">{line.shareText}</span>
      {bar && (
        <span className="w-40 max-md:w-24">
          <ProgressBar
            value={line.share / 100}
            label={text("shareOf", { name: line.name })}
            color={line.color}
          />
        </span>
      )}
      {line.budget && <BudgetMark budget={line.budget} />}
    </span>
  );
}

function ArchivedBadge({ line }: { line: BoardLine }) {
  const settingsText = useTranslations("settings.categories");
  return line.archived ? <Badge tone="neutral">{settingsText("archived")}</Badge> : null;
}

/** A category of Transfers: one flat row (CR2). */
export function TransferRow({ line, board }: { line: BoardLine; board: RowContext }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      <ColorDot color={line.color} />
      <LineName line={line} strong={false} board={board} />
      <ArchivedBadge line={line} />
      <Figures line={line} bar={false} transfer />
      <RowMenu line={line} isGroup={false} board={board} />
    </li>
  );
}

/** A category under its group. */
export function ChildRow({ line, board }: { line: BoardLine; board: RowContext }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8">
      <ColorDot color={line.color} />
      <LineName line={line} strong={false} board={board} />
      <ArchivedBadge line={line} />
      <Figures line={line} bar={false} transfer={false} />
      <span className="inline-grid max-md:size-11 max-md:place-items-center">
        <RowMenu line={line} isGroup={false} board={board} />
      </span>
    </li>
  );
}

/** The heading of a group: the button that opens it, its figures and its menu. */
export function GroupHeading({
  group,
  isOpen,
  listId,
  onToggle,
  board,
}: {
  group: BoardGroup;
  isOpen: boolean;
  listId: string;
  onToggle: () => void;
  board: RowContext;
}) {
  const renaming = board.renaming === group.id;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <button
        type="button"
        id={`${board.ids}-${group.id}`}
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={onToggle}
        className="focus-ring flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded-xs text-left font-semibold max-md:min-h-11"
        title={group.name}
      >
        <ChevronRight
          aria-hidden
          className={cn("size-4 shrink-0 text-muted motion-safe:transition-transform", isOpen && "rotate-90")}
        />
        <ColorDot color={group.color} />
        {renaming ? null : <span className={cn("truncate", group.zero && "text-muted")}>{group.name}</span>}
      </button>
      {renaming && <LineName line={group} strong board={board} />}
      <ArchivedBadge line={group} />
      <Figures line={group} bar transfer={false} />
      <span className="inline-grid max-md:size-11 max-md:place-items-center">
        <RowMenu line={group} isGroup board={board} />
      </span>
      {group.source && (
        <span className="flex w-full min-w-0 pl-8 max-md:order-last">
          <SourceNote line={group} />
        </span>
      )}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useCallback, useMemo, useState, useTransition } from "react";
import { cn } from "@ledgerly/ui/cn";
import { DataTable } from "@ledgerly/ui/data-table";
import { Checkbox } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { type Params, withParams } from "@ledgerly/ui/url";
import { useSelection } from "@ledgerly/ui/use-selection";
import { useCategoryActions } from "./category-actions";
import { CategoryCell } from "./category-cell";
import { changeVisibility, type CommandResult, setCategory } from "./commands";
import { TransactionDetails } from "./details-modal";
import { DEFAULT_DIRECTION, type SortDirection, type SortKey } from "./filters";
import { useManualMovement } from "./manual-movement";
import { PayeeCell, RowCard } from "./row-parts";
import { SelectionBar } from "./selection-bar";
import { DeleteHiddenModal, TransactionRowMenu } from "./transaction-row-menu";
import { nextDirection, SortHeading } from "./sort-heading";
import { useRowKeyboard } from "./use-row-keyboard";
import type { CategoryOption, GroupView, LabelOption, RowView } from "./view";

/** The sortable columns of the design, left to right, with the width of each `<col>`. */
const COLUMNS: readonly {
  name: SortKey;
  align: "left" | "right";
  width?: string;
  muted?: boolean;
  className?: string | ((row: RowView) => string);
}[] = [
  { name: "date", align: "left", width: "w-[104px]", muted: true, className: "text-sm" },
  { name: "payee", align: "left" },
  { name: "account", align: "left", width: "w-[15%]", muted: true, className: "text-sm" },
  { name: "category", align: "left", width: "w-[20%]" },
  {
    name: "amount",
    align: "right",
    width: "w-[120px]",
    className: (row) => cn("font-medium", TONE_TEXT[row.amountTone]),
  },
];

function domId(id: string): string {
  return `expenses-row-${id}`;
}

/**
 * The design's Expenses table: multiple selection with an action bar, month group rows with their
 * own count and total, the category editable on the row, and the shortcuts of the prototype's
 * card (E · Space · J/K).
 *
 * Selection, the open editor and the keyboard cursor are the only state here. Everything a reader
 * can see comes from the URL and is resolved on the server (spec §8.4 point 2), which is why
 * sorting navigates rather than re-sorting an array in the browser: the answer stays the same
 * whether the page was rendered fresh or reached by a link.
 */
export function TransactionsTable({
  groups,
  categories,
  labels,
  params,
  sort,
  direction,
  path = "/expenses",
  sortable = true,
  visibility = changeVisibility,
}: {
  groups: readonly GroupView[];
  categories: readonly CategoryOption[];
  /** The labels the details panel offers; empty is a legitimate answer, not a missing one. */
  labels: readonly LabelOption[];
  params: Params;
  sort: SortKey;
  direction: SortDirection;
  path?: string;
  /** `false` where the order is the page's own and no heading changes it ("To review"). */
  sortable?: boolean;
  /** Hide, restore and delete for good; the route rebuilds a manual movement's balance (PERS-473). */
  visibility?: (ids: string[], change: "hide" | "restore" | "delete") => Promise<CommandResult>;
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** The manual movement's dialogs, where the page set them up. */
  const manual = useManualMovement();
  /** The automatic categories: "Confirm" and "Apply to N similar?", where the page set them up. */
  const automatic = useCategoryActions();

  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  /** A revalidation can take a selected row away; the ones left are the ones that count. */
  const selection = useSelection(ids);
  const chosen = rows.filter((row) => selection.has(row.id));

  const editOnKey = useCallback((id: string) => setEditing(`table:${id}`), []);
  useRowKeyboard(ids, domId, { toggle: selection.toggle, edit: editOnKey });

  /**
   * Double-click a row to open it for editing (owner, 2026-09-20). The same panel the row menu's
   * "Edit" opens and the same one `E` opens, so the mouse gains a shortcut and nothing else moves.
   *
   * A double-click that lands on a control of the row — the checkbox, the category chip, the menu
   * — belongs to that control: opening the panel on top of it would undo what the person was
   * doing. The text selection a double-click leaves behind is cleared, because it was a gesture
   * here and not a request to select a word.
   */
  function openOnDoubleClick(event: MouseEvent<HTMLElement>, row: RowView) {
    if ((event.target as HTMLElement).closest("button, a, input, select, [role='menu']")) return;
    window.getSelection()?.removeAllRanges();
    // A movement written by hand opens its own dialog: every field of it is the person's.
    if (row.manual && manual) manual.openEdit(row);
    else setDetailsFor(row.id);
  }

  /** A refusal code from the service, spelled out one branch at a time so the keys stay literal. */
  function messageFor(code: string): string {
    if (code === "not_found") return t("errors.notFound");
    if (code === "provider_owned") return t("errors.providerOwned");
    return t("errors.failed");
  }

  /** The toast reports the action's own count, not the length of the list it was sent. */
  function run(work: () => Promise<CommandResult>, done: (count: number) => string) {
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          notify(messageFor(result.error), "error");
          return;
        }
        selection.clear();
        setEditing(null);
        notify(done(result.count));
      } catch {
        notify(t("errors.failed"), "error");
      }
    });
  }

  function onSetCategory(ids: readonly string[], categoryId: string | null) {
    run(
      async () => {
        const result = await setCategory(ids, categoryId);
        // One movement, one category: the similar ones may follow (decision K3). Never after a
        // choice on several rows, where the person already said which ones.
        if (result.ok && result.count > 0 && ids.length === 1 && categoryId !== null) {
          const reason = rows.find((row) => row.id === ids[0])?.categoryReason;
          automatic?.afterChoice(
            ids[0],
            categoryId,
            reason?.code === "rule" && reason.params.ruleId
              ? { id: reason.params.ruleId, name: reason.params.name ?? "" }
              : null,
          );
        }
        return result;
      },
      (count) => t("toasts.categorySet", { count }),
    );
  }

  /** "Confirm" on one row or on the selection: only the automatic and the suggested ones change. */
  function onConfirm(ids: readonly string[]): Promise<boolean> {
    if (!automatic) return Promise.resolve(false);
    return automatic.confirm(ids).then((saved) => {
      if (saved) selection.clear();
      return saved;
    });
  }

  /** Spec §7.2 and D10: the design's "Delete" hides, and "Show hidden" undoes it. */
  function onVisibility(ids: readonly string[], hidden: boolean) {
    if (hidden) {
      run(
        () => visibility([...ids], "restore"),
        (count) => t("toasts.restored", { count }),
      );
      return;
    }
    run(
      () => visibility([...ids], "hide"),
      (count) => t("toasts.hidden", { count }),
    );
  }

  /** A new column starts in its own natural direction; clicking the current one turns it round. */
  function sortBy(key: SortKey) {
    const next = nextDirection(key, sort, direction);
    router.push(
      withParams(path, params, {
        sort: key === "date" ? undefined : key,
        dir: next === DEFAULT_DIRECTION[key] ? undefined : next,
      }),
    );
  }

  /** The row whose details panel is open, if it is still in the list after a revalidation. */
  const opened = rows.find((row) => row.id === detailsFor);

  /**
   * The two layouts draw the same row, so each keeps its own editor key: one open editor must not
   * open a second popup behind the layout the viewport is not showing.
   */
  function categoryTrigger(row: RowView, variant: "table" | "list") {
    const key = `${variant}:${row.id}`;
    return (
      <CategoryCell
        row={row}
        categories={categories}
        open={editing === key}
        onOpenChange={(open) => setEditing(open ? key : null)}
        onPick={(categoryId) => onSetCategory([row.id], categoryId)}
        onConfirm={automatic ? () => onConfirm([row.id]) : undefined}
        disabled={pending}
        wide={variant === "list"}
      />
    );
  }

  function rowMenu(row: RowView, variant: "table" | "list") {
    return (
      <TransactionRowMenu
        row={row}
        onEditCategory={() => setEditing(`${variant}:${row.id}`)}
        onOpenDetails={() => setDetailsFor(row.id)}
        onVisibility={() => onVisibility([row.id], row.hidden)}
        onDeleteHidden={() => setDeleting(row.id)}
      />
    );
  }

  const payeeLabel = (row: RowView): string => row.payee ?? t("row.noPayee");

  const rowCheckbox = (row: RowView) => (
    <Checkbox
      label=""
      aria-label={payeeLabel(row)}
      checked={selection.has(row.id)}
      disabled={pending}
      onChange={() => selection.toggle(row.id)}
    />
  );

  const cellOf: Record<SortKey, (row: RowView) => ReactNode> = {
    date: (row) => row.date,
    payee: (row) => <PayeeCell row={row} />,
    account: (row) => (
      <span className="block truncate" title={row.account}>
        {row.account}
      </span>
    ),
    category: (row) => categoryTrigger(row, "table"),
    amount: (row) => row.amount,
  };

  return (
    <div className="flex flex-col">
      <DeleteHiddenModal
        open={deleting !== null}
        pending={pending}
        onCancel={() => setDeleting(null)}
        onDelete={() => {
          const id = deleting;
          setDeleting(null);
          if (id)
            run(
              () => visibility([id], "delete"),
              (count) => t("toasts.deleted", { count }),
            );
        }}
      />
      {chosen.length > 0 && (
        <SelectionBar
          chosen={chosen}
          categories={categories}
          pickerOpen={editing === "selection"}
          onPickerOpenChange={(open) => setEditing(open ? "selection" : null)}
          pending={pending}
          onSetCategory={onSetCategory}
          onConfirm={automatic ? (ids) => void onConfirm(ids) : undefined}
          onVisibility={onVisibility}
          onClear={selection.clear}
        />
      )}

      {/* The table scrolls with the page, not in a box of its own: a nested scrollbar beside the
          page's left the side cards and the table scrolling apart (2026-09-18). The headings stay
          in sight under the sticky top bar (48 px); `overflow-clip` on the card, unlike `hidden`,
          does not make it a scroll container that would catch them.
          A fixed layout: the checkbox, the date, the amount and the menu have their widths, the
          account and the category a share, and the payee what is left — every text column
          truncates instead of pushing the table past its column. With an automatic layout the
          longest name set the width, and real names (a 40-character category, a card-terminal
          payee) gave the table a sideways scrollbar at every width (2026-09-18). */}
      <DataTable
        frameClassName="[&_thead_th]:sticky [&_thead_th]:top-12 [&_thead_th]:z-[2] [&_thead_th]:bg-card"
        groups={groups.map((group) => ({
          key: group.key,
          label: group.label,
          summary: [
            t("group.summary", { count: group.count, total: group.total }),
            ...(group.excludedCount ? [t("totals.partial", { count: group.excludedCount })] : []),
          ].join(" · "),
          rows: group.rows,
        }))}
        rowKey={(row) => row.id}
        columns={[
          {
            key: "select",
            width: "w-10",
            header: (
              <Checkbox
                label=""
                aria-label={t("selection.all")}
                checked={selection.all}
                disabled={pending}
                onChange={selection.toggleAll}
              />
            ),
            cell: rowCheckbox,
          },
          ...COLUMNS.map((column) => ({
            key: column.name,
            align: column.align,
            width: column.width,
            header: <SortHeading name={column.name} sort={sortable ? { sort, direction } : null} />,
            sort: sortable
              ? { direction: column.name === sort ? direction : null, onSort: () => sortBy(column.name) }
              : undefined,
            muted: column.muted,
            className: column.className,
            cell: cellOf[column.name],
          })),
          {
            key: "actions",
            align: "right",
            width: "w-12",
            hiddenHeader: true,
            header: t("columns.actions"),
            cell: (row) => rowMenu(row, "table"),
          },
        ]}
        rowProps={(row) => ({
          id: domId(row.id),
          tabIndex: -1,
          selected: selection.has(row.id),
          onDoubleClick: (event) => openOnDoubleClick(event, row),
          className: cn(
            "focus:outline-1 focus:-outline-offset-1 focus:outline-accent",
            row.hidden && "opacity-60",
          ),
        })}
        cardProps={(row) => ({
          onDoubleClick: (event) => openOnDoubleClick(event, row),
          className: cn(
            "flex items-start gap-3 border-b border-border px-4 py-2.5",
            selection.has(row.id) && "bg-sel",
            row.hidden && "opacity-60",
          ),
        })}
        card={(row) => (
          <RowCard
            row={row}
            checkbox={rowCheckbox(row)}
            category={categoryTrigger(row, "list")}
            menu={rowMenu(row, "list")}
          />
        )}
      />

      {/* One panel for the whole table, keyed by its row so it opens with that row's own values. */}
      {opened !== undefined && (
        <TransactionDetails
          key={opened.id}
          row={opened}
          labels={labels}
          open
          onOpenChange={(open) => !open && setDetailsFor(null)}
        />
      )}
    </div>
  );
}

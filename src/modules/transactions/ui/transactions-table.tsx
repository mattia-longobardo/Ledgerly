"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { type Params, withParams } from "@/modules/accounts/ui/controls";
import { Badge, Tag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Checkbox } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { TONE_TEXT } from "@/ui/tone";
import { CategoryPicker } from "@/ui/category-picker";
import { type CommandResult, hide, restore, setCategory } from "./commands";
import { TransactionDetails } from "./details-modal";
import type { RowBadge } from "./display";
import { DEFAULT_DIRECTION, type SortDirection, type SortKey } from "./filters";
import type { CategoryOption, GroupView, LabelOption, RowView } from "./view";

/** Hidden and gone-from-the-provider are facts about the data; "edited here" is one about the user. */
const BADGE_TONE: Record<RowBadge, "neutral" | "warn" | "accent"> = {
  hidden: "neutral",
  removedUpstream: "warn",
  edited: "accent",
  transfer: "neutral",
  // A leg with no other side here usually asks for the other account to be linked.
  unpaired: "warn",
  pending: "warn",
};

/** The columns of the design, left to right; every one of them orders the list. */
const COLUMNS: readonly { name: SortKey; align: "left" | "right" }[] = [
  { name: "date", align: "left" },
  { name: "payee", align: "left" },
  { name: "account", align: "left" },
  { name: "category", align: "left" },
  { name: "amount", align: "right" },
];

/** Seven cells: the checkbox, the five columns, the row menu. */
const COLUMN_COUNT = COLUMNS.length + 2;

const CHIP = "focus-ring inline-flex h-[22px] items-center gap-1.5 rounded-[4px] px-1.5 text-sm";

/**
 * What the shortcuts keep their hands off. Fields and popups are the obvious ones; every kind of
 * button is here because Space is the way a button is activated, so intercepting it would mean a
 * category chip, a row menu, a sortable heading or a `<summary>` silently doing nothing while a
 * row nobody pointed at gets selected instead.
 */
const FOREIGN_KEYBOARD = [
  "input",
  "textarea",
  "select",
  "button",
  "summary",
  "a[href]",
  "[role='button']",
  "[role='link']",
  "[contenteditable]",
  "[role='dialog']",
  "[role='menu']",
].join(", ");

/**
 * The direction one more click on a heading would order by, which is what `sortBy` asks for: a
 * column already sorted turns round, a new one starts in its own natural direction. The heading
 * announces this, so what a screen reader hears is what the click does (review B4).
 */
function nextDirection(key: SortKey, sort: SortKey, direction: SortDirection): SortDirection {
  return key === sort ? (direction === "asc" ? "desc" : "asc") : DEFAULT_DIRECTION[key];
}

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
}: {
  groups: readonly GroupView[];
  categories: readonly CategoryOption[];
  /** The labels the details panel offers; empty is a legitimate answer, not a missing one. */
  labels: readonly LabelOption[];
  params: Params;
  sort: SortKey;
  direction: SortDirection;
  path?: string;
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [editing, setEditing] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  /** A revalidation can take a selected row away; the ones left are the ones that count. */
  const chosen = useMemo(() => rows.filter((row) => selection.includes(row.id)), [rows, selection]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  useEffect(() => {
    if (cursor < 0 || cursor >= rows.length) return;
    document.getElementById(domId(rows[cursor].id))?.focus();
  }, [cursor, rows]);

  /**
   * The prototype's shortcuts, for real (spec §8.4 point 2). Bound to the document so they work
   * the moment the page is read, and ignored while the caret is in a field, a control owns its
   * own keys or a popup owns the keyboard — Space is how a button is pressed, a menu answers its
   * own arrows, and ⌘K is not ours to intercept.
   */
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (rows.length === 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(FOREIGN_KEYBOARD)) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        setCursor((current) => {
          const next = current < 0 ? 0 : current + (key === "j" ? 1 : -1);
          return Math.min(rows.length - 1, Math.max(0, next));
        });
        return;
      }
      if (cursor < 0 || cursor >= rows.length) return;
      const row = rows[cursor];
      if (key === " ") {
        event.preventDefault();
        setSelection((current) =>
          current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id],
        );
        return;
      }
      if (key === "e") {
        event.preventDefault();
        setEditing(`table:${row.id}`);
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [cursor, rows]);

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
        setSelection([]);
        setEditing(null);
        notify(done(result.count));
      } catch {
        notify(t("errors.failed"), "error");
      }
    });
  }

  function onSetCategory(ids: readonly string[], categoryId: string | null) {
    run(
      () => setCategory(ids, categoryId),
      (count) => t("toasts.categorySet", { count }),
    );
  }

  /** Spec §7.2 and D10: the design's "Delete" hides, and "Show hidden" undoes it. */
  function onVisibility(ids: readonly string[], hidden: boolean) {
    if (hidden) {
      run(
        () => restore(ids),
        (count) => t("toasts.restored", { count }),
      );
      return;
    }
    run(
      () => hide(ids),
      (count) => t("toasts.hidden", { count }),
    );
  }

  function toggle(id: string) {
    setSelection((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
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

  /** Every selected row is already hidden: the only thing left to offer is putting them back. */
  const chosenHidden = chosen.length > 0 && chosen.every((row) => row.hidden);

  /**
   * The two layouts draw the same row, so each keeps its own editor key: one open editor must not
   * open a second popup behind the layout the viewport is not showing.
   */
  function categoryTrigger(row: RowView, variant: "table" | "list") {
    const key = `${variant}:${row.id}`;
    return (
      <CategoryPicker
        categories={categories}
        currentId={row.categoryId}
        open={editing === key}
        onOpenChange={(open) => setEditing(open ? key : null)}
        onPick={(categoryId) => onSetCategory([row.id], categoryId)}
        uncategorisedLabel={t("row.uncategorised")}
        searchLabel={t("row.searchCategory")}
        noMatchLabel={t("row.noCategoryMatch")}
        triggerLabel={t("row.editCategory")}
        disabled={pending}
        triggerClassName={cn(
          CHIP,
          // As wide as its column allows (the table's layout is fixed), and truncated past that.
          "max-w-full border border-transparent hover:border-border hover:bg-card",
          editing === key && "border-accent bg-card",
        )}
      >
        <span
          aria-hidden
          className={cn("size-[7px] shrink-0 rounded-[2px]", row.categoryColor === null && "bg-faint")}
          style={row.categoryColor === null ? undefined : { background: row.categoryColor }}
        />
        <span className="min-w-0 truncate">{row.categoryName ?? t("row.uncategorised")}</span>
      </CategoryPicker>
    );
  }

  function rowMenu(row: RowView, variant: "table" | "list") {
    return (
      <ActionMenu
        label={t("row.menu")}
        items={[
          { label: t("row.editCategory"), onSelect: () => setEditing(`${variant}:${row.id}`) },
          { label: t("row.edit"), onSelect: () => setDetailsFor(row.id) },
          {
            label: row.hidden ? t("selection.restore") : t("selection.hide"),
            onSelect: () => onVisibility([row.id], row.hidden),
            danger: !row.hidden,
          },
        ]}
      />
    );
  }

  function badges(row: RowView) {
    return row.badges.map((badge) => (
      <Badge key={badge} tone={BADGE_TONE[badge]}>
        {t(`badges.${badge}`)}
      </Badge>
    ));
  }

  function payeeLabel(row: RowView): string {
    return row.payee ?? t("row.noPayee");
  }

  function details(row: RowView) {
    return (
      <>
        {row.note !== null && (
          <span className="block truncate text-sm text-muted">
            <span className="sr-only">{t("row.note")}: </span>
            {row.note}
          </span>
        )}
        {row.labels.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            <span className="sr-only">{t("row.labels")}: </span>
            {row.labels.map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col">
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-sel px-4 py-1.5 text-sm">
          <span className="font-medium">{t("selection.label", { count: chosen.length })}</span>
          <CategoryPicker
            categories={categories}
            currentId={null}
            open={editing === "selection"}
            onOpenChange={(open) => setEditing(open ? "selection" : null)}
            onPick={(categoryId) =>
              onSetCategory(
                chosen.map((row) => row.id),
                categoryId,
              )
            }
            uncategorisedLabel={t("row.uncategorised")}
            searchLabel={t("row.searchCategory")}
            noMatchLabel={t("row.noCategoryMatch")}
            triggerLabel={t("selection.setCategory")}
            disabled={pending}
            triggerClassName={cn(CHIP, "h-6 border border-border bg-card px-2 hover:bg-hover")}
          >
            {t("selection.setCategory")}
          </CategoryPicker>
          <Button
            size="xs"
            variant={chosenHidden ? "secondary" : "danger"}
            disabled={pending}
            onClick={() =>
              onVisibility(
                chosen.map((row) => row.id),
                chosenHidden,
              )
            }
          >
            {chosenHidden ? t("selection.restore") : t("selection.hide")}
          </Button>
          <span className="flex-1" />
          <Button size="xs" variant="ghost" onClick={() => setSelection([])}>
            {t("selection.clear")}
          </Button>
        </div>
      )}

      {/* The table scrolls with the page, not in a box of its own: a nested scrollbar beside the
          page's left the side cards and the table scrolling apart (2026-09-18). The headings stay
          in sight under the sticky top bar (48 px); `overflow-clip` on the card, unlike `hidden`,
          does not make it a scroll container that would catch them. */}
      <div className="max-md:hidden [&_thead_th]:sticky [&_thead_th]:top-12 [&_thead_th]:z-[2] [&_thead_th]:bg-card">
        {/* A fixed layout: the checkbox, the date, the amount and the menu have their widths, the
            account and the category a share, and the payee what is left — every text column
            truncates instead of pushing the table past its column. With an automatic layout the
            longest name set the width, and real names (a 40-character category, a card-terminal
            payee) gave the table a sideways scrollbar at every width (2026-09-18). */}
        <Table className="table-fixed">
          <colgroup>
            <col className="w-10" />
            <col className="w-[104px]" />
            <col />
            <col className="w-[15%]" />
            <col className="w-[20%]" />
            <col className="w-[120px]" />
            <col className="w-12" />
          </colgroup>
          <THead>
            <Th>
              <Checkbox
                label=""
                aria-label={t("selection.all")}
                checked={allChosen}
                disabled={pending}
                onChange={() => setSelection(allChosen ? [] : rows.map((row) => row.id))}
              />
            </Th>
            {COLUMNS.map((column) => (
              <Th
                key={column.name}
                align={column.align}
                sort={{
                  direction: column.name === sort ? direction : null,
                  onSort: () => sortBy(column.name),
                }}
              >
                {t(`columns.${column.name}`)}{" "}
                <span className="sr-only">
                  {nextDirection(column.name, sort, direction) === "asc"
                    ? t("sort.ascending")
                    : t("sort.descending")}
                </span>
              </Th>
            ))}
            <Th align="right">
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.label !== null && (
                  <GroupRow
                    colSpan={COLUMN_COUNT}
                    label={group.label}
                    summary={t("group.summary", { count: group.count, total: group.total })}
                  />
                )}
                {group.rows.map((row) => (
                  <Tr
                    key={row.id}
                    id={domId(row.id)}
                    tabIndex={-1}
                    selected={selection.includes(row.id)}
                    className={cn(
                      "focus:outline-1 focus:-outline-offset-1 focus:outline-accent",
                      row.hidden && "opacity-60",
                    )}
                  >
                    <Td>
                      <Checkbox
                        label=""
                        aria-label={payeeLabel(row)}
                        checked={selection.includes(row.id)}
                        disabled={pending}
                        onChange={() => toggle(row.id)}
                      />
                    </Td>
                    <Td muted className="text-sm">
                      {row.date}
                    </Td>
                    <Td>
                      <span className="flex min-w-0 items-center gap-2">
                        {/* Truncated when the column is short: the whole name is on hover. */}
                        <span className="min-w-0 truncate font-medium" title={payeeLabel(row)}>
                          {payeeLabel(row)}
                        </span>
                        {badges(row)}
                      </span>
                      {details(row)}
                    </Td>
                    <Td muted className="text-sm">
                      <span className="block truncate" title={row.account}>
                        {row.account}
                      </span>
                    </Td>
                    <Td>{categoryTrigger(row, "table")}</Td>
                    <Td align="right" className={cn("font-medium", TONE_TEXT[row.amountTone])}>
                      {row.amount}
                    </Td>
                    <Td align="right">{rowMenu(row, "table")}</Td>
                  </Tr>
                ))}
              </Fragment>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col md:hidden">
        {groups.map((group) => (
          <li key={group.key}>
            {group.label !== null && (
              <div className="flex items-center justify-between border-y border-border bg-bg px-4 py-1.5 text-sm">
                <span className="font-semibold">{group.label}</span>
                <span className="text-muted">
                  {t("group.summary", { count: group.count, total: group.total })}
                </span>
              </div>
            )}
            <ul className="flex flex-col">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-start gap-3 border-b border-border px-4 py-2.5",
                    selection.includes(row.id) && "bg-sel",
                    row.hidden && "opacity-60",
                  )}
                >
                  <span className="pt-1">
                    <Checkbox
                      label=""
                      aria-label={payeeLabel(row)}
                      checked={selection.includes(row.id)}
                      disabled={pending}
                      onChange={() => toggle(row.id)}
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{payeeLabel(row)}</span>
                      <span className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[row.amountTone])}>
                        {row.amount}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      <span>{row.date}</span>
                      <span aria-hidden>·</span>
                      <span className="min-w-0 truncate">{row.account}</span>
                      {badges(row)}
                    </span>
                    {details(row)}
                    <span className="flex items-center justify-between gap-2">
                      {categoryTrigger(row, "list")}
                      {rowMenu(row, "list")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

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

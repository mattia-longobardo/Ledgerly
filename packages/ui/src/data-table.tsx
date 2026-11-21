// A table that is a list of cards on a phone (audit UI-SET-5): the columns are declared once, and the
// same cells draw the table from `md` and one card per row below it — no screen writes a table twice.
import { Fragment, type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "./table";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  muted?: boolean;
  /** Classes of the cell, in the table and on the card; a function for classes that follow the row. */
  className?: string | ((row: T) => string);
  /** The width class of the column's `<col>`: a table with one is laid out fixed. */
  width?: string;
  /** The heading orders the list (see `Th`). */
  sort?: { direction: "asc" | "desc" | null; onSort: () => void };
  /** The header is for screen readers only (a column of commands). */
  hiddenHeader?: boolean;
  /** The cell names its row (`<th scope="row">`): the month of a register, say. */
  rowHeader?: boolean;
  /**
   * How the card shows the cell: the row's name (`title`), a line of its own (`line`), a line after
   * the column's name (`labelled`), or a command (`action`).
   */
  card?: "title" | "line" | "labelled" | "action";
}

/** A run of rows under a heading (a month): a heading row in the table, a heading line on the cards. */
interface DataGroup<T> {
  key: string;
  /** No label: the rows follow without a heading. */
  label: string | null;
  summary?: ReactNode;
  rows: readonly T[];
  /** Rows of the table after the group's own (its totals); the cards have `cardFooter`. */
  footer?: ReactNode;
  /** A line of the cards after the group's own. */
  cardFooter?: ReactNode;
}

const classOf = <T,>(column: DataColumn<T>, row: T) =>
  typeof column.className === "function" ? column.className(row) : column.className;

/** A header that stays on top of its rows, with the line under it that the rows' borders draw. */
const STICKY_HEAD = "sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--color-border)]";

const CARD = "flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0";

function CardCell<T>({ column, row }: { column: DataColumn<T>; row: T }) {
  const className = classOf(column, row);
  const tone = cn("text-sm", column.muted && "text-muted", className);
  switch (column.card ?? "line") {
    case "title":
      return <span className={cn("min-w-0 font-medium break-words", className)}>{column.cell(row)}</span>;
    case "labelled":
      return (
        <span className={tone}>
          {column.header} {column.cell(row)}
        </span>
      );
    case "action":
      return <div>{column.cell(row)}</div>;
    default:
      return <span className={cn(tone, "break-all")}>{column.cell(row)}</span>;
  }
}

function TableCell<T>({ column, row }: { column: DataColumn<T>; row: T }) {
  if (column.rowHeader)
    return (
      <th
        scope="row"
        className={cn("px-2 text-left font-medium whitespace-nowrap first:pl-4", classOf(column, row))}
      >
        {column.cell(row)}
      </th>
    );
  return (
    <Td align={column.align} muted={column.muted} className={classOf(column, row)}>
      {column.cell(row)}
    </Td>
  );
}

type RowProps = HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; "data-testid"?: string };

type DataTableProps<T> = {
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  rowClassName?: string;
  /** Attributes of each table row (id, focus, selection, handlers). */
  rowProps?: (row: T) => RowProps;
  /** The whole card of a row, in place of its cells one per line. */
  card?: (row: T) => ReactNode;
  /** Attributes of each card; its `className` replaces the default one. */
  cardProps?: (row: T) => LiHTMLAttributes<HTMLLIElement>;
  /** Classes of the box around the table (it is hidden below `md` whatever they are). */
  frameClassName?: string;
  /** The names a test finds the table and the list by. */
  testIds?: { table: string; list: string };
  /** The table's `<tfoot>` (a totals row); the cards have none. */
  footer?: ReactNode;
  /** The header stays at the top of the frame while its rows scroll (the frame sets the height). */
  stickyHeader?: boolean;
} & ({ rows: readonly T[]; groups?: never } | { groups: readonly DataGroup<T>[]; rows?: never });

function TableView<T>({
  columns,
  rows,
  groups,
  rowKey,
  rowClassName,
  rowProps,
  frameClassName = "overflow-x-auto",
  testIds,
  footer,
  stickyHeader,
}: DataTableProps<T>) {
  const widths = columns.some((column) => column.width !== undefined);
  const tableRow = (row: T) => {
    const { className, ...props } = rowProps?.(row) ?? {};
    return (
      <Tr key={rowKey(row)} className={cn(rowClassName, className)} {...props}>
        {columns.map((column) => (
          <TableCell key={column.key} column={column} row={row} />
        ))}
      </Tr>
    );
  };
  return (
    <div data-testid={testIds?.table} className={cn(frameClassName, "max-md:hidden")}>
      <Table className={widths ? "table-fixed" : undefined}>
        {widths && (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} className={column.width} />
            ))}
          </colgroup>
        )}
        <THead className={stickyHeader ? STICKY_HEAD : undefined}>
          {columns.map((column) => (
            <Th key={column.key} align={column.align} sort={column.sort}>
              {column.hiddenHeader ? <span className="sr-only">{column.header}</span> : column.header}
            </Th>
          ))}
        </THead>
        <TBody>
          {groups
            ? groups.map((group) => (
                <Fragment key={group.key}>
                  {group.label !== null && (
                    <GroupRow colSpan={columns.length} label={group.label} summary={group.summary} />
                  )}
                  {group.rows.map(tableRow)}
                  {group.footer}
                </Fragment>
              ))
            : rows.map(tableRow)}
        </TBody>
        {footer && <tfoot>{footer}</tfoot>}
      </Table>
    </div>
  );
}

function CardList<T>({ columns, rows, groups, rowKey, card, cardProps, testIds }: DataTableProps<T>) {
  const cardRow = (row: T) => {
    const { className, ...props } = cardProps?.(row) ?? {};
    return (
      <li key={rowKey(row)} className={className ?? CARD} {...props}>
        {card ? card(row) : columns.map((column) => <CardCell key={column.key} column={column} row={row} />)}
      </li>
    );
  };
  return (
    <ul data-testid={testIds?.list} className="flex flex-col md:hidden">
      {groups
        ? groups.map((group) => (
            <li key={group.key}>
              {group.label !== null && (
                <div className="flex items-center justify-between border-y border-border bg-bg px-4 py-1.5 text-sm">
                  <span className="font-semibold">{group.label}</span>
                  <span className="text-muted">{group.summary}</span>
                </div>
              )}
              <ul className="flex flex-col">{group.rows.map(cardRow)}</ul>
              {group.cardFooter}
            </li>
          ))
        : rows.map(cardRow)}
    </ul>
  );
}

/** The table from `md`, one card per row below it; `groups` puts the rows under headings. */
export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <>
      <TableView {...props} />
      <CardList {...props} />
    </>
  );
}

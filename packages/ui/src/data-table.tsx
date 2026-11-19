// A table that is a list of cards on a phone (audit UI-SET-5): the columns are declared once, and the
// same cells draw the table from `md` and one card per row below it — no screen writes a table twice.
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Table, TBody, Td, Th, THead, Tr } from "./table";

interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  muted?: boolean;
  /** Classes of the cell, in the table and on the card. */
  className?: string;
  /** The header is for screen readers only (a column of commands). */
  hiddenHeader?: boolean;
  /**
   * How the card shows the cell: the row's name (`title`), a line of its own (`line`), a line after
   * the column's name (`labelled`), or a command (`action`).
   */
  card?: "title" | "line" | "labelled" | "action";
}

function CardCell<T>({ column, row }: { column: DataColumn<T>; row: T }) {
  const tone = cn("text-sm", column.muted && "text-muted", column.className);
  switch (column.card ?? "line") {
    case "title":
      return (
        <span className={cn("min-w-0 font-medium break-words", column.className)}>{column.cell(row)}</span>
      );
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

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  testIds,
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowClassName?: string;
  /** The names a test finds the table and the list by. */
  testIds?: { table: string; list: string };
}) {
  return (
    <>
      <div data-testid={testIds?.table} className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            {columns.map((column) => (
              <Th key={column.key} align={column.align}>
                {column.hiddenHeader ? <span className="sr-only">{column.header}</span> : column.header}
              </Th>
            ))}
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={rowKey(row)} className={rowClassName}>
                {columns.map((column) => (
                  <Td key={column.key} align={column.align} muted={column.muted} className={column.className}>
                    {column.cell(row)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
      <ul data-testid={testIds?.list} className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            {columns.map((column) => (
              <CardCell key={column.key} column={column} row={row} />
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

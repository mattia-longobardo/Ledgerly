// The card «performance» (audit UI-INV-3): its title and note, the choice of view, the chart or why
// there is none, the legend, and the chart's data as a table a screen reader can walk. The home of
// Investments and a service's Overview draw it the same; every figure is the caller's, written.
import type { ReactNode } from "react";
import { Card } from "./card";
import { Table, TBody, Td, Th, THead, Tr } from "./table";

export interface PerformanceData {
  /** The words of the `<summary>` that opens the table. */
  summary: string;
  head: readonly { key: string; label: string; align?: "left" | "right" }[];
  rows: readonly {
    key: string;
    cells: readonly { text: string; align?: "left" | "right"; className?: string }[];
  }[];
}

export function PerformanceCard({
  title,
  note,
  views,
  children,
  legend,
  data,
}: {
  title: string;
  note: string;
  /** The view's tabs, beside the title. */
  views: ReactNode;
  /** The chart, or the line that says why there is none. */
  children: ReactNode;
  legend: ReactNode;
  /** The chart's numbers; null when the chart has none to show. */
  data: PerformanceData | null;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{note}</p>
        </div>
        {views}
      </div>
      {children}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">{legend}</p>
      {data && (
        <details className="text-sm">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted hover:text-fg">
            {data.summary}
          </summary>
          <Table className="mt-2">
            <THead>
              {data.head.map((cell) => (
                <Th key={cell.key} align={cell.align}>
                  {cell.label}
                </Th>
              ))}
            </THead>
            <TBody>
              {data.rows.map((row) => (
                <Tr key={row.key}>
                  {row.cells.map((cell, index) => (
                    <Td key={index} align={cell.align} className={cell.className}>
                      {cell.text}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </details>
      )}
    </Card>
  );
}

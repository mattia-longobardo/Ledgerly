"use client";

import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Td } from "@/ui/table";
import type { SummedField } from "../rules";
import { type RegisterGroup, STATE_TONE } from "./present";

const MAIN: readonly SummedField[] = ["gross", "taxesTotal", "employeeSocial", "netPay"];
const DETAILS: readonly SummedField[] = [
  "irpefGross",
  "taxDeductions",
  "regionalInstallment",
  "substituteTax",
  "refund730",
  "welfareCash",
  "employeeFundEffective",
  "employerFundEffective",
  "tfrSelected",
];
const LABEL: Record<SummedField, string> = {
  gross: "gross",
  taxesTotal: "taxes",
  employeeSocial: "social",
  netPay: "net",
  irpefGross: "irpefGross",
  taxDeductions: "deductions",
  regionalInstallment: "surtax",
  substituteTax: "substitute",
  refund730: "refund730",
  welfareCash: "welfare",
  employeeFundEffective: "fundYou",
  employerFundEffective: "fundEmployer",
  tfrSelected: "tfr",
};

const HEAD = "h-8 px-2 text-sm font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4";

/**
 * The register of spec §7.8 (D13): one card as tall as the window below the KPIs, whatever the
 * number of rows, with a fixed header and a group per year with its totals and monthly averages over
 * the applied payslips; detail columns on demand. Below 768 px it is a list (spec §8.2).
 */
export function RegisterTable({ groups }: { groups: RegisterGroup[] }) {
  const t = useTranslations("payroll");
  const [details, setDetails] = useState(false);
  const columns = details ? [...MAIN, ...DETAILS] : MAIN;
  const span = 1 + columns.length + (details ? 2 : 0) + 3;

  return (
    <section aria-label={t("register.label")} className="flex min-h-0 flex-col gap-2">
      <div className="flex justify-end max-md:hidden">
        <Button size="xs" variant="ghost" onClick={() => setDetails((value) => !value)} aria-pressed={details}>
          {details ? t("register.hideDetails") : t("register.details")}
        </Button>
      </div>
      <div className="h-[calc(100dvh-280px)] min-h-64 overflow-auto rounded-card border border-border bg-card max-md:hidden">
        <table className="w-full border-collapse text-base">
          <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--color-border)]">
            <tr>
              <th scope="col" className={cn(HEAD, "text-left")}>
                {t("register.month")}
              </th>
              {columns.map((field) => (
                <th key={field} scope="col" className={cn(HEAD, "text-right")}>
                  {t(`register.${LABEL[field]}` as never)}
                </th>
              ))}
              {details && (
                <>
                  <th scope="col" className={cn(HEAD, "text-right")}>
                    {t("register.vacationLeft")}
                  </th>
                  <th scope="col" className={cn(HEAD, "text-right")}>
                    {t("register.rolLeft")}
                  </th>
                </>
              )}
              <th scope="col" className={cn(HEAD, "text-left")}>
                {t("register.document")}
              </th>
              <th scope="col" className={cn(HEAD, "text-left")}>
                {t("register.status")}
              </th>
              <th scope="col" className={cn(HEAD, "text-right")}>
                <span className="sr-only">{t("register.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.year}>
                <tr className="h-7 border-y border-border bg-bg">
                  <th scope="rowgroup" colSpan={span} className="px-4 text-left font-semibold">
                    {group.year}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.id} className={cn("h-8 border-b border-border hover:bg-hover", !row.applied && "text-muted")}>
                    <th scope="row" className="px-2 pl-4 text-left font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {row.month}
                        {row.badge && <Badge tone="accent">{t(`register.${row.badge}` as never)}</Badge>}
                      </span>
                    </th>
                    {columns.map((field) => (
                      <Td key={field} align="right" className={cn(field === "netPay" && row.applied && "font-medium text-pos")}>
                        {row.values[field]}
                      </Td>
                    ))}
                    {details && (
                      <>
                        <Td align="right">{row.vacationLeft}</Td>
                        <Td align="right">{row.rolLeft}</Td>
                      </>
                    )}
                    <Td className="max-w-56 truncate">
                      {row.originalHref ? (
                        <a href={row.originalHref} target="_blank" rel="noopener" className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm text-accent hover:underline">
                          {row.fileName}
                        </a>
                      ) : (
                        <span className="text-sm">{row.fileName}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
  <span className="inline-flex items-center gap-1.5">
                        <Badge tone={STATE_TONE[row.state]}>{t(`states.${row.state}`)}</Badge>
                        {row.warnings > 0 && <Badge tone="warn">{t("register.warningsBadge", { count: row.warnings })}</Badge>}
                      </span>
                        {row.warnings > 0 && (
                          <span title={t("register.warningsHint")}>
                            <Badge tone="warn">{t("register.warningsBadge", { count: row.warnings })}</Badge>
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td align="right">
                      <Link
                        href={row.href as Route}
                        className="focus-ring inline-flex h-6 items-center rounded-[5px] border border-border bg-card px-2 text-sm font-medium text-fg hover:bg-hover"
                      >
                        {row.applied ? t("register.open") : t("register.review")}
                      </Link>
                    </Td>
                  </tr>
                ))}
                {group.hasApplied && (
                  <>
                    <tr className="h-8 border-b border-border bg-bg font-semibold">
                      <th scope="row" className="px-2 pl-4 text-left whitespace-nowrap">
                        {t("register.total", { year: group.year })}
                      </th>
                      {columns.map((field) => (
                        <Td key={field} align="right">
                          {group.totals[field]}
                        </Td>
                      ))}
                      <td colSpan={span - 1 - columns.length} />
                    </tr>
                    <tr className="h-8 border-b border-border bg-bg text-muted">
                      <th scope="row" className="px-2 pl-4 text-left font-medium whitespace-nowrap">
                        {t("register.average")}
                      </th>
                      {columns.map((field) => (
                        <Td key={field} align="right">
                          {group.averages[field]}
                        </Td>
                      ))}
                      <td colSpan={span - 1 - columns.length} />
                    </tr>
                  </>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-4 md:hidden" aria-label={t("register.label")}>
        {groups.map((group) => (
          <li key={group.year} className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-muted">{group.year}</h2>
            <ul className="divide-y divide-border rounded-card border border-border bg-card">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <Link href={row.href as Route} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {row.month}
                        {row.badge && <Badge tone="accent">{t(`register.${row.badge}` as never)}</Badge>}
                      </span>
                      <span className="text-sm text-muted">
                        {t("register.gross")} {row.values.gross}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="font-medium tabular-nums">{row.values.netPay}</span>
                      <Badge tone={STATE_TONE[row.state]}>{t(`states.${row.state}`)}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {group.hasApplied && (
              <p className="flex justify-between px-1 text-sm text-muted">
                <span>{t("register.total", { year: group.year })}</span>
                <span className="font-medium text-fg tabular-nums">{group.totals.netPay}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

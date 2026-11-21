"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { funds } from "@ledgerly/api-contract/funds";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Loaded } from "@ledgerly/ui/loaded";
import type { SectionApiQuery } from "@ledgerly/ui/period";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { DeleteValuation, EditValuationButton } from "./fund-forms";
import { valuationDraft } from "./present";
import { type Say, useSay } from "@/platform/say";
import { cents } from "./wire-forms";

type Valuations = RouteOutput<typeof funds.getFundValuations>;
type ValuationLine = Valuations["lines"][number];
type Statement = Valuations["statements"][number];

interface TabProps {
  fundId: string;
  archived: boolean;
  /** The period of the address, as the API takes it. */
  period: SectionApiQuery;
  when: string;
  /** "Update value", for the empty state of a fund that never had a value (§10.5). */
  updateValue?: ReactNode;
}

/**
 * The Values tab (docs/design/funds-ux.md §6, F4; rewrite plan, ux/n6-pension-fund.md §5.4), read from
 * `GET /funds/{id}/valuations` (rewrite plan R3): one line per value of the period, with the stretch
 * that ends on it. The return of a stretch appears only here, and its label says what it is: the
 * return of the period is the one in the Overview. Under it, read only, the positions a statement
 * stated before release N6: a new value enters with "Update value" alone.
 */
export function FundValuations(props: TabProps) {
  const read = useLatest(
    useApi(funds.getFundValuations, { params: { id: props.fundId }, query: props.period }),
  );
  const say = useSay();
  return (
    <Loaded state={read}>
      {(valuations) => (
        <Loaded state={say}>
          {(words) => <ValuationsBody {...props} valuations={valuations} say={words} />}
        </Loaded>
      )}
    </Loaded>
  );
}

function ValuationsBody({
  fundId,
  archived,
  when,
  updateValue = null,
  valuations,
  say,
}: TabProps & { valuations: Valuations; say: Say }) {
  const t = useTranslations("funds.fund.valuations");
  const th = useTranslations("funds.home");
  const { lines, recorded, valuesEver, lastValue, best, worst, statements } = valuations;
  const money = (amount: string | null) => formatMoney(cents(amount), say.format);
  const signed = (amount: string | null) => formatMoney(cents(amount), say.format, { signed: true });
  const percent = (value: number | null) =>
    value === null ? NULL_DISPLAY : formatPercent(value, say.format, { signed: true });
  const long = (on: string | null) => formatDate(on, "long", say.locale);
  const tone = (amount: string | null) => TONE_TEXT[toneOfSign(cents(amount))];
  const recordedBy = new Map(recorded.map((row) => [row.id, row]));

  const fromText = (line: ValuationLine) =>
    line.kind === "stretch"
      ? t("from", { date: long(line.fromOn) })
      : line.kind === "first"
        ? t("fromNothing")
        : t("position");
  const actions = (line: ValuationLine) => {
    const row = line.valuationId === null ? undefined : recordedBy.get(line.valuationId);
    if (!row || archived) return null;
    return (
      <span className="flex justify-end gap-1">
        <EditValuationButton
          fundId={fundId}
          draft={valuationDraft(row, say.format)}
          today={say.todayOn}
          label={t("edit")}
        />
        <DeleteValuation fundId={fundId} valuationId={row.id} label={t("delete")} toast={t("deleted")} />
      </span>
    );
  };

  const lineColumns: DataColumn<ValuationLine>[] = [
    {
      key: "date",
      header: t("date"),
      cell: (line) => (
        <span className="flex flex-col">
          <span className="font-medium whitespace-nowrap">{long(line.on)}</span>
          <span className="text-sm text-muted">{fromText(line)}</span>
        </span>
      ),
    },
    {
      key: "value",
      header: t("value"),
      align: "right",
      className: "font-semibold",
      cell: (line) => money(line.value),
    },
    {
      key: "paid",
      header: t("paid"),
      align: "right",
      muted: true,
      cell: (line) => (line.paid === null ? NULL_DISPLAY : money(line.paid)),
    },
    {
      key: "gain",
      header: t("gain"),
      align: "right",
      className: (line) => tone(line.gain),
      cellProps: (line) => ({
        "data-testid": "line-gain",
        "data-cents": line.gain === null ? "" : String(cents(line.gain)),
      }),
      cell: (line) => (line.gain === null ? NULL_DISPLAY : signed(line.gain)),
    },
    {
      key: "rate",
      header: t("rate"),
      align: "right",
      className: (line) => cn(line.rate !== null && tone(line.gain)),
      cellProps: () => ({ "data-testid": "line-rate" }),
      cell: (line) => percent(line.rate),
    },
    { key: "actions", header: t("edit"), hiddenHeader: true, align: "right", cell: actions },
  ];
  const statementColumns: DataColumn<Statement>[] = [
    { key: "date", header: t("date"), muted: true, cell: (one) => long(one.on) },
    {
      key: "value",
      header: t("value"),
      align: "right",
      className: "font-semibold",
      cell: (one) => money(one.value),
    },
    { key: "you", header: t("statements.you"), align: "right", cell: (one) => money(one.worker) },
    { key: "employer", header: t("statements.employer"), align: "right", cell: (one) => money(one.employer) },
    { key: "tfr", header: t("statements.tfr"), align: "right", cell: (one) => money(one.tfr) },
    { key: "inflows", header: t("statements.inflows"), align: "right", cell: (one) => money(one.inflows) },
    { key: "outflows", header: t("statements.outflows"), align: "right", cell: (one) => money(one.outflows) },
    {
      key: "gain",
      header: t("statements.gain"),
      align: "right",
      className: (one) => tone(one.reportedGain),
      cell: (one) => (one.reportedGain === null ? NULL_DISPLAY : signed(one.reportedGain)),
    },
  ];

  return (
    <>
      <Card padded={false} className="min-w-0" data-testid="fund-valuations">
        <CardHeader
          title={t("title")}
          actions={<span className="text-sm text-muted">{t("count", { count: lines.length })}</span>}
        />
        {lines.length === 0 ? (
          <div className="flex flex-col gap-1 px-4 pb-4 text-sm text-muted" data-testid="valuations-empty">
            <p>{valuesEver === 0 ? t("noneEver") : t("noneIn", { when })}</p>
            {lastValue && (
              <p>{t("lastValue", { value: money(lastValue.value), date: long(lastValue.on) })}</p>
            )}
            {lastValue && valuations.lastValueClosesPrevious && (
              <p data-testid="closing-note">{th("closingNote", { date: long(lastValue.on) })}</p>
            )}
            {valuesEver === 0 && updateValue && <div className="pt-1">{updateValue}</div>}
          </div>
        ) : (
          <>
            <DataTable
              columns={lineColumns}
              rows={lines}
              rowKey={(line) => line.on}
              rowProps={(line) => ({ "data-testid": "valuation-line", "data-on": line.on })}
              cardProps={(line) => ({ "data-testid": "valuation-item", "data-on": line.on })}
              card={(line) => (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{long(line.on)}</span>
                      <span className="text-sm text-muted">{fromText(line)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(line.value)}</span>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm tabular-nums">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("paid")}</dt>
                      <dd>{line.paid === null ? NULL_DISPLAY : money(line.paid)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("gain")}</dt>
                      <dd className={tone(line.gain)}>
                        {line.gain === null ? NULL_DISPLAY : signed(line.gain)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("rate")}</dt>
                      <dd className={cn(line.rate !== null && tone(line.gain))}>{percent(line.rate)}</dd>
                    </div>
                  </dl>
                  {actions(line)}
                </>
              )}
            />

            <div className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm text-muted">
              <p data-testid="stretch-rate-note">{t("rateNote")}</p>
              {best && worst && best.on !== worst.on && (
                <p data-testid="best-worst">
                  {t("bestWorst", {
                    best: percent(best.rate),
                    bestOn: long(best.on),
                    worst: percent(worst.rate),
                    worstOn: long(worst.on),
                  })}
                </p>
              )}
              {valuesEver === 1 && <p>{t("needsSecond")}</p>}
              {(cents(valuations.notInValue) ?? 0n) > 0n && (
                <p>{t("notInValue", { amount: money(valuations.notInValue) })}</p>
              )}
            </div>
          </>
        )}
      </Card>

      {statements.length > 0 && (
        <Card padded={false} className="min-w-0" data-testid="fund-statements">
          <CardHeader title={t("read.title")} />
          <DataTable
            columns={statementColumns}
            rows={statements}
            rowKey={(one) => one.id}
            rowProps={() => ({ "data-testid": "statement-line" })}
            cardProps={() => ({ "data-testid": "statement-line-item" })}
            card={(one) => (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted">{long(one.on)}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(one.value)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                  {statementColumns.slice(2).map((column) => (
                    <span
                      key={column.key}
                      className={column.key === "gain" ? tone(one.reportedGain) : undefined}
                    >
                      {column.header} {column.cell(one)}
                    </span>
                  ))}
                </div>
              </>
            )}
          />
          <p className="border-t border-border px-4 py-3 text-sm text-muted">{t("read.note")}</p>
        </Card>
      )}
    </>
  );
}

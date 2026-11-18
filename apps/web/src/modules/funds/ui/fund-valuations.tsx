import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/platform/money";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { ValuationRow } from "@ledgerly/domain/funds";
import type { FundDetail } from "@ledgerly/domain/funds";
import { bestAndWorst, closesPeriodBefore, readsPeriod, type ValuationLine } from "@ledgerly/domain/funds";
import type { FundPeriod } from "@ledgerly/domain/funds";
import { DeleteValuation, EditValuationButton } from "./fund-forms";
import { valuationDraft } from "./present";

/**
 * The Values tab (docs/design/funds-ux.md §6, F4; rewrite plan, ux/n6-pension-fund.md §5.4): one line per
 * value of the period, with the stretch that ends on it. The return of a stretch appears only here, and its
 * label says what it is: the return of the period is the one in the Overview. Under it, read only, the
 * positions a statement stated before release N6: a new value enters with "Update value" alone.
 */
export async function FundValuations({
  ctx,
  fundId,
  archived,
  period,
  lines,
  recorded,
  valuesEver,
  lastValue,
  notInValueCents,
  when,
  todayOn,
  detail,
  updateValue = null,
}: {
  ctx: Ctx;
  fundId: string;
  archived: boolean;
  period: FundPeriod;
  lines: readonly ValuationLine[];
  /** The values a person recorded: only these can be edited. */
  recorded: readonly ValuationRow[];
  /** How many values the fund has, in any period. */
  valuesEver: number;
  lastValue: { on: CivilDate; cents: Cents } | null;
  notInValueCents: Cents;
  when: string;
  todayOn: CivilDate;
  detail: FundDetail;
  /** "Update value", for the empty state of a fund that never had a value (§10.5). */
  updateValue?: ReactNode;
}) {
  const t = await getTranslations("funds.fund.valuations");
  const th = await getTranslations("funds.home");
  const money = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat);
  const signed = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat, { signed: true });
  const percent = (value: number | null) =>
    value === null ? NULL_DISPLAY : formatPercent(value, ctx.numberFormat, { signed: true });
  const long = (on: string | null) => formatDate(on, "long", ctx.locale);
  const recordedOn = new Map(recorded.map((row) => [row.on, row]));
  const { best, worst } = bestAndWorst(lines);

  const fromText = (line: ValuationLine) =>
    line.kind === "stretch"
      ? t("from", { date: long(line.fromOn) })
      : line.kind === "first"
        ? t("fromNothing")
        : t("position");
  const actions = (line: ValuationLine) => {
    const row = recordedOn.get(line.on);
    if (!row || archived) return null;
    return (
      <span className="flex justify-end gap-1">
        <EditValuationButton
          fundId={fundId}
          draft={valuationDraft(row, ctx.numberFormat)}
          today={todayOn}
          label={t("edit")}
        />
        <DeleteValuation fundId={fundId} valuationId={row.id} label={t("delete")} toast={t("deleted")} />
      </span>
    );
  };

  const statements = detail.snapshots.filter((one) => readsPeriod(one.valuationDate, period));

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
              <p>{t("lastValue", { value: money(lastValue.cents), date: long(lastValue.on) })}</p>
            )}
            {lastValue && closesPeriodBefore(lastValue.on, period) && (
              <p data-testid="closing-note">{th("closingNote", { date: long(lastValue.on) })}</p>
            )}
            {valuesEver === 0 && updateValue && <div className="pt-1">{updateValue}</div>}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto @5xl:block">
              <Table>
                <THead>
                  <Th>{t("date")}</Th>
                  <Th align="right">{t("value")}</Th>
                  <Th align="right">{t("paid")}</Th>
                  <Th align="right">{t("gain")}</Th>
                  <Th align="right">{t("rate")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("edit")}</span>
                  </Th>
                </THead>
                <TBody>
                  {lines.map((line) => (
                    <Tr key={line.on} data-testid="valuation-line" data-on={line.on}>
                      <Td>
                        <span className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">{long(line.on)}</span>
                          <span className="text-sm text-muted">{fromText(line)}</span>
                        </span>
                      </Td>
                      <Td align="right" className="font-semibold">
                        {money(line.valueCents)}
                      </Td>
                      <Td align="right" muted>
                        {line.paidCents === null ? NULL_DISPLAY : money(line.paidCents)}
                      </Td>
                      <Td
                        align="right"
                        data-testid="line-gain"
                        data-cents={line.gainCents === null ? "" : String(line.gainCents)}
                        className={TONE_TEXT[toneOfSign(line.gainCents)]}
                      >
                        {line.gainCents === null ? NULL_DISPLAY : signed(line.gainCents)}
                      </Td>
                      <Td
                        align="right"
                        data-testid="line-rate"
                        className={cn(line.rate !== null && TONE_TEXT[toneOfSign(line.gainCents)])}
                      >
                        {percent(line.rate)}
                      </Td>
                      <Td align="right">{actions(line)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>

            <ul className="flex flex-col @5xl:hidden">
              {lines.map((line) => (
                <li
                  key={line.on}
                  data-testid="valuation-item"
                  data-on={line.on}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{long(line.on)}</span>
                      <span className="text-sm text-muted">{fromText(line)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(line.valueCents)}</span>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm tabular-nums">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("paid")}</dt>
                      <dd>{line.paidCents === null ? NULL_DISPLAY : money(line.paidCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("gain")}</dt>
                      <dd className={TONE_TEXT[toneOfSign(line.gainCents)]}>
                        {line.gainCents === null ? NULL_DISPLAY : signed(line.gainCents)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t("rate")}</dt>
                      <dd className={cn(line.rate !== null && TONE_TEXT[toneOfSign(line.gainCents)])}>
                        {percent(line.rate)}
                      </dd>
                    </div>
                  </dl>
                  {actions(line)}
                </li>
              ))}
            </ul>

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
              {notInValueCents > 0n && <p>{t("notInValue", { amount: money(notInValueCents) })}</p>}
            </div>
          </>
        )}
      </Card>

      {statements.length > 0 && (
        <Card padded={false} className="min-w-0" data-testid="fund-statements">
          <CardHeader title={t("read.title")} />
          <>
            <div className="hidden overflow-x-auto @5xl:block">
              <Table>
                <THead>
                  <Th>{t("date")}</Th>
                  <Th align="right">{t("value")}</Th>
                  <Th align="right">{t("statements.you")}</Th>
                  <Th align="right">{t("statements.employer")}</Th>
                  <Th align="right">{t("statements.tfr")}</Th>
                  <Th align="right">{t("statements.inflows")}</Th>
                  <Th align="right">{t("statements.outflows")}</Th>
                  <Th align="right">{t("statements.gain")}</Th>
                </THead>
                <TBody>
                  {statements.map((one) => (
                    <Tr key={one.id} data-testid="statement-line">
                      <Td muted>{long(one.valuationDate)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(one.valueCents)}
                      </Td>
                      <Td align="right">{money(one.workerCents)}</Td>
                      <Td align="right">{money(one.employerCents)}</Td>
                      <Td align="right">{money(one.tfrCents)}</Td>
                      <Td align="right">{money(one.inflowsCents)}</Td>
                      <Td align="right">{money(one.outflowsCents)}</Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(one.reportedGainCents)]}>
                        {one.reportedGainCents === null ? NULL_DISPLAY : signed(one.reportedGainCents)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col @5xl:hidden">
              {statements.map((one) => (
                <li
                  key={one.id}
                  data-testid="statement-line-item"
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted">{long(one.valuationDate)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(one.valueCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span>
                      {t("statements.you")} {money(one.workerCents)}
                    </span>
                    <span>
                      {t("statements.employer")} {money(one.employerCents)}
                    </span>
                    <span>
                      {t("statements.tfr")} {money(one.tfrCents)}
                    </span>
                    <span>
                      {t("statements.inflows")} {money(one.inflowsCents)}
                    </span>
                    <span>
                      {t("statements.outflows")} {money(one.outflowsCents)}
                    </span>
                    <span className={TONE_TEXT[toneOfSign(one.reportedGainCents)]}>
                      {t("statements.gain")}{" "}
                      {one.reportedGainCents === null ? NULL_DISPLAY : signed(one.reportedGainCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
          <p className="border-t border-border px-4 py-3 text-sm text-muted">{t("read.note")}</p>
        </Card>
      )}
    </>
  );
}

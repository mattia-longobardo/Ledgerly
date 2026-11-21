"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, formatPercent } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { cn } from "@ledgerly/ui/cn";
import { Popover } from "@ledgerly/ui/popover";
import { Link } from "@ledgerly/ui/router";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { type Home, type HomeFund, type HomeWords, type Say, ValuationButton } from "@/modules/funds/client";

type Summary = Home["summary"];

/** A decimal of the wire as the cents `formatMoney` takes. */
export function toCents(amount: string): bigint;
export function toCents(amount: string | null): bigint | null;
export function toCents(amount: string | null): bigint | null {
  return amount === null ? null : parseCents(amount);
}

const moneyOf =
  (say: Say) =>
  (amount: string | null, signed = false) =>
    formatMoney(toCents(amount), say.format, { signed });
const percentOf = (say: Say) => (value: number | null) => formatPercent(value, say.format, { signed: true });
const longOf = (say: Say) => (date: string | null) => formatDate(date, "long", say.locale);

/** The gain of the period, its return, the value line, the notes and the funds with an old value (§6). */
export function Hero({
  home,
  words,
  name,
  open,
}: {
  home: Home;
  words: HomeWords;
  name: string;
  open: readonly HomeFund[];
}) {
  const homeText = useTranslations("funds.home");
  const { state } = home.summary;
  const notes = useHeroNotes(home, words);
  const valueLine = useValueLine(home, words);
  return (
    <section aria-labelledby="funds-gain" className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="funds-gain" className="text-sm font-medium text-muted">
          {state === "partial"
            ? homeText("gainAvailable", { period: name })
            : homeText("gainTitle", { period: name })}
        </h2>
        <HeroFigure summary={home.summary} words={words} />
        {valueLine && <p className="text-sm text-muted">{valueLine}</p>}
        {notes.map((note) => (
          <p key={note} className="text-sm text-muted">
            {note}
          </p>
        ))}
        <RecordValue state={state} open={open} today={words.say.todayOn} />
      </div>
      <StaleLink open={open} words={words} />
    </section>
  );
}

/** The gain of the period in large, and its return. */
function HeroFigure({ summary, words }: { summary: Summary; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { say, when } = words;
  const { state } = summary;
  const percent = percentOf(say);
  const gain = toCents(summary.gain);
  const heroText =
    summary.gain !== null
      ? moneyOf(say)(summary.gain, true)
      : state === "running_no_value"
        ? homeText("noValueYet", { when })
        : state === "quiet"
          ? homeText("noValueIn", { when })
          : homeText("gainUndetermined");
  return (
    <p
      data-testid="funds-hero"
      data-state={state}
      data-cents={gain === null ? "" : String(gain)}
      className="flex flex-wrap items-baseline gap-x-3"
    >
      <span
        className={cn(
          "text-hero leading-tight font-semibold tracking-title tabular-nums",
          TONE_TEXT[toneOfSign(gain)],
        )}
      >
        {heroText}
      </span>
      {summary.rate !== null && (
        <span
          data-testid="funds-rate"
          title={
            summary.xirr?.status === "ok"
              ? homeText("list.xirr", { rate: percent(summary.xirr.rate) })
              : undefined
          }
          className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(summary.rate)])}
        >
          {percent(summary.rate)}
        </span>
      )}
    </p>
  );
}

/** The notes under the gain: what is not measured, what is missing, what is not in the value. */
function useHeroNotes(home: Home, words: HomeWords): string[] {
  const homeText = useTranslations("funds.home");
  const { when } = words;
  const { summary } = home;
  const { state } = summary;
  const unmeasured = home.funds.filter((one) => one.line !== null && one.line.status !== "measured").length;
  const notInValue = toCents(summary.notInValue);
  return [
    state === "partial" ? homeText("partialNote", { count: unmeasured }) : null,
    state === "payslips_only"
      ? home.firstValueOn
        ? homeText("payslipsNote", { when, date: longOf(words.say)(home.firstValueOn) })
        : homeText("payslipsNoValue", { when })
      : null,
    state === "paid_no_value" ? homeText("paidNote", { when }) : null,
    state === "quiet" ? homeText("quietNote", { when }) : null,
    state === "paid_no_value" || state === "running_no_value" ? homeText("recordToMeasure", { when }) : null,
    notInValue > 0n ? homeText("notInValue", { amount: moneyOf(words.say)(summary.notInValue) }) : null,
  ].filter((note) => note !== null);
}

const strong = (chunks: ReactNode) => (
  <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>
);

/** The value of the funds at the end of the period, and the dates of the values it adds up. */
function useValueLine(home: Home, words: HomeWords): ReactNode {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  const { summary, period } = home;
  const money = moneyOf(say);
  const long = longOf(say);
  const day = (date: string | null) => formatDate(date, "dayMonth", say.locale);
  const dates =
    summary.valueFrom === null
      ? ""
      : summary.valueFrom === summary.valueTo
        ? homeText("valuesOn", { date: day(summary.valueFrom) })
        : homeText("valuesBetween", { from: day(summary.valueFrom), to: day(summary.valueTo) });
  const datesLong =
    summary.valueFrom === summary.valueTo
      ? homeText("valuesOn", { date: long(summary.valueTo) })
      : homeText("valuesBetween", { from: long(summary.valueFrom), to: long(summary.valueTo) });
  const measuredAny = summary.state === "measured" || summary.state === "partial";
  if (summary.value === null) return null;
  if (!measuredAny)
    return homeText.rich("lastValue", { value: money(summary.value), dates: datesLong, strong });
  if (period.to < say.todayOn)
    return homeText.rich("valueAtEnd", {
      date: long(period.to),
      value: money(summary.value),
      dates,
      today: money(home.valueToday),
      strong,
    });
  return homeText.rich("valueLine", { value: money(summary.value), count: home.valuesSeen, dates, strong });
}

/** «Record value» on the first fund without a measure, when the period has payments but no value. */
function RecordValue({
  state,
  open,
  today,
}: {
  state: Summary["state"];
  open: readonly HomeFund[];
  today: string;
}) {
  const fundText = useTranslations("funds.fund");
  const firstValueFund =
    open.find((one) => !(one.line !== null && one.line.status === "measured")) ?? open[0] ?? null;
  if (!((state === "paid_no_value" || state === "running_no_value") && firstValueFund)) return null;
  return (
    <div className="pt-1">
      <ValuationButton
        fundId={firstValueFund.id}
        fundName={firstValueFund.name}
        today={today}
        lastLine={null}
        label={fundText("recordValue")}
      />
    </div>
  );
}

/** The funds whose newest value is old, as the server says (`stale`), with the way to each. */
function StaleLink({ open, words }: { open: readonly HomeFund[]; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const day = (date: string | null) => formatDate(date, "dayMonth", words.say.locale);
  const stale = open.filter((one) => one.stale);
  if (stale.length === 0) return null;
  if (stale.length === 1)
    return (
      <Link
        href={words.fundHref(stale[0].id)}
        className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm hover:underline"
      >
        <Badge tone="warn">1</Badge>
        {homeText("stale.one", { name: stale[0].name, date: day(stale[0].lastValueOn) })}
      </Link>
    );
  return (
    <Popover
      triggerLabel={homeText("stale.label", { count: stale.length })}
      trigger={
        <>
          <Badge tone="warn">{stale.length}</Badge>
          {homeText("stale.many", { count: stale.length })}
        </>
      }
    >
      <ul className="flex max-w-80 flex-col">
        {stale.map((one) => (
          <li key={one.id}>
            <Link
              href={words.fundHref(one.id)}
              className="focus-ring flex min-h-8 items-center rounded-sm px-2 text-sm hover:bg-hover"
            >
              {homeText("stale.one", { name: one.name, date: day(one.lastValueOn) })}
            </Link>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

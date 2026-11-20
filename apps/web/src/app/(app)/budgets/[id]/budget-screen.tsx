"use client";

// One budget (spec §7.3), read from `/api/v1` (rewrite plan R3): where this month stands, the months
// before it and when it emails — the thresholds the `budgets-alerts` job checks every hour. Every figure
// is a field of `GET /budgets/{budget}`; the address of the emails is the person's, from `GET /profile`.
import { useTranslations } from "next-intl";
import { budgets } from "@ledgerly/api-contract/budgets";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { monthKey, today } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  formatWholePercent,
  NULL_DISPLAY,
  type NumberFormat,
  numberStyle,
  type UiLocale,
} from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { Stat } from "@ledgerly/ui/stat";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { ALERT_PRESETS } from "@ledgerly/domain/budgets/client";
import { AlertsForm, NO_COLOR } from "@/modules/budgets";

const BAR_TONE = { over: "neg", near: "warn", on_track: "accent" } as const;
const BADGE_TONE = { over: "neg", near: "warn", on_track: "pos" } as const;

type Detail = RouteOutput<typeof budgets.getBudget>;
interface Format {
  locale: UiLocale;
  numberFormat: NumberFormat;
  /** The current month, the one the page speaks of. */
  month: string;
}

function useFormatters(format: Format) {
  return {
    money: (amount: string, decimals = true) =>
      formatMoney(parseCents(amount), format.numberFormat, { decimals }),
    percent: (value: number) => formatWholePercent(value, format.numberFormat),
  };
}

/** This month: the spent figure, the bar, the status, and spent, limit and what is left or over. */
function MonthCard({ detail, name, format }: { detail: Detail; name: string; format: Format }) {
  const text = useTranslations("budgets");
  const { money, percent } = useFormatters(format);
  const { budget } = detail;
  const remaining = parseCents(budget.remaining);
  const over = remaining < 0n;
  const account = budget.account
    ? text("detail.onAccount", { account: budget.account })
    : text("allAccounts");
  const month = formatDate(format.month, "monthYear", format.locale);
  return (
    <Card className="flex flex-col gap-4" data-testid="budget-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-muted">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-xs-plus"
              style={{ background: budget.color ?? NO_COLOR }}
            />
            <span className="truncate">
              {account} · {text("detail.thisMonth", { month })}
            </span>
          </p>
          <p className="text-hero font-semibold tracking-title tabular-nums">{money(budget.spent)}</p>
          <p className="text-sm text-muted">
            {text("detail.progress", { percent: percent(budget.percent) })}
          </p>
        </div>
        <Badge tone={BADGE_TONE[budget.status]}>{text(`status.${budget.status}`)}</Badge>
      </div>
      <ProgressBar
        value={budget.percent / 100}
        tone={BAR_TONE[budget.status]}
        label={text("progressOf", { category: name, percent: percent(budget.percent) })}
      />
      <dl className="grid grid-cols-3 gap-3">
        <Stat className="gap-0.5" label={text("detail.spent")} value={money(budget.spent)} />
        <Stat className="gap-0.5" label={text("detail.limit")} value={money(budget.limit)} />
        <Stat
          className="gap-0.5"
          label={over ? text("detail.over") : text("detail.remaining")}
          value={formatMoney(over ? -remaining : remaining, format.numberFormat)}
          tone={over ? "neg" : undefined}
        />
      </dl>
    </Card>
  );
}

function HistoryRow({ past, format }: { past: Detail["history"][number]; format: Format }) {
  const text = useTranslations("budgets");
  const { money } = useFormatters(format);
  const label = formatDate(past.month, "monthYear", format.locale);
  const pastOver = past.remaining !== null && parseCents(past.remaining) < 0n;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span className={cn("tabular-nums", pastOver ? TONE_TEXT.neg : "text-muted")}>
          {past.limit === null
            ? `${money(past.spent)} · ${text("detail.noLimit")}`
            : `${money(past.spent)} / ${money(past.limit, parseCents(past.limit) % 100n !== 0n)}`}
        </span>
      </div>
      {past.limit !== null && past.percent !== null && (
        <ProgressBar
          value={past.percent / 100}
          tone={pastOver ? "neg" : "accent"}
          label={text("detail.historyRow", {
            month: label,
            spent: money(past.spent),
            limit: money(past.limit),
          })}
        />
      )}
    </li>
  );
}

function AlertsCard({ detail, slug, format }: { detail: Detail; slug: string; format: Format }) {
  const text = useTranslations("budgets");
  const { percent } = useFormatters(format);
  const person = useApi(profile.getProfile, {});
  const percentLabels = Object.fromEntries(
    [...new Set([...ALERT_PRESETS, ...detail.alerts.thresholds])].map((value) => [value, percent(value)]),
  );
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{text("alerts.title")}</h2>
        <p className="text-sm text-muted">
          {text("alerts.description", { email: person.data?.email ?? NULL_DISPLAY })}
        </p>
      </div>
      <AlertsForm
        key={slug}
        scope={{ categoryId: detail.budget.categoryId, accountId: detail.budget.accountId }}
        initial={detail.alerts}
        percentLabels={percentLabels}
      />
    </Card>
  );
}

function BudgetView({ detail, slug, format }: { detail: Detail; slug: string; format: Format }) {
  const text = useTranslations("budgets");
  const name = detail.budget.name ?? text("allCategories");
  return (
    <>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{name}</h1>
      <MonthCard detail={detail} name={name} format={format} />
      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <AlertsCard detail={detail} slug={slug} format={format} />
        <Card padded={false} className="min-w-0" data-testid="budget-history">
          <CardHeader title={text("detail.history")} />
          <ul className="flex flex-col divide-y divide-border px-4 pb-2">
            {detail.history.map((past) => (
              <HistoryRow key={past.month} past={past} format={format} />
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/** A budget's page; the server has already answered 404 for a budget that is not there this month. */
export function BudgetScreen({ slug }: { slug: string }) {
  const text = useTranslations("budgets");
  const prefs = useApi(profile.getPreferences, {}).data;
  const read = useApi(budgets.getBudget, { params: { budget: slug } });
  const name = read.data ? (read.data.budget.name ?? text("allCategories")) : "";
  const format = prefs && {
    locale: prefs.locale,
    numberFormat: numberStyle(prefs),
    month: monthKey(today(prefs.timeZone)),
  };
  return (
    <Page title={name} parent={{ href: "/budgets", label: text("title") }}>
      <Loaded state={read}>
        {(detail) => format && <BudgetView detail={detail} slug={slug} format={format} />}
      </Loaded>
    </Page>
  );
}

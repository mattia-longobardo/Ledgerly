"use client";

// The hero of the Investments home (docs/design/investments-ux.md §3.1, §4.6, §4.8): the P&L of the
// period with how far it can be trusted, the value of today, and what needs a look. Every figure is a
// field of `GET /investments/home`.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { AlertsSummary } from "@ledgerly/ui/alerts-summary";
import { Badge } from "@ledgerly/ui/badge";
import { cn } from "@ledgerly/ui/cn";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { HomeContext } from "./home-view";

/** The state of the number: undetermined, on an old price, or available for part of the services. */
function StatusBadge({ pnl }: { pnl: HomeContext["home"]["pnl"] }) {
  const text = useTranslations("investments");
  if (pnl.status === "undetermined") return <Badge tone="warn">{text("home.status.undetermined")}</Badge>;
  if (pnl.status === "stale") return <Badge tone="neutral">{text("home.status.stale")}</Badge>;
  return pnl.available ? <Badge tone="accent">{text("home.status.partial")}</Badge> : null;
}

/** Which services the number leaves out or reads from a later day, in words. */
function useCoverage(context: HomeContext): string[] {
  const text = useTranslations("investments");
  const { pnl, services } = context.home;
  const nameOf = new Map(services.map((service) => [service.accountId, service.name]));
  return [
    ...pnl.partial.map((row) =>
      text("home.coverage.partial", {
        name: nameOf.get(row.accountId) ?? "",
        date: formatDate(row.from, "dayMonth", context.say.locale),
      }),
    ),
    ...pnl.stale
      .filter((id) => !pnl.partial.some((row) => row.accountId === id))
      .map((id) => text("home.coverage.stale", { name: nameOf.get(id) ?? "" })),
    ...(pnl.excluded.length > 0 ? [text("home.coverage.excluded", { count: pnl.excluded.length })] : []),
  ];
}

/** The services' value today, and their value at the end of a past period. */
function ValueLine({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, money, say } = context;
  return (
    <p className="text-sm text-muted">
      {text.rich("home.hero.value", {
        value: money(home.totals.value),
        count: home.services.length,
        strong: (chunks) => <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>,
      })}
      {home.valueAtEnd !== null && (
        <>
          {" "}
          ·{" "}
          {text("home.hero.valueAt", {
            date: formatDate(home.period.to, "long", say.locale),
            value: money(home.valueAtEnd),
          })}
        </>
      )}
    </p>
  );
}

/** One line per service with something to do (§3.1, P9). */
function useAlerts(context: HomeContext) {
  const text = useTranslations("investments");
  return context.home.services.flatMap((service) => {
    const { warnings } = service;
    const what = [
      warnings.conflicts > 0 && text("warnings.conflict", { count: warnings.conflicts }),
      warnings.pendingZero && text("warnings.pendingZero"),
      warnings.missingPrices > 0 && text("warnings.missingPrices", { count: warnings.missingPrices }),
      warnings.openAdjustments > 0 && text("warnings.openAdjustments", { count: warnings.openAdjustments }),
    ].filter((line) => typeof line === "string");
    return what.length === 0
      ? []
      : [
          {
            key: service.accountId,
            href: context.alertHref(service.accountId),
            text: `${service.name}: ${what.join(", ")}`,
          },
        ];
  });
}

export function HomeHero({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, money, percent, name, say } = context;
  const { pnl, period } = home;
  const hero = pnl.parts?.pnl ?? null;
  const coverage = useCoverage(context);
  const alerts = useAlerts(context);
  return (
    <section aria-labelledby="pnl-title" className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="pnl-title" className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
          {pnl.available
            ? text("home.hero.available", { period: name })
            : text("home.hero.title", { period: name })}
          <StatusBadge pnl={pnl} />
        </h2>
        <p
          data-testid="pnl-hero"
          data-cents={hero === null ? "" : String(centsOf(hero))}
          className="flex flex-wrap items-baseline gap-x-3"
        >
          <span
            className={cn(
              "text-hero leading-tight font-semibold tracking-title tabular-nums",
              TONE_TEXT[toneOfSign(centsOf(hero))],
            )}
          >
            {hero === null ? text("home.hero.undetermined") : money(hero, { signed: true })}
          </span>
          {pnl.modifiedDietz !== null && (
            <span
              className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(pnl.modifiedDietz)])}
            >
              {percent(pnl.modifiedDietz)}
            </span>
          )}
        </p>
        {period.firstOn !== null && period.to < period.firstOn ? (
          <p className="text-sm text-muted">
            {text("home.hero.noData", { date: formatDate(period.firstOn, "long", say.locale) })}
          </p>
        ) : (
          coverage.length > 0 && <p className="text-sm text-muted">{coverage.join(" · ")}</p>
        )}
        <ValueLine context={context} />
      </div>
      <AlertsSummary
        items={alerts}
        one={(item) => text("home.alerts.one", { text: item.text })}
        many={text("home.alerts.many")}
        manyLabel={text("home.alerts.label", { count: alerts.length })}
      />
    </section>
  );
}

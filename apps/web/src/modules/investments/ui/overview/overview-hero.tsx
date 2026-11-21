"use client";

// The hero of a service's Overview (docs/design/investments-ux.md §3.3, §4.5): the very number of its
// row on the home, in the display currency, with the bridge from its own currency, the value, and how
// far it can be trusted. Every figure is a field of `GET /investments/{accountId}`.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { ServicePage } from "../service/service-view";

function StatusBadge({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { pnl } = page.overview;
  if (pnl.status === "undetermined") return <Badge tone="warn">{text("home.status.undetermined")}</Badge>;
  if (pnl.partial && pnl.from)
    return (
      <Badge tone="accent">
        {text("home.status.from", { date: formatDate(pnl.from, "dayMonth", page.say.locale) })}
      </Badge>
    );
  return pnl.status === "stale" ? <Badge tone="neutral">{text("home.status.stale")}</Badge> : null;
}

/** «P&L in USD … on 31 Dec, converted …, of which exchange …»: from the account's currency to the display one. */
function Bridge({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, money, display, say } = page;
  const { pnl, service } = overview;
  if (service.currency === overview.currency || !pnl.local || !pnl.display || pnl.status === "undetermined")
    return null;
  return (
    <p data-testid="pnl-bridge" className="text-sm text-muted tabular-nums">
      {text("service.bridge", {
        local: money(pnl.local.pnl, { signed: true }),
        date: formatDate(pnl.to, "long", say.locale),
        converted: display(pnl.display.beforeFx, { signed: true }),
        fx: display(pnl.display.fx, { signed: true }),
      })}
    </p>
  );
}

function ValueLine({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, money, display, say } = page;
  const { service, pnl, period } = overview;
  const strong = (chunks: React.ReactNode) => (
    <strong data-testid="service-value" className="font-semibold text-fg tabular-nums">
      {chunks}
    </strong>
  );
  const other =
    service.value !== null &&
    service.currency !== overview.currency &&
    service.displayValue !== null &&
    centsOf(service.value) !== 0n;
  return (
    <p className="text-sm text-muted">
      {other
        ? text.rich("service.valueOther", {
            value: money(service.value),
            display: display(service.displayValue),
            strong,
          })
        : text.rich("service.value", {
            value: service.value === null ? text("services.noValue") : money(service.value),
            strong,
          })}
      {period.to < overview.on && pnl.end !== null && (
        <>
          {" · "}
          {text("service.valueAt", {
            date: formatDate(period.to, "long", say.locale),
            value: money(pnl.end),
          })}
        </>
      )}
    </p>
  );
}

/** Why the number may be missing: undetermined, no exchange rate, or a period before any data. */
function HeroNotes({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, say } = page;
  const { pnl, period } = overview;
  return (
    <>
      {pnl.status === "undetermined" && <p className="text-sm text-warn">{text("service.undetermined")}</p>}
      {pnl.status !== "undetermined" && pnl.display === null && (
        <p className="text-sm text-warn">{text("service.noRate", { currency: overview.currency })}</p>
      )}
      {period.firstOn !== null && period.to < period.firstOn && (
        <p className="text-sm text-muted">
          {text("home.hero.noData", { date: formatDate(period.firstOn, "long", say.locale) })}
        </p>
      )}
    </>
  );
}

export function OverviewHero({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, display, percent, name } = page;
  const { pnl } = overview;
  const hero = pnl.display?.pnl ?? null;
  const rate = pnl.displayReturn?.modifiedDietz ?? null;
  return (
    <section aria-labelledby="pnl-title" className="flex flex-col gap-1">
      <h2 id="pnl-title" className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
        {text("home.hero.title", { period: name })}
        <StatusBadge page={page} />
      </h2>
      <p
        data-testid="pnl-hero"
        data-cents={hero === null ? "" : String(centsOf(hero))}
        data-local-cents={pnl.local === null ? "" : String(centsOf(pnl.local.pnl))}
        className="flex flex-wrap items-baseline gap-x-3"
      >
        <span
          className={cn(
            "text-hero leading-tight font-semibold tracking-title tabular-nums",
            TONE_TEXT[toneOfSign(centsOf(hero))],
          )}
        >
          {hero === null ? text("home.hero.undetermined") : display(hero, { signed: true })}
        </span>
        {rate !== null && (
          <span className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(rate)])}>
            {percent(rate)}
          </span>
        )}
      </p>
      <Bridge page={page} />
      <ValueLine page={page} />
      <HeroNotes page={page} />
    </section>
  );
}

/** «P&L from 3 Mar»: the days measured start after the period's (§4.6). */
export function PartialStrip({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { pnl, service } = page.overview;
  if (!pnl.partial || !pnl.from) return null;
  return (
    <p
      data-testid="partial-strip"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] border border-border bg-soft px-3 py-2 text-sm"
    >
      <Badge tone="accent">
        {text("home.status.from", { date: formatDate(pnl.from, "dayMonth", page.say.locale) })}
      </Badge>
      <span>
        {text("service.partial", { date: formatDate(pnl.from, "long", page.say.locale), name: service.name })}
      </span>
      <Link
        href={page.href("connection")}
        className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
      >
        {text("service.partialLink")} →
      </Link>
    </p>
  );
}

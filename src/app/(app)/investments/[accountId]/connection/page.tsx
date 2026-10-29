import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ServiceDetail } from "@/modules/investments/queries";
import {
  ConfirmRevokedButton,
  ConfirmZeroButton,
  ConversionButton,
  ReplaceKeyButton,
  ServiceUrlForm,
  SyncButtons,
  DisconnectButton,
} from "@/modules/investments/ui/dialogs";
import { KeyCheckLine } from "@/modules/investments/ui/key-check";
import { productLabel } from "@/modules/investments/ui/labels";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { instantText, loadService, providerOf, serviceContextOf } from "../service-data";

type Status = "complete" | "partial" | "estimated" | "check" | "missing";

const ICON: Record<Status, typeof CheckCircle2> = {
  complete: CheckCircle2,
  partial: CircleDashed,
  estimated: CircleDashed,
  check: AlertTriangle,
  missing: CircleSlash,
};
const TONE: Record<Status, "pos" | "accent" | "neutral" | "warn"> = {
  complete: "pos",
  partial: "accent",
  estimated: "neutral",
  check: "warn",
  missing: "warn",
};

const ICON_TONE: Record<Status, string> = {
  complete: TONE_TEXT.pos,
  partial: TONE_TEXT.accent,
  estimated: TONE_TEXT.muted,
  check: TONE_TEXT.warn,
  missing: TONE_TEXT.warn,
};

/**
 * A service's Connection (docs/design/investments-ux.md §3.6, U3): what the provider gives, row by
 * row, in words; the readings with the runs of equal ones folded; the manual corrections; the key;
 * the settings. A manual account calls it Settings and has only the last two parts and the
 * corrections. Always "today": no period here (§2.3).
 */
export default async function InvestmentServiceConnection({
  params,
}: PageProps<"/investments/[accountId]/connection">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const t = await getTranslations("investments");
  const detail = await loadService(accountId);
  if (!detail) notFound();
  const { summary, sync } = detail;
  const name = summary.account.name;
  const context = serviceContextOf(detail, ctx);
  const provider = providerOf(detail);
  const synced = summary.origin === "synced";
  const long = (on: string) => formatDate(on, "long", ctx.locale);
  const dayOf = (at: Date) => civilDateIn(at, ctx.timeZone);
  const own = (cents: Cents | null, signed = false) =>
    formatMoney(cents, ctx.numberFormat, { currency: detail.currency, signed });
  const instant = (at: Date) => instantText(at, ctx, (time) => t("header.today", { time }));
  const tp = (key: "products.spot") => t(key);
  const latest = detail.readings[0] ?? null;

  const { warnings } = summary;
  const alerts = [
    warnings.conflicts > 0 && t("warnings.conflict", { count: warnings.conflicts }),
    warnings.pendingZero && t("warnings.pendingZero"),
    warnings.missingPrices > 0 && t("warnings.missingPrices", { count: warnings.missingPrices }),
    warnings.openAdjustments > 0 && t("warnings.openAdjustments", { count: warnings.openAdjustments }),
  ].filter((text): text is string => typeof text === "string");

  return (
    <>
      {alerts.length > 0 && (
        <p
          data-testid="connection-alerts"
          className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-warn-bg px-3 py-2 text-sm"
        >
          <AlertTriangle aria-hidden className="size-4 text-warn" />
          <span className="font-medium">{t("connection.alerts")}:</span>
          <span>{alerts.join(" · ")}</span>
        </p>
      )}
      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {sync && <Received detail={detail} t={t} long={long} dayOf={dayOf} instant={instant} tp={tp} />}
          {sync && (
            <Card padded={false} className="min-w-0" data-testid="sync-history">
              <CardHeader title={t("connection.history.title")} />
              <p className="-mt-2 px-4 pb-2 text-sm text-muted">{t("connection.history.note")}</p>
              {latest?.status === "pending_zero" && (
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  <p className="text-sm text-warn">{t("readings.pendingZero")}</p>
                  <ConfirmZeroButton
                    accountId={accountId}
                    readingId={latest.id}
                    dateLabel={long(latest.on)}
                  />
                </div>
              )}
              <ReadingRuns detail={detail} t={t} long={long} own={own} />
            </Card>
          )}
          <Card padded={false} className="min-w-0" data-testid="corrections">
            <CardHeader title={t("connection.corrections.title")} />
            {detail.adjustments.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t("connection.corrections.empty")}</p>
            ) : (
              <ul className="flex flex-col">
                {detail.adjustments.map((adjustment) => (
                  <li
                    key={adjustment.eventId}
                    className="flex flex-col gap-0.5 border-t border-border px-4 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">{adjustment.note ?? NULL_DISPLAY}</span>
                      <span
                        className={cn(
                          "shrink-0 font-medium tabular-nums",
                          TONE_TEXT[toneOfSign(adjustment.amountCents)],
                        )}
                      >
                        {own(adjustment.amountCents, true)}
                      </span>
                    </div>
                    <span className="flex flex-wrap items-center gap-x-2 text-muted">
                      <span>
                        {long(adjustment.on)} →{" "}
                        {adjustment.validUntil ? long(adjustment.validUntil) : t("adjustments.openEnded")}
                      </span>
                      <Badge tone="neutral">
                        {t(`operationForm.classes.${adjustment.adjustmentClass ?? "data"}`)}
                      </Badge>
                    </span>
                    {adjustment.stale && <span className="text-warn">{t("adjustments.stale")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {sync && (
            <Card className="flex min-w-0 flex-col gap-3" data-testid="service-connection">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{t("connection.key.title")}</h2>
                {sync.connected && (
                  <Badge tone={sync.state === "active" ? "pos" : sync.state === "revoked" ? "neg" : "warn"}>
                    {t(`sync.states.${sync.state ?? "error"}` as "sync.states.active")}
                  </Badge>
                )}
              </div>
              {sync.connected ? (
                <>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted">{t("connection.key.permissions")}</dt>
                    <dd>
                      {sync.lastCheck ? (
                        <KeyCheckLine
                          text={t("sync.keyCheck", {
                            result: t(`sync.results.${sync.lastCheck.result}` as "sync.results.read-only"),
                            date: instant(sync.lastCheck.checkedAt),
                          })}
                          ipRestricted={null}
                        />
                      ) : (
                        NULL_DISPLAY
                      )}
                    </dd>
                    {provider?.ipWhitelist && (
                      <>
                        <dt className="text-muted">{t("connection.key.ip")}</dt>
                        <dd className="flex flex-col">
                          <span>
                            {sync.lastCheck?.ipRestricted
                              ? t("connection.key.ipOn")
                              : t("connection.key.ipOff")}
                          </span>
                          {!sync.lastCheck?.ipRestricted && (
                            <span className="text-muted">{t("connection.key.ipAdvice", { name })}</span>
                          )}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted">{t("sync.lastOk")}</dt>
                    <dd>{sync.lastOkAt ? instant(sync.lastOkAt) : NULL_DISPLAY}</dd>
                    <dt className="text-muted">{t("sync.next")}</dt>
                    <dd>{sync.nextSyncAt ? instant(sync.nextSyncAt) : t("sync.manual")}</dd>
                    <dt className="text-muted">{t("sync.keySet")}</dt>
                    <dd>{sync.keySetAt ? long(dayOf(sync.keySetAt)) : NULL_DISPLAY}</dd>
                  </dl>
                  {sync.lastError && (
                    <p className="text-sm text-warn">{t("sync.lastError", { error: sync.lastError })}</p>
                  )}
                  {sync.rotateDue && <p className="text-sm text-warn">{t("sync.rotate")}</p>}
                  <p className="text-sm text-muted">{t("sync.scheduleNote")}</p>
                  <div className="flex flex-wrap gap-2">
                    <SyncButtons accountId={accountId} />
                    {provider && <ReplaceKeyButton accountId={accountId} provider={provider} />}
                    <DisconnectButton accountId={accountId} name={name} />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">{t("sync.disconnected")}</p>
              )}
              {sync.revokePending && (
                <div className="flex flex-col gap-2 rounded-[6px] border border-border p-3 text-sm">
                  <p className="font-medium">{t("sync.revokeTitle")}</p>
                  <p className="text-muted">{t("sync.revokeSteps")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {provider?.revokeUrl && (
                      <a
                        href={provider.revokeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-[4px] text-accent hover:underline"
                      >
                        {t("sync.revokeOpen")}
                      </a>
                    )}
                    <ConfirmRevokedButton accountId={accountId} />
                  </div>
                </div>
              )}
              {summary.investment.provider === "ccxt:binance" && (
                <p className="text-xs text-muted">{t("sync.binanceBrand")}</p>
              )}
              {summary.investment.provider === "etoro" && (
                <p className="text-xs text-muted">{t("sync.etoroBrand")}</p>
              )}
            </Card>
          )}

          <Card className="flex min-w-0 flex-col gap-3" data-testid="service-settings">
            <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">{t("connection.settings.keeps")}</dt>
              <dd>{summary.mode ? t(`connection.settings.modes.${summary.mode}`) : NULL_DISPLAY}</dd>
              <dt className="text-muted">{t("connection.settings.managedSince")}</dt>
              <dd>{long(summary.investment.managedSince)}</dd>
            </dl>
            {!synced && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-muted">{t("settings.convertNote")}</p>
                <span>
                  <ConversionButton context={context} />
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{t("settings.periods")}</h3>
              <ul className="flex flex-col text-sm text-muted">
                {detail.periods.map((period) => (
                  <li key={`${period.fromOn}-${period.reason}-${period.mode}`}>
                    {t("settings.period", {
                      mode: t(`modes.${period.mode}`),
                      origin: t(`origins.${period.origin}`),
                      date: long(period.fromOn),
                    })}
                  </li>
                ))}
              </ul>
            </div>
            <ServiceUrlForm accountId={accountId} url={summary.investment.url} />
            <p className="text-sm text-muted">
              {t("settings.flags")}{" "}
              <Link
                href={`/accounts/${accountId}?tab=settings` as Route}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
              >
                {t("connection.settings.inAccounts", { name })}
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"investments">>>;

/**
 * "What we get from <service>" (§3.6, S11, A1, V3): one row per kind of data — balances and
 * positions, activity, value history, cost basis — an icon, a badge in words and a sentence; the
 * detail by stream and product stays closed.
 */
function Received({
  detail,
  t,
  long,
  dayOf,
  instant,
  tp,
}: {
  detail: ServiceDetail;
  t: T;
  long: (on: string) => string;
  dayOf: (at: Date) => string;
  instant: (at: Date) => string;
  tp: (key: "products.spot") => string;
}) {
  const sync = detail.sync!;
  const name = detail.summary.account.name;
  const latest = detail.readings[0] ?? null;
  const flows = sync.coverage.filter(
    (row) => row.kind === "flows" && row.stream !== "quantities" && row.stream !== "balance_history",
  );
  const quantities = sync.coverage.find((row) => row.kind === "flows" && row.stream === "quantities") ?? null;
  const streamName = (stream: string) => t(`sync.streams.${stream}` as "sync.streams.trades");
  const incomplete = flows.filter((row) => row.status !== "complete");
  const completeFrom = flows.length === 0 ? null : flows.map((row) => dayOf(row.fromAt)).sort()[0];

  const rows: { key: string; title: string; status: Status; text: string }[] = [
    {
      key: "balances",
      title: t("connection.received.balances"),
      status: !latest ? "missing" : latest.unread.length > 0 ? "partial" : "complete",
      text: !latest
        ? t("connection.received.balancesNone")
        : latest.unread.length > 0
          ? t("connection.received.balancesPartial", {
              products: latest.unread.map((one) => productLabel(one, tp)).join(", "),
            })
          : t("connection.received.balancesOk", {
              when: sync.lastOkAt ? instant(sync.lastOkAt) : long(latest.on),
            }),
    },
    {
      key: "activity",
      title: t("connection.received.activity"),
      status: flows.length === 0 ? "missing" : incomplete.length > 0 ? "partial" : "complete",
      text:
        flows.length === 0
          ? t("connection.received.activityNone", { name })
          : incomplete.length > 0
            ? t("connection.received.activityGaps", {
                // One part per reason, its streams together: "Trades, Withdrawals: not available,
                // the API keeps 24 months".
                streams: [...Map.groupBy(incomplete, (row) => `${row.status}|${row.reason ?? ""}`).values()]
                  .map((rows) =>
                    [
                      rows.map((row) => streamName(row.stream)).join(", "),
                      [
                        t(`sync.coverageStatus.${rows[0].status}` as "sync.coverageStatus.complete"),
                        rows[0].reason
                          ? t(`sync.reasons.${rows[0].reason}` as "sync.reasons.api_limit_12m")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", "),
                    ].join(": "),
                  )
                  .join("; "),
              })
            : t("connection.received.activityOk", { date: long(completeFrom!) }),
    },
    detail.estimatedReadings
      ? {
          key: "history",
          title: t("connection.received.history"),
          status: "estimated" as const,
          text: t("connection.received.historyEstimated", {
            from: long(detail.estimatedReadings.from),
            to: long(detail.estimatedReadings.to),
            name,
          }),
        }
      : {
          key: "history",
          title: t("connection.received.history"),
          status: detail.firstReadOn ? ("complete" as const) : ("missing" as const),
          text: detail.firstReadOn
            ? t("connection.received.historyRead", { date: long(detail.firstReadOn) })
            : t("connection.received.balancesNone"),
        },
    {
      key: "cost",
      title: t("connection.received.cost"),
      status: quantities && quantities.status !== "complete" ? "check" : "missing",
      text:
        quantities && quantities.status !== "complete"
          ? t("connection.received.costMismatch")
          : t("connection.received.costMissing", { name }),
    },
  ];

  return (
    <Card padded={false} className="min-w-0" data-testid="received">
      <CardHeader title={t("connection.received.title", { name })} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{t("connection.received.note")}</p>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const Icon = ICON[row.status];
          return (
            <li
              key={row.key}
              data-testid="received-row"
              className="flex items-start gap-3 border-t border-border px-4 py-2.5 text-sm"
            >
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[row.status])} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {row.title}
                  <Badge tone={TONE[row.status]}>{t(`connection.status.${row.status}`)}</Badge>
                </span>
                <span className="text-muted">{row.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {sync.coverage.length > 0 && (
        <details className="border-t border-border px-4 py-2.5 text-sm">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted hover:text-fg">
            {t("connection.received.details", { count: sync.coverage.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {sync.coverage.map((row) => (
              <li
                key={`${row.kind}-${row.stream}-${row.fromAt.toISOString()}`}
                className="flex flex-wrap gap-x-2"
              >
                <span>{streamName(row.stream)}</span>
                <span className="text-muted">
                  {long(dayOf(row.fromAt))} → {long(dayOf(row.toAt))}
                </span>
                <span className={row.status === "complete" ? "text-muted" : "text-warn"}>
                  {t(`sync.coverageStatus.${row.status}` as "sync.coverageStatus.complete")}
                  {row.reason ? ` · ${t(`sync.reasons.${row.reason}` as "sync.reasons.api_limit_12m")}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {latest && latest.products.length > 0 && (
            <p className="mt-2 text-muted">
              {t("connection.received.products", {
                products: latest.products.map((one) => productLabel(one, tp)).join(", "),
              })}
            </p>
          )}
        </details>
      )}
    </Card>
  );
}

/**
 * The readings (§3.6, S6), newest first, the runs of equal ones folded into one line ("20 equal
 * readings, 18–27 Oct") and the estimated ones into another.
 */
function ReadingRuns({
  detail,
  t,
  long,
  own,
}: {
  detail: ServiceDetail;
  t: T;
  long: (on: string) => string;
  own: (cents: Cents | null) => string;
}) {
  const runs: {
    first: ServiceDetail["readings"][number];
    last: ServiceDetail["readings"][number];
    count: number;
  }[] = [];
  for (const reading of detail.readings) {
    const run = runs.at(-1);
    if (run && run.first.totalCents === reading.totalCents && run.first.status === reading.status) {
      run.last = reading;
      run.count += 1;
    } else runs.push({ first: reading, last: reading, count: 1 });
  }
  if (runs.length === 0 && !detail.estimatedReadings)
    return <p className="px-4 pb-4 text-sm text-muted">{t("connection.history.empty")}</p>;
  return (
    <ul className="flex flex-col">
      {runs.map((run) => (
        <li
          key={run.first.id}
          data-testid="reading-run"
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-muted">
              {run.count === 1
                ? long(run.first.on)
                : t("connection.history.same", {
                    count: run.count,
                    from: long(run.last.on),
                    to: long(run.first.on),
                  })}
            </span>
            <Badge
              tone={
                run.first.status === "complete" || run.first.status === "confirmed_zero" ? "neutral" : "warn"
              }
            >
              {t(`readings.statuses.${run.first.status}` as "readings.statuses.complete")}
            </Badge>
            {run.first.missingPrices > 0 && (
              <span className="text-warn">{t("readings.missing", { count: run.first.missingPrices })}</span>
            )}
          </span>
          <span className="font-medium tabular-nums">{own(run.first.totalCents)}</span>
        </li>
      ))}
      {detail.estimatedReadings && (
        <li
          data-testid="reading-run"
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-muted">
              {t("connection.history.estimated", {
                count: detail.estimatedReadings.count,
                from: long(detail.estimatedReadings.from),
                to: long(detail.estimatedReadings.to),
              })}
            </span>
            <Badge tone="neutral">{t("readings.statuses.estimated")}</Badge>
          </span>
        </li>
      )}
    </ul>
  );
}

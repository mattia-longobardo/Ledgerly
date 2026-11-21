"use client";

// The services of the Investments home (docs/design/investments-ux.md §3.1, §4.8), in the chart's
// colours and in the order of what they added: a table from `md`, a card each below it (DataTable).
// Every figure is a field of the service in `GET /investments/home`.
import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { CardHeader, Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { SeriesToggle } from "@ledgerly/ui/highlight";
import { Link } from "@ledgerly/ui/router";
import { Td, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf } from "../present";
import type { HomeContext, HomeService } from "./home-view";

function StateBadge({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const pnl = service.pnl;
  if (pnl === null) return null;
  if (pnl.status === "undetermined") return <Badge tone="warn">{text("home.status.undetermined")}</Badge>;
  if (pnl.partial && pnl.from)
    return (
      <Badge tone="accent">
        {text("home.status.from", { date: formatDate(pnl.from, "dayMonth", context.say.locale) })}
      </Badge>
    );
  return pnl.status === "stale" ? <Badge tone="neutral">{text("home.status.stale")}</Badge> : null;
}

function NameCell({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SeriesToggle
        seriesKey={service.accountId}
        color={context.colorOf(service)}
        label={text("home.services.highlight", { name: service.name })}
      />
      <Link
        href={context.serviceHref(service.accountId)}
        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium hover:underline"
      >
        <span className="truncate">{service.name}</span>
      </Link>
      <StateBadge service={service} context={context} />
    </span>
  );
}

/** The counter-value once, and only when there is one: a zero is one line (H12). */
const counterValue = (service: HomeService, currency: string) =>
  service.currency !== currency && centsOf(service.value) !== 0n && service.displayValue !== null;

function ValueCell({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const { money, home } = context;
  if (service.value === null) return <span className="text-muted">{text("services.noValue")}</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span>{money(service.value, { currency: service.currency })}</span>
      {counterValue(service, home.currency) && (
        <span className="text-xs text-muted">≈ {money(service.displayValue)}</span>
      )}
    </span>
  );
}

function PnlCell({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const pnl = service.pnl?.display?.pnl ?? null;
  if (pnl === null) return <span className="text-muted">{text("home.services.unavailable")}</span>;
  return (
    <span
      data-testid="service-pnl"
      data-cents={String(centsOf(pnl))}
      className={cn("font-semibold", TONE_TEXT[toneOfSign(centsOf(pnl))])}
    >
      {context.money(pnl, { signed: true })}
    </span>
  );
}

function ReturnCell({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const measured = service.pnl?.displayReturn ?? null;
  const rate = measured?.modifiedDietz ?? null;
  const notes = measured
    ? [
        measured.modifiedDietz === null ? text("home.services.notComputable") : null,
        measured.method === "invested" ? text("home.services.onInvested") : null,
        measured.xirrStatus === "ok"
          ? text("home.services.xirr", { rate: context.percent(measured.xirr) })
          : null,
        measured.largeFlows ? text("home.services.largeFlows") : null,
      ].filter((note) => note !== null)
    : [];
  return (
    <span
      title={notes.length === 0 ? undefined : notes.join(" · ")}
      className={TONE_TEXT[rate === null ? "muted" : toneOfSign(rate)]}
    >
      {context.percent(rate)}
    </span>
  );
}

function ContributionCell({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const contribution = service.contribution;
  if (!contribution) return <span className="text-muted">{NULL_DISPLAY}</span>;
  const share =
    contribution.shareOfNet === null
      ? text("home.services.shareNotComputable")
      : text("home.services.share", {
          share: context.percent(contribution.shareOfNet),
          net: context.money(context.home.pnl.parts?.pnl ?? null, { signed: true }),
        });
  const width = Math.abs(contribution.bar) * 50;
  return (
    <span title={share} className="inline-flex items-center gap-2">
      <span aria-hidden className="relative block h-2 w-24 rounded-full bg-track">
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            width: `${width}%`,
            left: contribution.bar >= 0 ? "50%" : `${50 - width}%`,
            background: contribution.bar >= 0 ? "var(--pos)" : "var(--neg)",
          }}
        />
      </span>
      <span className="sr-only">{share}</span>
    </span>
  );
}

function useColumns(context: HomeContext): DataColumn<HomeService>[] {
  const text = useTranslations("investments");
  return [
    {
      key: "name",
      header: text("services.name"),
      className: "py-1",
      cell: (service) => (
        <span className="flex flex-col items-start">
          <NameCell service={service} context={context} />
          <span className="pl-7 text-xs text-muted">{text(`categories.${service.category}`)}</span>
        </span>
      ),
    },
    {
      key: "value",
      header: text("home.services.value"),
      align: "right",
      className: "py-1",
      cell: (service) => <ValueCell service={service} context={context} />,
    },
    {
      key: "pnl",
      header: text("home.services.pnl"),
      align: "right",
      cell: (service) => <PnlCell service={service} context={context} />,
    },
    {
      key: "return",
      header: text("home.services.return"),
      align: "right",
      cell: (service) => <ReturnCell service={service} context={context} />,
    },
    {
      key: "contribution",
      header: text("home.services.contribution"),
      cell: (service) => <ContributionCell service={service} context={context} />,
    },
    {
      key: "weight",
      header: text("services.weight"),
      align: "right",
      cell: (service) => context.percent(service.weight, false),
    },
  ];
}

/** A service on a phone: its name, value and weight on the left, its P&L and return on the right. */
function ServiceCard({ service, context }: { service: HomeService; context: HomeContext }) {
  const text = useTranslations("investments");
  const { money, percent, home } = context;
  const line =
    service.value === null
      ? text("services.noValue")
      : [
          money(service.value, { currency: service.currency }),
          counterValue(service, home.currency) ? `≈ ${money(service.displayValue)}` : null,
          service.weight === null ? null : percent(service.weight, false),
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <NameCell service={service} context={context} />
        <span className="pl-7 text-xs text-muted tabular-nums">{line}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
        <PnlCell service={service} context={context} />
        <span className="text-xs">
          <ReturnCell service={service} context={context} />
        </span>
      </span>
    </>
  );
}

/** The transfers between services and the total: the table's footer, the cards' last lines. */
function useTotals(context: HomeContext) {
  const text = useTranslations("investments");
  const { home, money, percent } = context;
  const hero = home.pnl.parts?.pnl ?? null;
  const transfers = home.pnl.transfers;
  const moved = centsOf(transfers) !== 0n;
  const heroTone = TONE_TEXT[toneOfSign(centsOf(hero))];
  const footer = (
    <>
      {moved && (
        <Tr data-testid="transfers-row" data-cents={String(centsOf(transfers))}>
          <Td muted>{text("home.services.transfers")}</Td>
          <Td />
          <Td align="right">{money(transfers, { signed: true })}</Td>
          <Td />
          <Td />
          <Td />
        </Tr>
      )}
      <TotalRow label={text("home.services.total")}>
        <Td align="right">{money(home.totals.value)}</Td>
        <Td align="right" className={heroTone}>
          {money(hero, { signed: true })}
        </Td>
        <Td align="right">{percent(home.pnl.modifiedDietz)}</Td>
        <Td />
        <Td align="right">{percent(1, false)}</Td>
      </TotalRow>
    </>
  );
  const cardFooter = (
    <>
      {moved && (
        <li className="flex justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted">
          <span>{text("home.services.transfers")}</span>
          <span className="tabular-nums">{money(transfers, { signed: true })}</span>
        </li>
      )}
      <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
        <span>{text("home.services.total")}</span>
        <span className={cn("tabular-nums", heroTone)}>{money(hero, { signed: true })}</span>
      </li>
    </>
  );
  return { footer, cardFooter };
}

export function HomeServices({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const columns = useColumns(context);
  const { footer, cardFooter } = useTotals(context);
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader title={text("services.title")} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{text("home.services.note")}</p>
      <DataTable
        columns={columns}
        rows={context.home.services}
        rowKey={(service) => service.accountId}
        rowProps={(service) => ({ "data-testid": "service-row", "data-series-row": service.accountId })}
        card={(service) => <ServiceCard service={service} context={context} />}
        cardProps={(service) => ({
          "data-testid": "service-item",
          "data-series-row": service.accountId,
          className: "flex items-start justify-between gap-3 border-t border-border px-4 py-2.5",
        })}
        footer={footer}
        cardFooter={cardFooter}
      />
    </Card>
  );
}

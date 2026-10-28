import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PALETTE } from "@/modules/accounts/ui/display";
import { investmentsHome, type ServiceSummary } from "@/modules/investments/queries";
import { InvestmentHistoryCard } from "@/modules/investments/ui/history-card";
import { requireSession } from "@/platform/auth/session";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { CompositionBar } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investments"))("title") };
}

/**
 * Investments (docs/design/investments.md §4.1): every service of the section, its value in its
 * own currency and in the display currency, what went in and what it gained, the history, the
 * allocation, and the funds that stay in Funds, read only.
 */
export default async function InvestmentsPage({ searchParams }: PageProps<"/investments">) {
  const ctx = await requireSession();
  const t = await getTranslations("investments");
  const view = await investmentsHome(ctx);
  const display = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat, { currency: view.currency });
  const own = (cents: Cents | null, currency: string) => formatMoney(cents, ctx.numberFormat, { currency });
  const addService = (
    <ButtonLink href={"/investments/catalog" as Route} variant="primary" size="sm">
      {t("actions.addService")}
    </ButtonLink>
  );

  if (view.services.length === 0) {
    return (
      <Page title={t("title")} actions={addService}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={
            <ButtonLink href={"/investments/catalog" as Route} variant="primary">
              {t("actions.addService")}
            </ButtonLink>
          }
        />
        <FundsCard funds={view.funds} display={display} t={t} />
      </Page>
    );
  }

  const { totals } = view;
  const colorOf = new Map(
    view.services.map((one, index) => [one.account.id, PALETTE[index % PALETTE.length]]),
  );

  const nameCell = (one: ServiceSummary) => (
    <Link
      href={`/investments/${one.account.id}` as Route}
      className="focus-ring inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-[4px] font-medium hover:underline"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: colorOf.get(one.account.id) }}
      />
      <span className="truncate">{one.account.name}</span>
    </Link>
  );
  const valueCell = (one: ServiceSummary) => (
    <span className="inline-flex flex-col items-end">
      <span>
        {one.valueCents === null ? t("services.noValue") : own(one.valueCents, one.account.currency)}
      </span>
      {one.account.currency !== view.currency && one.valueCents !== null && (
        <span className="text-xs text-muted">≈ {display(one.displayCents)}</span>
      )}
    </span>
  );
  const warnings = (one: ServiceSummary) => {
    const list = [
      one.warnings.conflicts > 0 && (
        <Badge key="conflict" tone="warn">
          {t("warnings.conflict", { count: one.warnings.conflicts })}
        </Badge>
      ),
      one.warnings.pendingZero && (
        <Badge key="zero" tone="warn">
          {t("warnings.pendingZero")}
        </Badge>
      ),
      one.warnings.missingPrices > 0 && (
        <Badge key="prices" tone="warn">
          {t("warnings.missingPrices", { count: one.warnings.missingPrices })}
        </Badge>
      ),
      one.warnings.openAdjustments > 0 && (
        <Badge key="adjustments" tone="warn">
          {t("warnings.openAdjustments", { count: one.warnings.openAdjustments })}
        </Badge>
      ),
    ].filter(Boolean);
    return list.length === 0 ? null : <span className="flex flex-wrap gap-1">{list}</span>;
  };
  const lastUpdate = (one: ServiceSummary) =>
    one.lastUpdate ? formatDate(one.lastUpdate, "long", ctx.locale) : t("services.never");
  const change = (one: ServiceSummary) =>
    one.change30Cents === null
      ? NULL_DISPLAY
      : formatMoney(one.change30Cents, ctx.numberFormat, { signed: true, currency: one.account.currency });

  return (
    <Page title={t("title")} actions={addService}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={t("kpis.value")}
          value={display(totals.valueCents)}
          note={totals.partial ? t("kpis.valuePartial") : undefined}
        />
        <KpiTile
          label={t("kpis.invested")}
          value={display(totals.investedCents)}
          note={t("kpis.investedNote")}
        />
        <KpiTile
          label={t("kpis.gain")}
          value={
            totals.gainCents === null
              ? NULL_DISPLAY
              : formatMoney(totals.gainCents, ctx.numberFormat, { signed: true, currency: view.currency })
          }
          valueTone={toneOfSign(totals.gainCents)}
          delta={
            totals.simpleReturn === null
              ? undefined
              : formatPercent(totals.simpleReturn, ctx.numberFormat, { signed: true })
          }
          deltaTone={toneOfSign(totals.simpleReturn)}
          note={totals.fxEffect ? t("kpis.fxNote") : t("kpis.gainNote")}
        />
        <KpiTile
          label={t("kpis.xirr")}
          value={
            totals.xirr === null
              ? NULL_DISPLAY
              : totals.xirr.status === "ok"
                ? formatPercent(totals.xirr.rate, ctx.numberFormat, { signed: true })
                : t("kpis.notComputable")
          }
          valueTone={totals.xirr?.status === "ok" ? toneOfSign(totals.xirr.rate) : "fg"}
          note={
            totals.gainCents === null && view.services.some((one) => !one.reliable)
              ? t("sync.notReliable")
              : t("kpis.xirrNote")
          }
        />
      </div>

      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <InvestmentHistoryCard
          ctx={ctx}
          query={await searchParams}
          path="/investments"
          summaryValue={{ value: totals.valueCents, invested: totals.investedCents }}
        />

        <Card className="flex min-w-0 flex-col gap-4">
          <Allocation
            title={t("allocation.classTitle")}
            empty={t("allocation.empty")}
            parts={view.byClass.map((slice, index) => ({
              label: t(`classes.${slice.key}` as "classes.cash"),
              share: slice.share,
              cents: slice.cents,
              color: PALETTE[index % PALETTE.length],
            }))}
            display={display}
            format={ctx.numberFormat}
          />
          <Allocation
            title={t("allocation.serviceTitle")}
            empty={t("allocation.empty")}
            parts={view.byService.map((slice, index) => ({
              label: slice.key,
              share: slice.share,
              cents: slice.cents,
              color: PALETTE[index % PALETTE.length],
            }))}
            display={display}
            format={ctx.numberFormat}
          />
        </Card>
      </div>

      <Card padded={false} className="min-w-0">
        <CardHeader title={t("services.title")} actions={addService} />
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{t("services.name")}</Th>
              <Th>{t("services.category")}</Th>
              <Th>{t("services.origin")}</Th>
              <Th>{t("services.lastUpdate")}</Th>
              <Th align="right">{t("services.value")}</Th>
              <Th align="right">{t("services.change30")}</Th>
              <Th align="right">{t("services.weight")}</Th>
            </THead>
            <TBody>
              {view.services.map((one) => (
                <Tr key={one.account.id} data-testid="service-row">
                  <Td className="py-1">
                    <span className="flex flex-col items-start gap-1">
                      {nameCell(one)}
                      {warnings(one)}
                    </span>
                  </Td>
                  <Td muted>{t(`categories.${one.investment.category}`)}</Td>
                  <Td muted>{one.origin ? t(`origins.${one.origin}`) : NULL_DISPLAY}</Td>
                  <Td muted>{lastUpdate(one)}</Td>
                  <Td align="right" className="py-1">
                    {valueCell(one)}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(one.change30Cents)]}>
                    {change(one)}
                  </Td>
                  <Td align="right">{formatPercent(one.weight, ctx.numberFormat)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <ul className="flex flex-col md:hidden">
          {view.services.map((one) => (
            <li
              key={one.account.id}
              data-testid="service-item"
              className="flex flex-col gap-1.5 border-t border-border px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                {nameCell(one)}
                <span className="shrink-0 text-right tabular-nums">{valueCell(one)}</span>
              </div>
              {warnings(one)}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="text-muted">{t("services.category")}</dt>
                <dd className="text-right">{t(`categories.${one.investment.category}`)}</dd>
                <dt className="text-muted">{t("services.origin")}</dt>
                <dd className="text-right">{one.origin ? t(`origins.${one.origin}`) : NULL_DISPLAY}</dd>
                <dt className="text-muted">{t("services.lastUpdate")}</dt>
                <dd className="text-right">{lastUpdate(one)}</dd>
                <dt className="text-muted">{t("services.change30")}</dt>
                <dd className={cn("text-right", TONE_TEXT[toneOfSign(one.change30Cents)])}>{change(one)}</dd>
                <dt className="text-muted">{t("services.weight")}</dt>
                <dd className="text-right">{formatPercent(one.weight, ctx.numberFormat)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <FundsCard funds={view.funds} display={display} t={t} />
    </Page>
  );
}

function Allocation({
  title,
  empty,
  parts,
  display,
  format,
}: {
  title: string;
  empty: string;
  parts: { label: string; share: number; cents: Cents; color: string }[];
  display: (cents: Cents | null) => string;
  format: Parameters<typeof formatPercent>[1];
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {parts.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          <CompositionBar parts={parts} />
          <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
            {parts.map((part) => (
              <li
                key={part.label}
                className="col-span-3 grid min-h-8 grid-cols-subgrid items-center border-b border-border last:border-0"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: part.color }}
                  />
                  <span className="truncate">{part.label}</span>
                </span>
                <span className="text-right text-muted tabular-nums">
                  {formatPercent(part.share, format)}
                </span>
                <span className="text-right tabular-nums">{display(part.cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

async function FundsCard({
  funds,
  display,
  t,
}: {
  funds: { id: string; name: string; valueCents: Cents | null; kind: string }[];
  display: (cents: Cents | null) => string;
  t: Awaited<ReturnType<typeof getTranslations<"investments">>>;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("funds.title")}</h2>
      <p className="text-sm text-muted">{t("funds.description")}</p>
      {funds.length === 0 ? (
        <p className="text-sm text-muted">{t("funds.empty")}</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {funds.map((fund) => (
            <li
              key={fund.id}
              className="flex min-h-9 items-center justify-between gap-2 border-b border-border last:border-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/funds/${fund.id}` as Route}
                  className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-[4px] font-medium hover:underline"
                >
                  <span className="truncate">{fund.name}</span>
                </Link>
                <span className="shrink-0 text-muted">
                  {t(`funds.types.${fund.kind}` as "funds.types.pac")}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{display(fund.valueCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

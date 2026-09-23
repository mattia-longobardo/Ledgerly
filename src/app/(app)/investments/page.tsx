import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { asNumbers, axisLabels, monthLabels, PALETTE } from "@/modules/accounts/ui/display";
import { investmentsView, type MovementView, type PlatformView } from "@/modules/investments/queries";
import {
  DeleteValuationButton,
  type DialogContext,
  ImportButton,
  MovementMenu,
  type MovementSummary,
  NewMovementButton,
  NewPlatformButton,
  PlatformMenu,
  type PlatformSummary,
} from "@/modules/investments/ui/investment-actions";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatAmountInput, formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { CompositionBar, MultiLine } from "@/ui/chart";
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
 * Investments: the money kept on trading platforms, what went in and came out, what it is worth
 * now. `?platform=` narrows the figures, the chart and the history to one platform. None of it
 * touches an account's balance: a movement linked to a bank movement only says where it came from.
 */
export default async function InvestmentsPage({ searchParams }: PageProps<"/investments">) {
  const ctx = await requireSession();
  const t = await getTranslations("investments");
  const query = await searchParams;
  const platformParam = typeof query.platform === "string" ? query.platform : null;
  const view = await investmentsView(ctx, { platformId: platformParam });
  const todayOn = today(ctx.timeZone);
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const signedMoney = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat, { signed: true });
  const pct = (rate: number | null) => formatPercent(rate, ctx.numberFormat, { signed: true });
  const long = (on: string | null) => formatDate(on, "long", ctx.locale);

  const context: DialogContext = {
    platforms: view.platforms.map((one) => ({ id: one.platform.id, name: one.platform.name })),
    numberFormat: ctx.numberFormat,
    locale: ctx.locale,
    today: todayOn,
    linkOptions: view.linkOptions,
  };
  const colorOf = new Map(
    view.platforms.map((one, index) => [one.platform.id, PALETTE[index % PALETTE.length]]),
  );
  const summaryOf = (one: PlatformView): PlatformSummary => ({
    id: one.platform.id,
    name: one.platform.name,
    url: one.platform.url,
    movementCount: one.movementCount,
    valueInput:
      one.stats.valuedOn === todayOn ? formatAmountInput(one.stats.valueCents, ctx.numberFormat) : "",
  });
  const movementOf = (row: MovementView): MovementSummary => ({
    id: row.movement.id,
    platformId: row.movement.platformId,
    kind: row.movement.kind,
    amountInput: formatAmountInput(row.movement.amountCents, ctx.numberFormat),
    amountCents: row.movement.amountCents,
    on: row.movement.on,
    note: row.movement.note,
    linked: row.linked,
  });

  const actions = (
    <>
      <ImportButton />
      <NewMovementButton context={context} platformId={view.selected?.id ?? null} />
    </>
  );

  if (view.platforms.length === 0) {
    return (
      <Page title={t("title")} actions={actions}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={
            <>
              <NewPlatformButton variant="primary" size="md" />
              <ImportButton size="md" />
            </>
          }
        />
      </Page>
    );
  }

  const { totals } = view;
  const unvalued = view.platforms
    .filter((one) => one.stats.valueCents === null)
    .filter((one) => view.selected === null || one.platform.id === view.selected.id)
    .map((one) => one.platform.name);
  const valueNote =
    totals.valueCents === null
      ? t("kpis.valueMissing", { count: unvalued.length })
      : totals.estimated
        ? t("kpis.valueEstimated", { date: long(totals.valuedOn) })
        : totals.valuedOn
          ? t("kpis.valuedOn", { date: long(totals.valuedOn) })
          : undefined;

  const external = (one: PlatformView, withText: boolean) =>
    one.platform.url ? (
      <a
        href={one.platform.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={withText ? undefined : t("platforms.open", { name: one.platform.name })}
        title={t("platforms.open", { name: one.platform.name })}
        className={cn(
          "focus-ring inline-flex min-h-6 shrink-0 items-center gap-1 rounded-[4px] text-accent hover:underline",
          !withText && "min-w-6 justify-center",
        )}
      >
        {withText && t("platforms.openShort", { name: one.platform.name })}
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    ) : null;

  const platformLink = (one: PlatformView) => (
    <Link
      href={`/investments?platform=${one.platform.id}` as Route}
      className="focus-ring inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-[4px] font-medium hover:underline"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: colorOf.get(one.platform.id) }}
      />
      <span className="truncate">{one.platform.name}</span>
    </Link>
  );

  const valueCell = (one: PlatformView) => (
    <span className="inline-flex flex-col items-end">
      <span>{money(one.stats.valueCents)}</span>
      <span className="text-xs text-muted">
        {one.stats.valueCents === null
          ? t("platforms.noValue")
          : one.stats.estimated
            ? t("platforms.estimated")
            : one.stats.valuedOn
              ? formatDate(one.stats.valuedOn, "dayMonth", ctx.locale)
              : ""}
      </span>
    </span>
  );

  const kindBadge = (kind: "deposit" | "withdrawal") => (
    <Badge tone={kind === "deposit" ? "accent" : "pos"}>{t(`kinds.${kind}`)}</Badge>
  );
  const linkedText = (row: MovementView) =>
    row.linked
      ? [row.linked.payee, row.linked.accountName, formatDate(row.linked.on, "dayMonth", ctx.locale)]
          .filter(Boolean)
          .join(" · ")
      : null;

  const selectedView = view.selected
    ? (view.platforms.find((one) => one.platform.id === view.selected?.id) ?? null)
    : null;

  return (
    <Page title={t("title")} actions={actions}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </div>

      <nav aria-label={t("filter.label")} className="flex flex-wrap gap-1.5">
        {[{ id: null, name: t("filter.all") }, ...context.platforms].map((one) => {
          const current = (view.selected?.id ?? null) === one.id;
          return (
            <Link
              key={one.id ?? "all"}
              href={(one.id ? `/investments?platform=${one.id}` : "/investments") as Route}
              aria-current={current ? "page" : undefined}
              className={cn(
                "focus-ring inline-flex h-[26px] max-w-full items-center rounded-[13px] border border-border px-2.5 text-sm",
                current ? "bg-fg font-medium text-card" : "bg-card text-fg hover:bg-hover",
              )}
            >
              <span className="truncate">{one.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile label={t("kpis.value")} value={money(totals.valueCents)} note={valueNote} />
        <KpiTile
          label={t("kpis.net")}
          value={money(totals.netCents)}
          note={t("kpis.netNote", {
            deposited: money(totals.depositedCents),
            withdrawn: money(totals.withdrawnCents),
          })}
        />
        <KpiTile
          label={t("kpis.gain")}
          value={totals.gainCents === null ? NULL_DISPLAY : signedMoney(totals.gainCents)}
          valueTone={toneOfSign(totals.gainCents)}
          delta={totals.returnRate === null ? undefined : pct(totals.returnRate)}
          deltaTone={toneOfSign(totals.returnRate)}
          note={t("kpis.gainNote")}
        />
        <KpiTile
          label={t("kpis.movements")}
          value={String(view.movements.length)}
          note={t("kpis.platforms", { count: view.selected ? 1 : view.platforms.length })}
        />
      </div>

      {unvalued.length > 0 && (
        <p className="text-sm text-warn">
          {t("partial", { names: unvalued.join(", "), count: unvalued.length })}
        </p>
      )}

      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
            <span className="flex gap-3 text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 bg-accent" /> {t("chart.value")}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-4 border-t border-dashed border-muted" /> {t("chart.invested")}
              </span>
            </span>
          </div>
          {view.months.length === 0 ? (
            <p className="text-sm text-muted">{t("chart.empty")}</p>
          ) : (
            <MultiLine
              series={[
                { values: asNumbers(view.history.value), color: "var(--accent)" },
                { values: asNumbers(view.history.invested), color: "var(--muted)", dashed: true, step: true },
              ]}
              yLabels={axisLabels([...view.history.value, ...view.history.invested], ctx.numberFormat)}
              xLabels={monthLabels(view.months, ctx.locale)}
              hover={view.months.map((month, index) => ({
                label: formatDate(month, "monthYear", ctx.locale),
                value: money(view.history.value[index]),
                note: t("chart.hoverInvested", { amount: money(view.history.invested[index]) }),
              }))}
              summary={t("chart.summary", {
                value: money(totals.valueCents),
                invested: money(totals.netCents),
              })}
              height={180}
            />
          )}
        </Card>

        {selectedView ? (
          <Card className="flex min-w-0 flex-col gap-3" data-testid="platform-detail">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="truncate text-lg font-semibold">{selectedView.platform.name}</h2>
                {selectedView.platform.url ? (
                  external(selectedView, true)
                ) : (
                  <span className="text-sm text-muted">{t("platforms.noUrl")}</span>
                )}
              </div>
              <PlatformMenu platform={summaryOf(selectedView)} context={context} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">{t("platforms.deposited")}</dt>
                <dd className="font-semibold tabular-nums">{money(selectedView.stats.depositedCents)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">{t("platforms.withdrawn")}</dt>
                <dd className="font-semibold tabular-nums">{money(selectedView.stats.withdrawnCents)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">{t("platforms.return")}</dt>
                <dd
                  className={cn(
                    "font-semibold tabular-nums",
                    TONE_TEXT[toneOfSign(selectedView.stats.returnRate)],
                  )}
                >
                  {pct(selectedView.stats.returnRate)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">{t("platforms.share")}</dt>
                <dd className="font-semibold tabular-nums">
                  {formatPercent(selectedView.share, ctx.numberFormat)}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">{t("valuations.title")}</h3>
              {view.valuations.length === 0 ? (
                <p className="text-sm text-muted">{t("valuations.empty")}</p>
              ) : (
                <ul className="flex flex-col text-sm">
                  {view.valuations.slice(0, 12).map((valuation) => (
                    <li
                      key={valuation.id}
                      className="flex min-h-8 items-center justify-between gap-2 border-b border-border last:border-0"
                    >
                      <span className="text-muted">{long(valuation.on)}</span>
                      <span className="ml-auto font-medium tabular-nums">{money(valuation.valueCents)}</span>
                      <DeleteValuationButton
                        id={valuation.id}
                        description={t("confirm.valuationDescription", {
                          name: valuation.platformName,
                          value: money(valuation.valueCents),
                          date: long(valuation.on),
                        })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : (
          <Card className="flex min-w-0 flex-col gap-3">
            <h2 className="text-lg font-semibold">{t("composition.title")}</h2>
            {totals.valueCents === null || totals.valueCents <= 0n ? (
              <p className="text-sm text-muted">{t("composition.unknown")}</p>
            ) : (
              <CompositionBar
                parts={view.platforms.map((one) => ({
                  label: one.platform.name,
                  share: one.share ?? 0,
                  color: colorOf.get(one.platform.id) ?? PALETTE[0],
                }))}
              />
            )}
            <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
              {view.platforms.map((one) => (
                <li
                  key={one.platform.id}
                  className="col-span-3 grid min-h-9 grid-cols-subgrid items-center border-b border-border last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: colorOf.get(one.platform.id) }}
                    />
                    <span className="truncate">{one.platform.name}</span>
                  </span>
                  <span className="text-right text-muted tabular-nums">
                    {formatPercent(one.share, ctx.numberFormat)}
                  </span>
                  <span className="text-right tabular-nums">{money(one.stats.valueCents)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card padded={false} className="min-w-0">
        <CardHeader title={t("platforms.title")} actions={<NewPlatformButton size="xs" variant="ghost" />} />
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{t("platforms.name")}</Th>
              <Th align="right">{t("platforms.deposited")}</Th>
              <Th align="right">{t("platforms.withdrawn")}</Th>
              <Th align="right">{t("platforms.net")}</Th>
              <Th align="right">{t("platforms.value")}</Th>
              <Th align="right">{t("platforms.gain")}</Th>
              <Th align="right">{t("platforms.return")}</Th>
              <Th align="right">
                <span className="sr-only">{t("platforms.actions")}</span>
              </Th>
            </THead>
            <TBody>
              {view.platforms.map((one) => (
                <Tr
                  key={one.platform.id}
                  data-testid="platform-row"
                  selected={one.platform.id === view.selected?.id}
                >
                  <Td className="py-1">
                    <span className="flex items-center gap-1">
                      {platformLink(one)}
                      {external(one, false)}
                    </span>
                  </Td>
                  <Td align="right">{money(one.stats.depositedCents)}</Td>
                  <Td align="right">{money(one.stats.withdrawnCents)}</Td>
                  <Td align="right">{money(one.stats.netCents)}</Td>
                  <Td align="right" className="py-1">
                    {valueCell(one)}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(one.stats.gainCents)]}>
                    {one.stats.gainCents === null ? NULL_DISPLAY : signedMoney(one.stats.gainCents)}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(one.stats.returnRate)]}>
                    {pct(one.stats.returnRate)}
                  </Td>
                  <Td align="right">
                    <PlatformMenu platform={summaryOf(one)} context={context} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <ul className="flex flex-col md:hidden">
          {view.platforms.map((one) => (
            <li
              key={one.platform.id}
              data-testid="platform-item"
              className={cn(
                "flex flex-col gap-1.5 border-t border-border px-4 py-3",
                one.platform.id === view.selected?.id && "bg-sel",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1">
                  {platformLink(one)}
                  {external(one, false)}
                </span>
                <PlatformMenu platform={summaryOf(one)} context={context} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="text-muted">{t("platforms.deposited")}</dt>
                <dd className="text-right">{money(one.stats.depositedCents)}</dd>
                <dt className="text-muted">{t("platforms.withdrawn")}</dt>
                <dd className="text-right">{money(one.stats.withdrawnCents)}</dd>
                <dt className="text-muted">{t("platforms.value")}</dt>
                <dd className="text-right">{valueCell(one)}</dd>
                <dt className="text-muted">{t("platforms.gain")}</dt>
                <dd className={cn("text-right", TONE_TEXT[toneOfSign(one.stats.gainCents)])}>
                  {one.stats.gainCents === null ? NULL_DISPLAY : signedMoney(one.stats.gainCents)}{" "}
                  {one.stats.returnRate !== null && `(${pct(one.stats.returnRate)})`}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <Card padded={false} className="min-w-0">
        <CardHeader
          title={t("movements.title")}
          actions={
            <span className="text-muted">{t("movements.count", { count: view.movements.length })}</span>
          }
        />
        {view.movements.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("movements.empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("movements.date")}</Th>
                  <Th>{t("movements.platform")}</Th>
                  <Th>{t("movements.kind")}</Th>
                  <Th align="right">{t("movements.amount")}</Th>
                  <Th>{t("movements.linked")}</Th>
                  <Th>{t("movements.note")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("platforms.actions")}</span>
                  </Th>
                </THead>
                <TBody>
                  {view.movements.map((row) => (
                    <Tr key={row.movement.id} data-testid="movement-row">
                      <Td muted>{long(row.movement.on)}</Td>
                      <Td className="font-medium">{row.platformName}</Td>
                      <Td>{kindBadge(row.movement.kind)}</Td>
                      <Td align="right" className="font-medium">
                        {money(row.movement.amountCents)}
                      </Td>
                      <Td className="max-w-64 truncate text-muted">
                        {linkedText(row) ?? t("movements.notLinked")}
                      </Td>
                      <Td className="max-w-48 truncate text-muted">{row.movement.note ?? NULL_DISPLAY}</Td>
                      <Td align="right">
                        <MovementMenu movement={movementOf(row)} context={context} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col md:hidden">
              {view.movements.map((row) => (
                <li
                  key={row.movement.id}
                  data-testid="movement-item"
                  className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {kindBadge(row.movement.kind)}
                      <span className="truncate font-medium">{row.platformName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="font-medium tabular-nums">{money(row.movement.amountCents)}</span>
                      <MovementMenu movement={movementOf(row)} context={context} />
                    </span>
                  </div>
                  <span className="text-muted">{long(row.movement.on)}</span>
                  <span className="truncate text-muted">{linkedText(row) ?? t("movements.notLinked")}</span>
                  {row.movement.note && <span className="truncate text-muted">{row.movement.note}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Page>
  );
}

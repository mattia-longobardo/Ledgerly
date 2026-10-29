import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { priceText, quantityText } from "@/modules/investments/activity";
import { periodQuery, type Query } from "@/modules/investments/period";
import type { HoldingPnl, PositionAt } from "@/modules/investments/pnl";
import {
  type ClosedGroup,
  closedGroups,
  contributionsOf,
  onCostOf,
  periodReturnOf,
} from "@/modules/investments/positions";
import { type HoldingRow, servicePositions } from "@/modules/investments/queries";
import { formatDecimal, PRICE_SCALE, QUANTITY_SCALE, unitPriceOf } from "@/modules/investments/rules";
import { type HoldingSummary, HoldingMenu, ReconcileButton } from "@/modules/investments/ui/dialogs";
import { productLabel } from "@/modules/investments/ui/labels";
import { periodText } from "@/modules/investments/ui/period-control";
import { requireSession } from "@/platform/auth/session";
import { addDays } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { GroupRow, Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { withParams } from "@/ui/url";
import { loadService, serviceContextOf } from "../service-data";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const STATUSES = ["open", "closed", "all"] as const;
type Status = (typeof STATUSES)[number];

/**
 * A service's Positions (docs/design/investments-ux.md §3.4, U4): the positions open on the period's
 * last day with what they added to it, the ones the period closed, every close ever, and the
 * contributions of all of them — open and sold — closing on the Overview's P&L to the cent
 * (PERS-113 · 1, 4, 5, 9). A past period shows its positions on its last day; today's are a link.
 */
export default async function InvestmentServicePositions({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]/positions">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const query = (await searchParams) as Query;
  const asked = one(query.status);
  const status: Status = STATUSES.includes(asked as Status) ? (asked as Status) : "open";
  // "Group by Asset | Class" of the open positions (§3.4, mockup 05): by asset is the plain list.
  const by: "asset" | "class" = one(query.by) === "class" ? "class" : "asset";
  const t = await getTranslations("investments.positions");
  const ti = await getTranslations("investments");
  const tp = await getTranslations("investments.period");
  const [detail, view] = await Promise.all([
    loadService(accountId),
    servicePositions(ctx, accountId, { period: one(query.period), from: one(query.from), to: one(query.to) }),
  ]);
  if (!detail || !view) notFound();
  const { period, span, todayOn, service, assets, holdings } = view;
  const context = serviceContextOf(detail, ctx);
  const currency = detail.currency;
  const nf = ctx.numberFormat;
  const synced = detail.summary.origin === "synced";
  const etoro = detail.summary.investment.provider === "etoro";
  const base = `/investments/${accountId}`;
  const periodParams = periodQuery(period, todayOn);
  const name = periodText(period, span, todayOn, ctx.locale, tp);
  const short = period.kind === "year" ? String(period.year) : null;
  const past = period.to < todayOn;
  const money = (cents: Cents | null, signed = false) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, nf, { currency, signed });
  const percent = (value: number | null) => formatPercent(value, nf, { signed: true });
  const activityOf = (assetId: string | null) =>
    withParams(`${base}/activity`, {}, { ...periodParams, ...(assetId ? { asset: assetId } : {}) });
  const tProduct = (key: "products.spot") => ti(key);

  // ——— What each row is: its asset, class and product, in words ————————————————————————————————
  const assetOf = (assetId: string | null) => (assetId === null ? null : (assets.get(assetId) ?? null));
  const holdingAsset = (holdingId: string) => {
    const holding = holdings.get(holdingId);
    return { asset: assetOf(holding?.assetId ?? null), product: holding?.product ?? null, holding };
  };
  const nameCell = (input: {
    assetId: string | null;
    product: string | null;
    manual: boolean;
    extra?: string | null;
    badge?: ReactNode;
  }) => {
    const asset = assetOf(input.assetId);
    return (
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <Link
          href={activityOf(input.assetId)}
          className="focus-ring inline-flex min-h-6 max-w-full items-center rounded-[4px] font-medium hover:underline"
        >
          <span className="truncate">{asset?.name ?? t("unknownAsset")}</span>
        </Link>
        <span className="text-xs text-muted">
          {[
            asset?.symbol,
            asset ? ti(`classes.${asset.class}`) : null,
            input.product ? productLabel(input.product, tProduct) : null,
            input.extra,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {(input.manual && synced) || input.badge ? (
          <span className="flex flex-wrap gap-1">
            {input.manual && synced && <Badge tone="neutral">{t("manual")}</Badge>}
            {input.badge}
          </span>
        ) : null}
      </span>
    );
  };

  // ——— Open on the period's last day (§3.4, PERS-113 · 4) ————————————————————————————————————————
  const open = service.holdings
    .filter((row): row is HoldingPnl & { end: PositionAt } => row.end !== null)
    .sort((a, b) => Number((b.end.valueCents ?? 0n) - (a.end.valueCents ?? 0n)));
  const shownCash =
    service.endCashCents !== null && service.endCashCents !== 0n ? service.endCashCents : null;
  const openTotal = open.reduce((sum, row) => sum + (row.end.valueCents ?? 0n), 0n) + (shownCash ?? 0n);
  const share = (cents: Cents | null) =>
    cents === null || openTotal <= 0n ? null : Number(cents) / Number(openTotal);
  const noCost = open.filter((row) => row.end.costCents === null).length;
  type OpenRow = (typeof open)[number];
  const groups: { key: string; label: string | null; rows: OpenRow[]; valueCents: Cents; pnlCents: Cents }[] =
    [];
  for (const row of open) {
    const key = by === "class" ? (assetOf(row.assetId)?.class ?? "other") : "all";
    let group = groups.find((one) => one.key === key);
    if (!group) {
      group = {
        key,
        label: by === "class" ? ti(`classes.${key}` as "classes.stock") : null,
        rows: [],
        valueCents: 0n,
        pnlCents: 0n,
      };
      groups.push(group);
    }
    group.rows.push(row);
    group.valueCents += row.end.valueCents ?? 0n;
    group.pnlCents += row.contributionCents ?? 0n;
  }
  groups.sort((a, b) => Number(b.valueCents - a.valueCents));
  const groupSummary = (group: (typeof groups)[number]) =>
    t("groupSummary", {
      value: money(group.valueCents),
      pnl: money(group.pnlCents, true),
      share: formatPercent(share(group.valueCents), nf),
    });
  const today = new Map(detail.holdings.map((row) => [row.id, row]));
  const summaryOf = (row: HoldingRow): HoldingSummary => ({
    id: row.id,
    name: row.asset.name,
    currency: row.asset.currency,
    origin: row.origin,
    product: row.product,
    byValue: row.state.quantity === null,
    quantityText: row.quantityText,
    conflict: row.conflict,
    readingId: detail.readings[0]?.id ?? null,
    readingOn: detail.readings[0]?.on ?? null,
  });
  // Actions act on today: only on the period still running, and on manual positions (§3.4).
  const actionsOf = (row: HoldingPnl) => {
    const holding = row.holdingId === null || past ? undefined : today.get(row.holdingId);
    if (!holding || holding.origin !== "manual") return null;
    return (
      <span className="flex items-center justify-end gap-1">
        {holding.conflict && <ReconcileButton holding={summaryOf(holding)} context={context} />}
        <HoldingMenu holding={summaryOf(holding)} context={context} />
      </span>
    );
  };
  const assetClass = (assetId: string | null) => assetOf(assetId)?.class ?? null;
  const quantityOf = (position: PositionAt) =>
    position.quantity === null
      ? t("byValue")
      : quantityText(formatDecimal(position.quantity, QUANTITY_SCALE), assetClass(position.assetId), nf);
  const priceOf = (position: PositionAt) =>
    position.unitPrice === null
      ? NULL_DISPLAY
      : priceText(formatDecimal(position.unitPrice, PRICE_SCALE), position.priceCurrency, nf);
  const averageOf = (position: PositionAt) =>
    position.quantity === null || position.quantity <= 0n || position.costCents === null
      ? NULL_DISPLAY
      : priceText(
          formatDecimal(unitPriceOf(position.costCents, position.quantity), PRICE_SCALE),
          currency,
          nf,
        );
  const pnlCell = (row: HoldingPnl) => {
    const cents = row.contributionCents;
    const rate = periodReturnOf(row);
    return (
      <span className="inline-flex flex-col items-end">
        <span className={TONE_TEXT[toneOfSign(cents)]}>{money(cents, true)}</span>
        {cents === null ? (
          <span className="text-xs text-muted">{t("noCost")}</span>
        ) : (
          rate !== null && (
            <span className="text-xs text-muted">{t("periodReturn", { rate: percent(rate) })}</span>
          )
        )}
      </span>
    );
  };
  const onCostCell = (position: PositionAt) => {
    const rate = onCostOf(position);
    return <span className={TONE_TEXT[rate === null ? "muted" : toneOfSign(rate)]}>{percent(rate)}</span>;
  };
  const costBadge = (position: PositionAt) =>
    position.costSource === "inferred" ? <Badge tone="neutral">{t("inferredCost")}</Badge> : null;
  const openTitle = past
    ? t("openAtTitle", { date: formatDate(period.to, "long", ctx.locale) })
    : t("openTitle");
  const startDay = service.from === null ? null : formatDate(addDays(service.from, -1), "long", ctx.locale);
  const pnlHead = short ? t("pnlOf", { period: short }) : t("pnl");

  // ——— Closed: in the period, and ever (S10) ———————————————————————————————————————————————————
  const closedIn = closedGroups(service.exits);
  const closedEver = closedGroups(view.allExits);
  const closed = status === "all" ? closedEver : closedIn;
  const closedTotal = closed.reduce<Cents | null>(
    (sum, group) => (sum === null || group.realizedCents === null ? null : sum + group.realizedCents),
    0n,
  );
  const closedName = (group: ClosedGroup) => {
    const { asset, product, holding } = holdingAsset(group.holdingId);
    return nameCell({
      assetId: asset?.id ?? null,
      product,
      manual: holding?.origin === "manual",
      extra:
        group.positions > 0
          ? t("positionsCount", { count: group.positions })
          : t("exits", { count: group.count }),
    });
  };
  const datesOf = (group: ClosedGroup) =>
    group.openedOn === null
      ? formatDate(group.closedOn, "long", ctx.locale)
      : `${formatDate(group.openedOn, "dayMonth", ctx.locale)} → ${formatDate(group.closedOn, "long", ctx.locale)}`;

  // ——— Contributions to the P&L (PERS-113 · 9) ——————————————————————————————————————————————————
  const contributions = contributionsOf(service);
  const closing = contributions
    ? (
        [
          { key: "income", cents: contributions.incomeCents },
          { key: "fees", cents: contributions.feesCents },
          { key: "corrections", cents: contributions.correctionsCents },
          { key: "valueChange", cents: contributions.valueChangeCents },
          { key: "unattributed", cents: contributions.unattributedCents },
        ] as const
      ).filter((row) => row.cents !== 0n)
    : [];
  const bridge =
    contributions && service.display && currency !== view.currency
      ? t("contributions.bridge", {
          display: formatMoney(service.display.pnlCents, nf, { currency: view.currency, signed: true }),
          fx: formatMoney(service.display.fxCents, nf, { currency: view.currency, signed: true }),
        })
      : null;

  const statusOptions = [
    {
      value: "open",
      label: past ? t("openAt", { date: formatDate(period.to, "dayMonth", ctx.locale) }) : t("open"),
      count: open.length,
    },
    {
      value: "closed",
      label: short ? t("closedIn", { period: short }) : t("closedInPeriod"),
      count: closedIn.length,
    },
    { value: "all", label: t("all"), count: closedEver.length },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={t("status")}
          path={`${base}/positions`}
          params={{ ...periodParams }}
          name="status"
          current={status}
          options={statusOptions}
        />
        {past && status === "open" && (
          <Link
            href={withParams(`${base}/positions`, {}, { status: "open" })}
            className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-sm text-accent hover:underline"
          >
            {t("today")} →
          </Link>
        )}
      </div>

      {service.status === "undetermined" && (
        <p className="text-sm text-warn">{t("undetermined", { period: name })}</p>
      )}

      {status === "open" ? (
        <Card padded={false} className="min-w-0">
          <CardHeader
            title={openTitle}
            actions={
              open.length > 1 ? (
                <span className="flex items-center gap-2">
                  <span className="text-muted max-md:sr-only">{t("groupBy")}</span>
                  <LinkTabs
                    label={t("groupBy")}
                    path={`${base}/positions`}
                    params={{ ...periodParams }}
                    name="by"
                    current={by}
                    options={[
                      { value: "asset", label: t("byAsset") },
                      { value: "class", label: t("byClass") },
                    ]}
                  />
                </span>
              ) : undefined
            }
          />
          {startDay && service.local && (
            <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">
              {t("openNote", { period: name, date: startDay })}
            </p>
          )}
          {open.length === 0 && shownCash === null ? (
            <p data-testid="positions-empty" className="px-4 pb-4 text-sm text-muted">
              {closedEver.length > 0 ? t("emptyWithClosed", { count: closedEver.length }) : t("empty")}{" "}
              {closedEver.length > 0 && (
                <Link
                  href={withParams(`${base}/positions`, {}, { ...periodParams, status: "all" })}
                  className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
                >
                  {t("all")} →
                </Link>
              )}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto max-md:hidden">
                <Table>
                  <THead>
                    <Th>{t("asset")}</Th>
                    <Th align="right">{t("quantity")}</Th>
                    <Th align="right">{t("average")}</Th>
                    <Th align="right">{t("price")}</Th>
                    <Th align="right">{t("value")}</Th>
                    <Th align="right">{pnlHead}</Th>
                    <Th align="right">{t("onCost")}</Th>
                    <Th align="right">{t("share")}</Th>
                    <Th align="right">
                      <span className="sr-only">{t("actions")}</span>
                    </Th>
                  </THead>
                  <TBody>
                    {groups.flatMap((group) => [
                      group.label === null ? null : (
                        <GroupRow
                          key={`group-${group.key}`}
                          colSpan={9}
                          label={group.label}
                          summary={groupSummary(group)}
                        />
                      ),
                      ...group.rows.map((row) => (
                        <Tr key={row.key} data-testid="open-row">
                          <Td className="max-w-64 py-1">
                            {nameCell({
                              assetId: row.assetId,
                              product: row.product,
                              manual: row.end.origin === "manual",
                              badge: costBadge(row.end),
                            })}
                          </Td>
                          <Td align="right">{quantityOf(row.end)}</Td>
                          <Td align="right">{averageOf(row.end)}</Td>
                          <Td align="right">{priceOf(row.end)}</Td>
                          <Td align="right">{money(row.end.valueCents)}</Td>
                          <Td align="right" className="py-1">
                            {pnlCell(row)}
                          </Td>
                          <Td align="right">{onCostCell(row.end)}</Td>
                          <Td align="right">{formatPercent(share(row.end.valueCents), nf)}</Td>
                          <Td align="right">{actionsOf(row)}</Td>
                        </Tr>
                      )),
                    ])}
                    {shownCash !== null && (
                      <Tr data-testid="cash-row">
                        <Td className="py-1">
                          <span className="flex flex-col">
                            <span className="font-medium">{t("cash")}</span>
                            <span className="text-xs text-muted">{t("cashNote", { currency })}</span>
                          </span>
                        </Td>
                        <Td align="right" />
                        <Td align="right" />
                        <Td align="right" />
                        <Td align="right">{money(shownCash)}</Td>
                        <Td align="right">{NULL_DISPLAY}</Td>
                        <Td align="right" />
                        <Td align="right">{formatPercent(share(shownCash), nf)}</Td>
                        <Td align="right" />
                      </Tr>
                    )}
                    <TotalRow label={t("total")}>
                      <Td align="right" />
                      <Td align="right" />
                      <Td align="right" />
                      <Td align="right">{money(openTotal)}</Td>
                      <Td align="right">
                        {money(
                          open.reduce((sum, row) => sum + (row.contributionCents ?? 0n), 0n),
                          true,
                        )}
                      </Td>
                      <Td align="right" />
                      <Td align="right">{openTotal > 0n ? formatPercent(1, nf) : NULL_DISPLAY}</Td>
                      <Td align="right" />
                    </TotalRow>
                  </TBody>
                </Table>
              </div>
              <ul className="flex flex-col md:hidden">
                {groups.flatMap((group) => [
                  group.label === null ? null : (
                    <li
                      key={`group-${group.key}`}
                      data-testid="open-group"
                      className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border bg-bg px-4 py-2 text-sm"
                    >
                      <span className="font-semibold">{group.label}</span>
                      <span className="text-muted tabular-nums">{groupSummary(group)}</span>
                    </li>
                  ),
                  ...group.rows.map((row) => (
                    <li
                      key={row.key}
                      data-testid="open-item"
                      className="flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {nameCell({
                          assetId: row.assetId,
                          product: row.product,
                          manual: row.end.origin === "manual",
                          badge: costBadge(row.end),
                        })}
                        <span className="text-xs text-muted tabular-nums">
                          {t("mobileLine", {
                            quantity: quantityOf(row.end),
                            price: priceOf(row.end),
                            average: averageOf(row.end),
                          })}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
                        <span className="font-medium">{money(row.end.valueCents)}</span>
                        {pnlCell(row)}
                        <span className="text-xs text-muted">
                          {t("onCostShort", { rate: percent(onCostOf(row.end)) })}
                        </span>
                        {actionsOf(row)}
                      </span>
                    </li>
                  )),
                ])}
                {shownCash !== null && (
                  <li className="flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm">
                    <span className="flex flex-col">
                      <span className="font-medium">{t("cash")}</span>
                      <span className="text-xs text-muted">{t("cashNote", { currency })}</span>
                    </span>
                    <span className="font-medium tabular-nums">{money(shownCash)}</span>
                  </li>
                )}
                <li className="flex items-center justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">{money(openTotal)}</span>
                </li>
              </ul>
            </>
          )}
          {noCost > 0 && (
            <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
              {t("noCostNote", { count: noCost })}{" "}
              <Link
                href={withParams(`${base}/connection`, {}, periodParams)}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
              >
                {t("costLink")}
              </Link>
            </p>
          )}
          {view.dust.length > 0 && (
            <details data-testid="dust" className="border-t border-border px-4 py-2.5 text-sm">
              <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted">
                {t("dust", { count: view.dust.length })}
              </summary>
              <p className="mt-1 text-muted">{t("dustNote")}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {view.dust.map((leftover) => {
                  const asset = assetOf(leftover.assetId);
                  return (
                    <li
                      key={`${leftover.assetId}|${leftover.product}`}
                      className="flex justify-between gap-3"
                    >
                      <span className="min-w-0 truncate">
                        {[asset?.name ?? t("unknownAsset"), productLabel(leftover.product, tProduct)].join(
                          " · ",
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {quantityText(leftover.quantity, asset?.class ?? null, nf)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </Card>
      ) : (
        <Card padded={false} className="min-w-0">
          <CardHeader title={status === "all" ? t("allTitle") : t("closedTitle", { period: name })} />
          <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">
            {etoro ? t("closedNoteEtoro") : t("closedNote")}
          </p>
          {closed.length === 0 ? (
            <p data-testid="positions-empty" className="px-4 pb-4 text-sm text-muted">
              {status === "all" ? t("emptyAll") : t("emptyClosed", { period: name })}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto max-md:hidden">
                <Table>
                  <THead>
                    <Th>{t("asset")}</Th>
                    <Th>{t("dates")}</Th>
                    <Th align="right">{etoro ? t("invested") : t("cost")}</Th>
                    <Th align="right">{t("proceeds")}</Th>
                    <Th align="right">{t("realized")}</Th>
                    <Th align="right">{t("onCost")}</Th>
                  </THead>
                  <TBody>
                    {closed.map((group) => (
                      <Tr key={group.holdingId} data-testid="closed-row">
                        <Td className="max-w-64 py-1">{closedName(group)}</Td>
                        <Td>{datesOf(group)}</Td>
                        <Td align="right">{money(group.costCents)}</Td>
                        <Td align="right">{money(group.proceedsCents)}</Td>
                        <Td align="right">
                          <span className={TONE_TEXT[toneOfSign(group.realizedCents)]}>
                            {money(group.realizedCents, true)}
                          </span>
                        </Td>
                        <Td align="right">{percent(group.onCost)}</Td>
                      </Tr>
                    ))}
                    <TotalRow label={t("totalRealized")}>
                      <Td />
                      <Td align="right" />
                      <Td align="right" />
                      <Td align="right">
                        <span
                          data-testid="closed-total"
                          data-cents={closedTotal === null ? "" : String(closedTotal)}
                        >
                          {money(closedTotal, true)}
                        </span>
                      </Td>
                      <Td align="right" />
                    </TotalRow>
                  </TBody>
                </Table>
              </div>
              <ul className="flex flex-col md:hidden">
                {closed.map((group) => (
                  <li
                    key={group.holdingId}
                    data-testid="closed-item"
                    className="flex items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {closedName(group)}
                      <span className="text-xs text-muted">{datesOf(group)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end tabular-nums">
                      <span className={cn("font-medium", TONE_TEXT[toneOfSign(group.realizedCents)])}>
                        {money(group.realizedCents, true)}
                      </span>
                      <span className="text-xs text-muted">
                        {money(group.costCents)} → {money(group.proceedsCents)}
                      </span>
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
                  <span>{t("totalRealized")}</span>
                  <span className="tabular-nums">{money(closedTotal, true)}</span>
                </li>
              </ul>
            </>
          )}
        </Card>
      )}

      {contributions && (
        <Card padded={false} className="min-w-0">
          <CardHeader title={t("contributions.title", { period: name })} />
          <p className="-mt-1.5 px-4 pb-2.5 text-sm text-muted">{t("contributions.note")}</p>
          <ul className="flex flex-col" data-testid="contributions">
            {contributions.rows.length === 0 && (
              <li className="border-t border-border px-4 py-2.5 text-sm text-muted">
                {t("contributions.empty", { period: name })}
              </li>
            )}
            {contributions.rows.map((row) => {
              const width = Math.abs(row.bar) * 50;
              const state = row.costUnknown
                ? t("contributions.noCost")
                : row.open && row.sold
                  ? t("contributions.partlySold")
                  : row.open
                    ? t("contributions.open")
                    : t("contributions.sold");
              return (
                <li
                  key={row.key}
                  data-testid="contribution-row"
                  data-cents={String(row.cents)}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={activityOf(row.assetId)}
                      className="focus-ring inline-flex min-h-6 max-w-full items-center rounded-[4px] font-medium hover:underline"
                    >
                      <span className="truncate">{assetOf(row.assetId)?.name ?? t("unknownAsset")}</span>
                    </Link>
                    <span className="text-xs text-muted">{state}</span>
                  </span>
                  <span
                    aria-hidden
                    className="relative block h-2 w-24 shrink-0 rounded-full bg-track max-md:hidden"
                  >
                    <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        width: `${width}%`,
                        left: row.bar >= 0 ? "50%" : `${50 - width}%`,
                        background: row.bar >= 0 ? "var(--pos)" : "var(--neg)",
                      }}
                    />
                  </span>
                  <span
                    className={cn(
                      "w-28 shrink-0 text-right font-medium tabular-nums",
                      TONE_TEXT[toneOfSign(row.cents)],
                    )}
                  >
                    {money(row.cents, true)}
                  </span>
                </li>
              );
            })}
            {closing.map((row) => (
              <li
                key={row.key}
                data-testid="contribution-part"
                data-cents={String(row.cents)}
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"
              >
                <span className="text-muted">
                  {t(`contributions.${row.key}`)}
                  {row.key === "unattributed" && (
                    <>
                      {" "}
                      <Link
                        href={withParams(`${base}/connection`, {}, periodParams)}
                        className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
                      >
                        {t("costLink")}
                      </Link>
                    </>
                  )}
                </span>
                <span className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[toneOfSign(row.cents)])}>
                  {money(row.cents, true)}
                </span>
              </li>
            ))}
            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-border bg-bg px-4 py-2.5 text-sm font-semibold">
              <span>
                {t("contributions.total")}
                <span className="ml-2 font-normal text-muted">{t("contributions.same")}</span>
              </span>
              <span
                data-testid="positions-total"
                data-cents={String(contributions.totalCents)}
                className={cn("tabular-nums", TONE_TEXT[toneOfSign(contributions.totalCents)])}
              >
                {money(contributions.totalCents, true)}
              </span>
              {bridge && (
                <span data-testid="positions-bridge" className="w-full text-right font-normal text-muted">
                  {bridge}
                </span>
              )}
            </li>
          </ul>
        </Card>
      )}
    </>
  );
}

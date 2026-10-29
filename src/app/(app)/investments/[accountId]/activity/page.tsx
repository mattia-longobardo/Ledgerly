import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ACTIVITY_FAMILIES, type ActivityFamily, describeEvent } from "@/modules/investments/activity";
import { periodQuery, type Query } from "@/modules/investments/period";
import {
  type ActivityRow,
  ACTIVITY_PAGE_SIZE,
  serviceActivity,
  servicePnlView,
} from "@/modules/investments/queries";
import {
  LinkBankButton,
  LinkTransferButton,
  OperationMenu,
  UnlinkTransferButton,
} from "@/modules/investments/ui/dialogs";
import { requireSession } from "@/platform/auth/session";
import { daysBetween, type MonthKey } from "@/platform/dates";
import { formatDate, formatMoney, monthName } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/input";
import { KpiTile } from "@/ui/kpi-tile";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { type Params, withParams } from "@/ui/url";
import { loadService, operationOf, serviceContextOf } from "../service-data";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * A service's Activity (docs/design/investments-ux.md §3.5, U3): the money in and out of the period
 * and its fees, then the events — fifty a page, paged by the database — grouped by month, filtered
 * by chip, by search or by asset, each told in one sentence, never in its legs.
 */
export default async function InvestmentServiceActivity({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]/activity">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const query = (await searchParams) as Query;
  const t = await getTranslations("investments");
  const ta = await getTranslations("investments.activity");
  const base = `/investments/${accountId}/activity`;

  const family = (ACTIVITY_FAMILIES as readonly string[]).includes(one(query.type) ?? "")
    ? (one(query.type) as ActivityFamily)
    : null;
  const q = one(query.q)?.trim() || null;
  const assetId = one(query.asset) || null;
  const page = Number(one(query.p) ?? "1") || 1;

  const [detail, pnl] = await Promise.all([
    loadService(accountId),
    servicePnlView(ctx, accountId, { period: one(query.period), from: one(query.from), to: one(query.to) }),
  ]);
  if (!detail || !pnl) notFound();
  const { span, period } = pnl;
  const assetName =
    assetId === null ? null : (detail.assets.find((asset) => asset.id === assetId)?.name ?? null);
  const activity = await serviceActivity(ctx, accountId, {
    from: span.from,
    to: span.to,
    family,
    q,
    assetId: assetName === null ? null : assetId,
    page,
  });
  if (!activity) notFound();
  const context = serviceContextOf(detail, ctx);
  const service = pnl.portfolio.services[0];
  const currency = detail.currency;
  const money = (cents: Cents | null, signed = false) =>
    formatMoney(cents, ctx.numberFormat, { currency, signed });

  /** Every parameter of the tab as it stands: a link changes one and keeps the rest. */
  const current: Params = {
    ...periodQuery(period, pnl.todayOn),
    type: family ?? undefined,
    q: q ?? undefined,
    asset: assetName === null ? undefined : (assetId ?? undefined),
  };
  const href = (changes: Params) => withParams(base, current, { p: undefined, ...changes });

  // What a sale realized, by event and by month (§3.5, S5): the engine's exits of the period.
  const realizedOf = new Map<string, Cents>();
  for (const exit of service.exits) {
    if (exit.realizedCents === null) continue;
    realizedOf.set(exit.eventId, (realizedOf.get(exit.eventId) ?? 0n) + exit.realizedCents);
  }
  const realizedIn = (month: MonthKey) =>
    service.exits
      .filter((exit) => exit.on.startsWith(month) && exit.realizedCents !== null)
      .reduce<Cents>((sum, exit) => sum + exit.realizedCents!, 0n);
  const countOf = new Map(activity.months.map((row) => [row.month, row.count]));

  const describe = (row: ActivityRow) =>
    describeEvent(
      { leg: row.leg, note: row.note, counterpart: row.transfer?.accountName ?? row.linked?.payee ?? null },
      (key, values) => ta(key as "sentence", values as { label: string; detail: string }),
      ctx.numberFormat,
    );
  /** A bank movement of the same amount within three days: only then is a link offered (S16). */
  const linkable = (row: ActivityRow) => {
    if (row.origin !== "manual" || row.transactionId !== null || row.transfer !== null) return false;
    if (row.leg.kind !== "deposit" && row.leg.kind !== "withdrawal") return false;
    const amount = row.leg.amountCents < 0n ? -row.leg.amountCents : row.leg.amountCents;
    const options = row.leg.kind === "deposit" ? context.linkOptions.out : context.linkOptions.in;
    return options.some((option) => option.cents === amount && Math.abs(daysBetween(option.on, row.on)) <= 3);
  };
  const extra = (row: ActivityRow) => {
    const lines = [];
    if (linkable(row))
      lines.push(<LinkBankButton key="link" operation={operationOf(row)} context={context} />);
    if (row.origin === "conversion")
      lines.push(
        <span key="conversion" className="text-muted">
          {t("operations.conversion")}
        </span>,
      );
    if (row.leg.kind === "adjustment" && row.adjustmentClass && row.adjustmentClass !== "data")
      lines.push(
        <span key="class" className="text-muted">
          {t(`operationForm.classes.${row.adjustmentClass}`)}
        </span>,
      );
    return lines;
  };
  const actions = (row: ActivityRow) => (
    <span className="flex items-center justify-end gap-1">
      {row.transfer && (
        <UnlinkTransferButton
          accountId={accountId}
          eventId={row.id}
          label={`${t("operations.transferWith", { name: row.transfer.accountName })}, ${formatDate(row.on, "long", ctx.locale)}`}
        />
      )}
      <OperationMenu operation={operationOf(row)} context={context} />
    </span>
  );
  const pnlCell = (row: ActivityRow) => {
    const realized = realizedOf.get(row.id) ?? null;
    return realized === null ? null : (
      <span className={TONE_TEXT[toneOfSign(realized)]}>{money(realized, true)}</span>
    );
  };

  // The rows of the page under the heading of their month (§3.5).
  const groups: { month: MonthKey; rows: ActivityRow[] }[] = [];
  for (const row of activity.rows) {
    const month = row.on.slice(0, 7) as MonthKey;
    if (groups.at(-1)?.month !== month) groups.push({ month, rows: [] });
    groups.at(-1)!.rows.push(row);
  }
  const monthHeading = (month: MonthKey) => {
    const realized = realizedIn(month);
    return [
      t("activityTab.month", {
        month: capitalized(`${monthName(`${month}-01`, ctx.locale, "long")} ${month.slice(0, 4)}`),
        count: countOf.get(month) ?? 0,
      }),
      realized !== 0n ? t("activityTab.monthRealized", { amount: money(realized, true) }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const net = activity.sums.depositsCents + activity.sums.withdrawalsCents;
  const first = activity.total === 0 ? 0 : (activity.page - 1) * ACTIVITY_PAGE_SIZE + 1;
  const last = Math.min(activity.page * ACTIVITY_PAGE_SIZE, activity.total);
  const chips: (ActivityFamily | "all")[] = [
    "all",
    ...ACTIVITY_FAMILIES.filter((key) => activity.counts[key] > 0 || key === family),
  ];
  const pageLink =
    "focus-ring inline-grid size-7 place-items-center rounded-ctl border border-border bg-card hover:bg-hover";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
        <KpiTile
          label={t("activityTab.deposits")}
          value={money(activity.sums.depositsCents, true)}
          valueTone={toneOfSign(activity.sums.depositsCents)}
        />
        <KpiTile
          label={t("activityTab.withdrawals")}
          value={money(activity.sums.withdrawalsCents, true)}
          valueTone={toneOfSign(activity.sums.withdrawalsCents)}
        />
        <KpiTile
          label={t("activityTab.net")}
          value={money(net, true)}
          note={
            net > 0n
              ? t("activityTab.netPositive")
              : net < 0n
                ? t("activityTab.netNegative")
                : t("activityTab.netZero")
          }
        />
        <KpiTile
          label={t("activityTab.fees")}
          value={money(activity.sums.feesCents, true)}
          valueTone={toneOfSign(activity.sums.feesCents)}
          note={t("activityTab.feesNote")}
        />
      </div>

      {detail.transferProposals.length > 0 && (
        <Card padded={false} className="min-w-0" data-testid="transfer-proposals">
          <CardHeader title={t("transfers.title")} />
          <p className="px-4 text-sm text-muted">{t("transfers.description")}</p>
          <ul className="flex flex-col pt-2">
            {detail.transferProposals.map((proposal) => {
              const text = t(`transfers.${proposal.direction}`, {
                date: formatDate(proposal.on, "long", ctx.locale),
                name: proposal.other.accountName,
                other: formatDate(proposal.other.on, "long", ctx.locale),
              });
              return (
                <li
                  key={`${proposal.withdrawalId}:${proposal.depositId}`}
                  data-testid="transfer-proposal"
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm"
                >
                  <span className="min-w-0">{text}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-medium tabular-nums">{money(proposal.amountCents)}</span>
                    <LinkTransferButton
                      accountId={accountId}
                      withdrawalId={proposal.withdrawalId}
                      depositId={proposal.depositId}
                      label={text}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card padded={false} className="min-w-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label={t("activityTab.chips")} className="flex flex-wrap gap-1.5">
              {chips.map((key) => {
                const active = (family ?? "all") === key;
                return (
                  <Link
                    key={key}
                    href={href({ type: key === "all" ? undefined : key })}
                    aria-current={active ? "true" : undefined}
                    data-testid="activity-chip"
                    className={cn(
                      "focus-ring inline-flex min-h-7 items-center rounded-full border px-3 text-sm font-medium",
                      active ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
                    )}
                  >
                    {t("activityTab.chip", {
                      label: t(`activityTab.families.${key}`),
                      count: String(activity.counts[key]),
                    })}
                  </Link>
                );
              })}
            </nav>
            <form action={base} className="flex items-center gap-2" role="search">
              {Object.entries({ ...current, q: undefined }).map(([key, value]) =>
                value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />,
              )}
              <Input
                name="q"
                type="search"
                defaultValue={q ?? ""}
                aria-label={t("activityTab.search")}
                placeholder={t("activityTab.search")}
                className="w-56 max-md:w-full"
              />
              <Button type="submit" size="sm">
                {t("activityTab.searchSubmit")}
              </Button>
            </form>
          </div>
          {assetName !== null && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="accent">{t("activityTab.asset", { name: assetName })}</Badge>
              <Link
                href={href({ asset: undefined })}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
              >
                {t("activityTab.assetAll")}
              </Link>
            </p>
          )}
        </div>

        {activity.rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">
            {q || family || assetName ? t("activityTab.emptyFiltered") : t("activityTab.empty")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("activityTab.date")}</Th>
                  <Th>{t("activityTab.type")}</Th>
                  <Th>{t("activityTab.description")}</Th>
                  <Th align="right">{t("activityTab.pnl")}</Th>
                  <Th align="right">{t("activityTab.amount")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("activityTab.actions")}</span>
                  </Th>
                </THead>
                {groups.map((group) => (
                  <TBody key={group.month}>
                    <tr className="h-8 border-b border-border bg-bg">
                      <th
                        scope="colgroup"
                        colSpan={6}
                        className="px-4 text-left text-sm font-semibold"
                        data-testid="activity-month"
                      >
                        {monthHeading(group.month)}
                      </th>
                    </tr>
                    {group.rows.map((row) => {
                      const text = describe(row);
                      const lines = extra(row);
                      return (
                        <Tr key={row.id} data-testid="activity-row">
                          <Td muted>{formatDate(row.on, "dayMonth", ctx.locale)}</Td>
                          <Td>{text.label}</Td>
                          <Td className="py-1 whitespace-normal">
                            <span className="flex flex-col">
                              {text.detail !== null && <span>{text.detail}</span>}
                              {lines.length > 0 && (
                                <span className="flex flex-wrap items-center gap-x-2 text-xs">{lines}</span>
                              )}
                            </span>
                          </Td>
                          <Td align="right">{pnlCell(row)}</Td>
                          <Td align="right" className="font-medium">
                            {money(row.leg.amountCents, true)}
                          </Td>
                          <Td align="right">{actions(row)}</Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                ))}
              </Table>
            </div>
            <div className="flex flex-col md:hidden">
              {groups.map((group) => (
                <section key={group.month} aria-label={monthHeading(group.month)}>
                  <h3 className="border-t border-border bg-bg px-4 py-2 text-sm font-semibold">
                    {monthHeading(group.month)}
                  </h3>
                  <ul className="flex flex-col">
                    {group.rows.map((row) => {
                      const text = describe(row);
                      const lines = extra(row);
                      const realized = pnlCell(row);
                      return (
                        <li
                          key={row.id}
                          data-testid="activity-item"
                          className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span>
                              {text.detail === null ? text.label : `${text.label} · ${text.detail}`}
                            </span>
                            <span className="text-xs text-muted">
                              {formatDate(row.on, "long", ctx.locale)}
                              {realized && <> · {realized}</>}
                            </span>
                            {lines.length > 0 && (
                              <span className="flex flex-wrap items-center gap-x-2 text-xs">{lines}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="font-medium tabular-nums">
                              {money(row.leg.amountCents, true)}
                            </span>
                            {actions(row)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
          <span data-testid="activity-range" className="text-muted tabular-nums">
            {t("activityTab.range", {
              first: String(first),
              last: String(last),
              total: String(activity.total),
              allTime: String(activity.allTime),
            })}
          </span>
          <span className="flex items-center gap-1.5">
            {activity.page > 1 ? (
              <Link
                href={href({ p: activity.page - 1 === 1 ? undefined : String(activity.page - 1) })}
                aria-label={t("activityTab.previous")}
                className={pageLink}
              >
                ‹
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-label={t("activityTab.previous")}
                className={cn(pageLink, "text-faint")}
              >
                ‹
              </button>
            )}
            {activity.page < activity.pages ? (
              <Link
                href={href({ p: String(activity.page + 1) })}
                aria-label={t("activityTab.next")}
                className={pageLink}
              >
                ›
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-label={t("activityTab.next")}
                className={cn(pageLink, "text-faint")}
              >
                ›
              </button>
            )}
          </span>
        </div>
      </Card>
    </>
  );
}

/** "giugno 2026" → "Giugno 2026": a heading starts with a capital in every language. */
function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

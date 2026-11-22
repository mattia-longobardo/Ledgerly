"use client";

// Overview, read from `/api/v1` (rewrite plan R3): the net worth, its buckets, its chart and the
// accounts are fields of `GET /net-worth`, the budgets card reads `GET /budgets/overview`, the pockets
// tile `GET /pockets/overview`. The accounts are listed by bucket, each with the tile's figure as its
// subtotal, and the investments in the two groups of Investments (rewrite plan R5b, decision O1).
import Link from "next/link";
import { Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { views } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { today } from "@ledgerly/format/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY, numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Loaded } from "@ledgerly/ui/loaded";
import { parsePeriodQuery } from "@ledgerly/ui/period";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { type CardFormat, centsOf, counterValue, NetWorthCard } from "@/modules/accounts/client";
import { BudgetsOverviewCard } from "@/modules/budgets";
import { PocketsOverviewTile } from "@/modules/pockets";
import { appRoute } from "@/platform/route";
import { useAddonOn } from "./addons-context";
import { TodoCard } from "./todo-card";

type NetWorth = RouteOutput<typeof views.getNetWorth>;
type ViewRow = NetWorth["accounts"][number];

export function OverviewScreen() {
  const text = useTranslations("overview");
  const accountsText = useTranslations("accounts");
  const preferences = useApi(profile.getPreferences, {});
  // The hero, the KPIs and the table always speak of today; only the chart follows the period of
  // the Expenses control (spec §7.1, F2.5, PERS-342), inside `NetWorthCard`.
  const read = useApi(views.getNetWorth, {});
  const empty = read.data === undefined || read.data.accounts.length === 0;
  return (
    <Page
      title={text("title")}
      actions={
        empty ? undefined : (
          <ButtonLink href="/accounts/new" variant="primary" size="sm">
            {accountsText("add")}
          </ButtonLink>
        )
      }
    >
      <Loaded state={preferences}>
        {(prefs) => (
          <Loaded state={read}>
            {(view) => (
              <OverviewView
                view={view}
                format={{ locale: prefs.locale, timeZone: prefs.timeZone, numberFormat: numberStyle(prefs) }}
              />
            )}
          </Loaded>
        )}
      </Loaded>
    </Page>
  );
}

function OverviewView({ view, format }: { view: NetWorth; format: CardFormat }) {
  const text = useTranslations("overview");
  const accountsText = useTranslations("accounts");
  const search = useSearchParams();
  // The blocks of an addon that is off go (PA10); net worth and its buckets do not change (PA11).
  const pockets = useAddonOn("pockets");
  const budgets = useAddonOn("budgets");

  if (view.accounts.length === 0) return <NoAccounts />;

  const todayOn = today(format.timeZone);
  const kpis = [
    { key: "cash", bucket: view.buckets.cash },
    { key: "savings", bucket: view.buckets.savings },
    { key: "investments", bucket: view.buckets.investments },
  ] as const;

  return (
    <>
      <Hero view={view} format={format} />

      {view.totalPartial && <p className="text-sm text-warn">{text("partial")}</p>}
      {view.missingRates.length > 0 && (
        <p className="text-sm text-warn">
          {accountsText("missingRate", { currencies: view.missingRates.join(", "), currency: view.currency })}
        </p>
      )}

      <TodoCard locale={format.locale} />

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        {kpis.map(({ key, bucket }) => (
          <KpiTile
            key={key}
            label={text(`kpis.${key}`)}
            value={displayMoney(bucket.total, view, format)}
            note={accountsText("countAccounts", { count: bucket.count })}
          />
        ))}
        {/* The fourth tile of the design, deferred by F1 until pockets existed (F3). */}
        {pockets && <PocketsOverviewTile numberFormat={format.numberFormat} />}
      </div>

      {/* Past the wide threshold the chart and the accounts sit side by side (spec §8.2, F2.5). */}
      {/* `minmax(0,1fr)` also in one column: an auto track takes the widest child's min-content
          width — a table's — and the cards would then reach past the page (400 px). */}
      {/* The cells stretch, so the accounts card ends where the net-worth card does. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @wide:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <NetWorthCard
          format={format}
          period={parsePeriodQuery(Object.fromEntries(search.entries()), todayOn)}
          path="/"
        />
        <AccountsCard view={view} format={format} />
      </div>

      {/* The card spans the page's whole column, and so do its rows' bars (spec §8.2). */}
      {budgets && <BudgetsOverviewCard format={format} />}
    </>
  );
}

function NoAccounts() {
  const text = useTranslations("overview");
  return (
    <>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
      <EmptyState
        title={text("empty.title")}
        description={text("empty.description")}
        actions={
          <ButtonLink href="/accounts/new" variant="primary">
            {text("empty.cta")}
          </ButtonLink>
        }
      />
    </>
  );
}

/** Every total on the page is in the display currency (§1.8, D1); each account row in its own. */
function displayMoney(amount: string | null, view: NetWorth, format: CardFormat, signed = false): string {
  return formatMoney(centsOf(amount), format.numberFormat, { signed, currency: view.currency });
}

function Hero({ view, format }: { view: NetWorth; format: CardFormat }) {
  const text = useTranslations("overview");
  const total = (amount: string | null, signed = false) => displayMoney(amount, view, format, signed);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-sm font-medium text-muted">
          {text("netWorth.on", { date: formatDate(today(format.timeZone), "long", format.locale) })}
        </h1>
        <p className="text-hero font-semibold tracking-title">{total(view.total)}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("font-medium", TONE_TEXT[toneOfSign(centsOf(view.change.amount))])}>
            {total(view.change.amount, true)}
            {view.change.fraction !== null &&
              ` (${formatPercent(view.change.fraction, format.numberFormat, { signed: true })})`}
          </span>
          <span className="text-muted">{text("netWorth.vsLastMonth")}</span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className="text-muted">
            {text("netWorth.ytd", { value: total(view.yearToDate.amount, true) })}
          </span>
        </p>
      </div>
      <p className="text-sm text-muted">
        {view.lastSnapshotMonth
          ? text("lastSnapshot", { date: formatDate(view.lastSnapshotMonth, "monthYear", format.locale) })
          : text("noSnapshot")}
      </p>
    </div>
  );
}

/** An account's figures in its own currency, and its line in the display one. */
function figuresOf(row: ViewRow, view: NetWorth, format: CardFormat) {
  const change = centsOf(row.change.amount);
  return {
    balance: formatMoney(centsOf(row.balance), format.numberFormat, { currency: row.currency }),
    counter: counterValue(
      { currency: row.currency, display: { balance: centsOf(row.display.balance) } },
      view.currency,
      format.numberFormat,
    ),
    change:
      change === null
        ? NULL_DISPLAY
        : formatMoney(change, format.numberFormat, { signed: true, currency: row.currency }),
    tone: TONE_TEXT[toneOfSign(change)],
  };
}

const BUCKET_KEYS = ["cash", "savings", "investments", "other"] as const;

/** A group of the list: a bucket, or a group of Investments inside «Investments». */
interface Group {
  key: string;
  label: string;
  /** The tile's figure, or the group's of `investmentGroups`: never added up here. */
  total: string | null;
  rows: ViewRow[];
  nested: boolean;
}

/** The groups in the tiles' order; a bucket with no account is left out. */
function useGroups(view: NetWorth): Group[] {
  const text = useTranslations("overview");
  const portfolio = useTranslations("investments.portfolio");
  return BUCKET_KEYS.flatMap((key): Group[] => {
    const rows = view.accounts.filter((row) => row.bucket === key);
    if (rows.length === 0) return [];
    const bucket = { key, label: text(`groups.${key}`), total: view.buckets[key].total, nested: false };
    if (key !== "investments") return [{ ...bucket, rows }];
    return [
      { ...bucket, rows: [] },
      ...view.investmentGroups.map((group) => ({
        key: group.id,
        label: portfolio(`groups.${group.id}`),
        total: group.total,
        rows: rows.filter((row) => row.investmentGroup === group.id),
        nested: true,
      })),
    ];
  });
}

/** An investment leads to Investments, to its group; with Investments off, to the account (PA11). */
function useRowHref(): (row: ViewRow) => string {
  const investments = useAddonOn("investments");
  return (row) =>
    investments && row.investmentGroup !== null
      ? `/investments?group=${row.investmentGroup}`
      : `/accounts/${row.id}`;
}

/** The group's name and its subtotal, the figure of its tile. */
function GroupLabel({ group, view, format }: { group: Group; view: NetWorth; format: CardFormat }) {
  return (
    <span className={cn("flex w-full items-center justify-between gap-2", group.nested && "pl-3")}>
      <span className={group.nested ? "font-medium" : "font-semibold"}>{group.label}</span>
      <span
        data-testid={`overview-group-${group.key}`}
        data-cents={String(centsOf(group.total) ?? "")}
        className="font-semibold tabular-nums"
      >
        {displayMoney(group.total, view, format)}
      </span>
    </span>
  );
}

function AccountsCard({ view, format }: { view: NetWorth; format: CardFormat }) {
  const text = useTranslations("overview");
  const accountsText = useTranslations("accounts");
  const groups = useGroups(view);
  const hrefOf = useRowHref();
  return (
    <Card padded={false}>
      <CardHeader
        title={accountsText("title")}
        actions={
          <Link
            href="/accounts"
            className="focus-ring inline-flex h-6 items-center rounded-xs text-accent hover:underline"
          >
            {text("manageAccounts")}
          </Link>
        }
      />
      <DesktopTable view={view} format={format} groups={groups} hrefOf={hrefOf} />
      {/* A phone gets the same rows as a list: a four-column table cannot fit 400 px. */}
      <PhoneList view={view} format={format} groups={groups} hrefOf={hrefOf} />
    </Card>
  );
}

/** From `md`: one table, a header row per group with its subtotal, then its accounts. */
function DesktopTable({
  view,
  format,
  groups,
  hrefOf,
}: {
  view: NetWorth;
  format: CardFormat;
  groups: Group[];
  hrefOf: (row: ViewRow) => string;
}) {
  const accountsText = useTranslations("accounts");
  return (
    <div className="overflow-x-auto max-md:hidden">
      <Table>
        <THead>
          <Th>{accountsText("columns.name")}</Th>
          <Th>{accountsText("columns.type")}</Th>
          <Th align="right">{accountsText("columns.balance")}</Th>
          <Th align="right">{accountsText("columns.monthlyChange")}</Th>
        </THead>
        <TBody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <GroupRow colSpan={4} label={<GroupLabel group={group} view={view} format={format} />} />
              {group.rows.map((row) => {
                const figures = figuresOf(row, view, format);
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={appRoute(hrefOf(row))}
                        className="focus-ring inline-flex h-6 items-center rounded-xs font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                    </Td>
                    <Td muted>{accountsText(`types.${row.type}`)}</Td>
                    <Td align="right">
                      {figures.balance}
                      {figures.counter && <span className="block text-sm text-muted">{figures.counter}</span>}
                    </Td>
                    <Td align="right" className={figures.tone}>
                      {figures.change}
                    </Td>
                  </Tr>
                );
              })}
            </Fragment>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function PhoneList({
  view,
  format,
  groups,
  hrefOf,
}: {
  view: NetWorth;
  format: CardFormat;
  groups: Group[];
  hrefOf: (row: ViewRow) => string;
}) {
  const accountsText = useTranslations("accounts");
  return (
    <ul className="flex flex-col md:hidden">
      {groups.map((group) => (
        <li key={group.key} className="border-b border-border last:border-0">
          <div className="bg-bg px-4 py-2 text-sm">
            <GroupLabel group={group} view={view} format={format} />
          </div>
          <ul>
            {group.rows.map((row) => {
              const figures = figuresOf(row, view, format);
              return (
                <li key={row.id} data-testid="overview-account-item" className="border-t border-border">
                  <Link
                    href={appRoute(hrefOf(row))}
                    className="flex items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="text-sm text-muted">{accountsText(`types.${row.type}`)}</span>
                    </span>
                    <span className="flex flex-col items-end tabular-nums">
                      <span className="font-semibold">{figures.balance}</span>
                      {figures.counter && <span className="text-sm text-muted">{figures.counter}</span>}
                      <span className={cn("text-sm", figures.tone)}>{figures.change}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

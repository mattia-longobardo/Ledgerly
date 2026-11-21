"use client";

// One rule (plan F4 §3.6.12), read from `/api/v1` (rewrite plan R3): its payouts reconciled with what
// was paid (spec §7.6), and its days. Every figure is a field of `GET /interests/{id}`; the screen
// formats it.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { interests } from "@ledgerly/api-contract/interests";
import type { RouteOutput } from "@ledgerly/api-client";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import {
  draftOf,
  type Format,
  formatRate,
  PostingCell,
  RuleButton,
  RuleStateButton,
  TierChips,
  useFormat,
  useTierChips,
} from "@/modules/interests/client";
import { useCategoryOptions } from "@/platform/category-options";

type Detail = RouteOutput<typeof interests.getInterestRule>;
type Settlement = Detail["settlements"][number];

const STATUS_TONE = {
  no_data: "bg-hover text-muted",
  indeterminate: "bg-warn-bg text-warn",
  matched: "bg-pos-bg text-pos",
  missing: "bg-neg-bg text-neg",
  delayed: "bg-warn-bg text-warn",
  anomalous: "bg-neg-bg text-neg",
} as const;

/** How many settlements the page lists. */
const MAX_SETTLEMENTS = 90;

interface Props {
  detail: Detail;
  format: Format;
}

function Header({ detail, format }: Props) {
  const text = useTranslations("interests");
  const { rule } = detail;
  const chips = useTierChips(rule.tiers, format.numberFormat);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted">
        {text("detail.summary", {
          account: rule.account,
          settlement: text(`settlement.${rule.settlement}`),
          basis: text(`basis.${rule.dayBasis}`),
        })}{" "}
        · {text("from", { date: formatDate(rule.validFrom, "long", format.locale) })}
        {rule.validTo && ` · ${text("to", { date: formatDate(rule.validTo, "long", format.locale) })}`}
      </p>
      <h1 className="text-title font-semibold tracking-title">{rule.account}</h1>
      <TierChips chips={chips}>
        <span className="rounded-tag border border-border px-1.5 py-0.5 text-xs text-muted">
          {text("columns.tax")} {formatRate(rule.tax, format.numberFormat)}
        </span>
      </TierChips>
    </div>
  );
}

/**
 * The accrual job refuses to accrue on a reading it does not trust (spec §7.6): said here, where the
 * days stop, rather than left as an unexplained gap in the ledger below.
 */
function StaleBalance({ detail, format }: Props) {
  const text = useTranslations("interests");
  const { balance } = detail;
  if (!balance.staleForAccrual || detail.rule.state !== "active") return null;
  return (
    <p role="status" className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">
      {balance.lastSyncedAt === null
        ? text("detail.balance.never")
        : text("detail.balance.stale", {
            when: formatDate(
              civilDateIn(new Date(balance.lastSyncedAt), format.timeZone),
              "long",
              format.locale,
            ),
          })}
    </p>
  );
}

function Kpis({ detail, format }: Props) {
  const text = useTranslations("interests");
  const { rule } = detail;
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <KpiTile label={text("detail.accruedYtd")} value={format.money(detail.accruedYtd)} valueTone="pos" />
      <KpiTile label={text("detail.pending")} value={format.money(detail.pending)} />
      <KpiTile
        label={text("detail.mode")}
        value={text(`detail.modes.${rule.mode}`)}
        note={rule.mode === "post_to_provider" ? (detail.category ?? text("detail.noCategory")) : undefined}
      />
      <KpiTile label={text("columns.status")} value={text(`state.${rule.state}`)} />
    </div>
  );
}

function Period({ row, format }: { row: Settlement; format: Format }) {
  return (
    <>
      {formatDate(row.periodFrom, "dayMonth", format.locale)} –{" "}
      {formatDate(row.periodTo, "long", format.locale)}
    </>
  );
}

function StatusBadge({ row, className }: { row: Settlement; className?: string }) {
  const text = useTranslations("interests");
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[row.status], className)}>
      {text(`detail.reconciliation.${row.status}`)}
    </span>
  );
}

interface RowsProps {
  rows: Settlement[];
  format: Format;
  /** The posting cell of a row; null for a rule that does not publish. */
  posting: ((row: Settlement) => ReactNode) | null;
}

function useDays() {
  const text = useTranslations("interests");
  return (row: Settlement) =>
    text("detail.settlements.daysValue", { accrued: row.accruedDays, skipped: row.skippedDays });
}

function SettlementTable({ rows, format, posting }: RowsProps) {
  const text = useTranslations("interests");
  const days = useDays();
  return (
    <div className="overflow-x-auto max-md:hidden">
      <Table>
        <THead>
          <Th>{text("detail.settlements.period")}</Th>
          <Th>{text("detail.settlements.days")}</Th>
          <Th align="right">{text("detail.settlements.gross")}</Th>
          <Th align="right">{text("detail.settlements.tax")}</Th>
          <Th align="right">{text("detail.settlements.net")}</Th>
          <Th align="right">{text("detail.settlements.paid")}</Th>
          <Th>{text("detail.settlements.status")}</Th>
          {posting && <Th>{text("detail.settlements.posting")}</Th>}
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.id} data-testid="settlement-row">
              <Td>
                <Period row={row} format={format} />
              </Td>
              <Td muted className="text-sm">
                {days(row)}
              </Td>
              <Td align="right">{format.money(row.gross)}</Td>
              <Td align="right" muted>
                {format.money(row.tax)}
              </Td>
              <Td align="right" className="font-semibold">
                {format.money(row.net)}
              </Td>
              <Td align="right">{format.money(row.paid)}</Td>
              <Td>
                <StatusBadge row={row} />
              </Td>
              {posting && <Td>{posting(row)}</Td>}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function SettlementList({ rows, format, posting }: RowsProps) {
  const text = useTranslations("interests");
  const days = useDays();
  return (
    <ul className="flex flex-col md:hidden">
      {rows.map((row) => (
        <li
          key={row.id}
          data-testid="settlement-row"
          className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 font-medium">
              <Period row={row} format={format} />
            </span>
            <StatusBadge row={row} className="shrink-0" />
          </div>
          <span className="text-sm text-muted">{days(row)}</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
            <span>
              {text("detail.settlements.gross")} {format.money(row.gross)}
            </span>
            <span className="text-muted">
              {text("detail.settlements.tax")} {format.money(row.tax)}
            </span>
            <span className="font-semibold">
              {text("detail.settlements.net")} {format.money(row.net)}
            </span>
            <span>
              {text("detail.settlements.paid")} {format.money(row.paid)}
            </span>
          </div>
          {posting?.(row)}
        </li>
      ))}
    </ul>
  );
}

function Settlements({ detail, format }: Props) {
  const text = useTranslations("interests");
  const { rule } = detail;
  const rows = detail.settlements.slice(0, MAX_SETTLEMENTS);
  const posting =
    rule.mode === "post_to_provider"
      ? (row: Settlement) => (
          <PostingCell ruleId={rule.id} entryId={row.id} posting={row.posting} error={row.postingError} />
        )
      : null;
  return (
    <Card padded={false}>
      <CardHeader title={text("detail.settlements.title")} />
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("detail.settlements.empty")}</p>
      ) : (
        <>
          {/* Seven columns do not fit a phone: below `md` the same settlements are a list, and
            nothing they carry is dropped (plan F9 §3.3). */}
          <SettlementTable rows={rows} format={format} posting={posting} />
          <SettlementList rows={rows} format={format} posting={posting} />
        </>
      )}
    </Card>
  );
}

function Days({ detail, format }: Props) {
  const text = useTranslations("interests");
  return (
    <Card padded={false}>
      <CardHeader
        title={text("detail.days.title")}
        actions={
          <span className="text-sm text-muted">
            {text("detail.days.subtitle", { count: detail.days.length })}
          </span>
        }
      />
      {detail.days.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("detail.days.empty")}</p>
      ) : (
        // A region that scrolls has to be reachable by keyboard, and it needs a name to be worth
        // reaching (axe `scrollable-region-focusable`, plan F9 P2).
        <div
          tabIndex={0}
          role="region"
          aria-label={text("detail.days.title")}
          className="focus-ring max-h-[420px] overflow-y-auto"
        >
          <Table>
            <THead>
              <Th>{text("detail.days.date")}</Th>
              <Th align="right">{text("detail.days.balance")}</Th>
              <Th align="right">{text("detail.days.net")}</Th>
              <Th>
                <span className="sr-only">{text("columns.status")}</span>
              </Th>
            </THead>
            <TBody>
              {detail.days.map((day) => (
                <Tr key={day.id} data-testid="accrual-row">
                  <Td muted>{formatDate(day.on, "long", format.locale)}</Td>
                  <Td align="right">{format.money(day.balance)}</Td>
                  <Td align="right">{format.money(day.net)}</Td>
                  <Td className={cn("text-sm", day.status === "accrued" ? "text-muted" : "text-warn")}>
                    {day.status === "accrued" ? null : text(`detail.days.statuses.${day.status}`)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export function RuleScreen({ id }: { id: string }) {
  const text = useTranslations("interests");
  const read = useApi(interests.getInterestRule, { params: { id } });
  // The accounts a rule can move to, each saying whether it can publish: the dialog's list.
  const accounts = useApi(interests.listInterestRules, {}).data?.accounts;
  const format = useFormat();
  // An interest payout is income: those are the categories a published settlement is filed under.
  const categories = useCategoryOptions("income");
  const detail = read.data;
  const rule = detail?.rule;
  const actions = rule && format && accounts && categories && (
    <>
      <RuleStateButton
        id={rule.id}
        state={rule.state === "active" ? "paused" : "active"}
        label={rule.state === "active" ? text("detail.pause") : text("detail.resume")}
        toast={rule.state === "active" ? text("toasts.paused") : text("toasts.resumed")}
      />
      <RuleButton
        draft={draftOf(rule, format.numberFormat)}
        accounts={accounts}
        categories={categories}
        label={text("detail.edit")}
      />
    </>
  );

  return (
    <Page
      title={rule?.account ?? text("title")}
      parent={{ href: "/interests", label: text("detail.back") }}
      actions={actions}
    >
      <Loaded state={read}>
        {(loaded) =>
          format ? (
            <>
              <Header detail={loaded} format={format} />
              <StaleBalance detail={loaded} format={format} />
              <Kpis detail={loaded} format={format} />
              <Settlements detail={loaded} format={format} />
              <Days detail={loaded} format={format} />
            </>
          ) : null
        }
      </Loaded>
    </Page>
  );
}

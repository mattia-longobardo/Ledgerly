import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@/modules/accounts/queries";
import { categoryOptions } from "@/modules/transactions/taxonomy";
import { ruleDetail } from "@/modules/interests/queries";
import { InterestError } from "@/modules/interests/service";
import { draftOf, formatRate, tierChips } from "@/modules/interests/ui/present";
import { PostingCell } from "@/modules/interests/ui/posting-cell";
import { RuleButton, RuleStateButton } from "@/modules/interests/ui/rule-dialog";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

const STATUS_TONE = {
  no_data: "bg-hover text-muted",
  indeterminate: "bg-warn-bg text-warn",
  matched: "bg-pos-bg text-pos",
  missing: "bg-neg-bg text-neg",
  delayed: "bg-warn-bg text-warn",
  anomalous: "bg-neg-bg text-neg",
} as const;

async function load(id: string) {
  const ctx = await requireSession();
  try {
    return { ctx, detail: await ruleDetail(ctx, id) };
  } catch (error) {
    if (error instanceof InterestError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/interests/[id]">): Promise<Metadata> {
  const { detail } = await load((await params).id);
  return { title: `${(await getTranslations("interests"))("title")} · ${detail.accountName}` };
}

/** One rule (plan F4 §3.6.12): its payouts reconciled with what was paid (spec §7.6), and its days. */
export default async function RulePage({ params }: PageProps<"/interests/[id]">) {
  const { ctx, detail } = await load((await params).id);
  const t = await getTranslations("interests");
  const [open, categories] = await Promise.all([listAccounts(ctx), categoryOptions(ctx, "income")]);
  const accounts = open.map((account) => ({ id: account.id, name: account.name }));
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const { rule } = detail;
  const labels = {
    upTo: (amount: string) => t("tier.upTo", { amount }),
    to: (amount: string) => t("tier.to", { amount }),
    above: t("tier.above"),
    any: t("tier.any"),
  };
  const year = today(ctx.timeZone).slice(0, 4);
  const accruedYtd = detail.settlements
    .filter((row) => row.entry.periodFrom.startsWith(year))
    .reduce((sum, row) => sum + row.entry.netCents, detail.pendingCents);

  return (
    <Page
      title={detail.accountName}
      parent={{ href: "/interests", label: t("detail.back") }}
      actions={
        <>
          <RuleStateButton
            id={rule.id}
            state={rule.state === "active" ? "paused" : "active"}
            label={rule.state === "active" ? t("detail.pause") : t("detail.resume")}
            toast={rule.state === "active" ? t("toasts.paused") : t("toasts.resumed")}
          />
          <RuleButton
            draft={draftOf(detail, ctx.numberFormat)}
            accounts={accounts}
            categories={categories}
            label={t("detail.edit")}
          />
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {t("detail.summary", {
            account: detail.accountName,
            settlement: t(`settlement.${rule.settlement}`),
            basis: t(`basis.${rule.dayBasis}`),
          })}{" "}
          · {t("from", { date: formatDate(rule.validFrom, "long", ctx.locale) })}
          {rule.validTo && ` · ${t("to", { date: formatDate(rule.validTo, "long", ctx.locale) })}`}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{detail.accountName}</h1>
        <div className="flex flex-wrap gap-1.5">
          {tierChips(detail.tiers, ctx.numberFormat, labels).map((chip, index) => (
            <span key={index} className="rounded-[5px] border border-border px-1.5 py-0.5 text-xs">
              <span className="font-semibold">{chip.rate}</span>{" "}
              <span className="text-muted">{chip.range}</span>
            </span>
          ))}
          <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-xs text-muted">
            {t("columns.tax")} {formatRate(rule.taxRate, ctx.numberFormat)}
          </span>
        </div>
      </div>

      {/*
        The accrual job refuses to accrue on a reading it does not trust (spec §7.6): said here,
        where the days stop, rather than left as an unexplained gap in the ledger below.
      */}
      {detail.balance.stale && rule.state === "active" && (
        <p role="status" className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">
          {detail.balance.lastSyncedAt === null
            ? t("detail.balance.never")
            : t("detail.balance.stale", {
                when: formatDate(civilDateIn(detail.balance.lastSyncedAt, ctx.timeZone), "long", ctx.locale),
              })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile label={t("detail.accruedYtd")} value={money(accruedYtd)} valueTone="pos" />
        <KpiTile label={t("detail.pending")} value={money(detail.pendingCents)} />
        <KpiTile
          label={t("detail.mode")}
          value={t(`detail.modes.${rule.mode}`)}
          note={
            rule.mode === "post_to_provider" ? (detail.categoryName ?? t("detail.noCategory")) : undefined
          }
        />
        <KpiTile label={t("columns.status")} value={t(`state.${rule.state}`)} />
      </div>

      <Card padded={false}>
        <CardHeader title={t("detail.settlements.title")} />
        {detail.settlements.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("detail.settlements.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{t("detail.settlements.period")}</Th>
                <Th>{t("detail.settlements.days")}</Th>
                <Th align="right">{t("detail.settlements.gross")}</Th>
                <Th align="right">{t("detail.settlements.tax")}</Th>
                <Th align="right">{t("detail.settlements.net")}</Th>
                <Th align="right">{t("detail.settlements.paid")}</Th>
                <Th>{t("detail.settlements.status")}</Th>
                {rule.mode === "post_to_provider" && <Th>{t("detail.settlements.posting")}</Th>}
              </THead>
              <TBody>
                {detail.settlements.slice(0, 90).map((row) => (
                  <Tr key={row.entry.id} data-testid="settlement-row">
                    <Td>
                      {formatDate(row.entry.periodFrom, "dayMonth", ctx.locale)} –{" "}
                      {formatDate(row.entry.periodTo, "long", ctx.locale)}
                    </Td>
                    <Td muted className="text-sm">
                      {t("detail.settlements.daysValue", {
                        accrued: row.accruedDays,
                        skipped: row.skippedDays,
                      })}
                    </Td>
                    <Td align="right">{money(row.entry.grossCents)}</Td>
                    <Td align="right" muted>
                      {money(row.entry.taxCents)}
                    </Td>
                    <Td align="right" className="font-semibold">
                      {money(row.entry.netCents)}
                    </Td>
                    <Td align="right">{row.paidCents === null ? NULL_DISPLAY : money(row.paidCents)}</Td>
                    <Td>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_TONE[row.status],
                        )}
                      >
                        {t(`detail.reconciliation.${row.status}`)}
                      </span>
                    </Td>
                    {rule.mode === "post_to_provider" && (
                      <Td>
                        <PostingCell
                          ruleId={rule.id}
                          entryId={row.entry.id}
                          posting={row.entry.posting}
                          error={row.entry.postingError}
                        />
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader
          title={t("detail.days.title")}
          actions={
            <span className="text-sm text-muted">
              {t("detail.days.subtitle", { count: detail.days.length })}
            </span>
          }
        />
        {detail.days.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("detail.days.empty")}</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <Table>
              <THead>
                <Th>{t("detail.days.date")}</Th>
                <Th align="right">{t("detail.days.balance")}</Th>
                <Th align="right">{t("detail.days.net")}</Th>
                <Th>
                  <span className="sr-only">{t("columns.status")}</span>
                </Th>
              </THead>
              <TBody>
                {detail.days.map((day) => (
                  <Tr key={day.id} data-testid="accrual-row">
                    <Td muted>{formatDate(day.on, "long", ctx.locale)}</Td>
                    <Td align="right">{money(day.balanceCents)}</Td>
                    <Td align="right">{money(day.netCents)}</Td>
                    <Td className={cn("text-sm", day.status === "accrued" ? "text-muted" : "text-warn")}>
                      {day.status === "accrued" ? null : t(`detail.days.statuses.${day.status}`)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </Page>
  );
}

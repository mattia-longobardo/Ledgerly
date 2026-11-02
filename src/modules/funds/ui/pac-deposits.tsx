import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Route } from "next";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import type { FundPeriod } from "../period";
import type { FundDetail } from "../queries";
import type { FundDeposit } from "../service";
import { inPeriod } from "../tabs";
import { DetectRuleButton } from "./detect-rule";
import { AddDepositCard, DeleteDeposit, EditDepositButton } from "./fund-forms";
import { depositDraft, newDepositDraft } from "./present";

/**
 * The Deposits tab of a PAC (docs/design/funds-ux.md §6, F4): the money of the period, and the rule. The rule
 * is about the fund and not about a period, so it does not follow the period.
 */
export async function PacDeposits({
  ctx,
  detail,
  archived,
  period,
  when,
  todayOn,
  movements,
  settingsHref,
}: {
  ctx: Ctx;
  detail: FundDetail;
  archived: boolean;
  period: FundPeriod;
  when: string;
  todayOn: CivilDate;
  movements: readonly { id: string; label: string }[];
  settingsHref: string;
}) {
  const t = await getTranslations("funds.fund.deposits");
  const tf = await getTranslations("funds");
  const { fund, rule, accounts } = detail;
  const rows = detail.deposits.filter((deposit) => inPeriod(deposit.on, period));
  const money = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat);
  const long = (on: string) => formatDate(on, "long", ctx.locale);
  const total = (pick: (deposit: FundDeposit) => Cents | null) =>
    rows.reduce<Cents>((sum, deposit) => sum + (pick(deposit) ?? 0n), 0n);
  const source = (deposit: FundDeposit) => (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        deposit.source === "rule" ? "bg-pos-bg text-pos" : "bg-hover text-muted",
      )}
    >
      {deposit.source === "rule" ? t("sourceRule") : t("sourceHand")}
    </span>
  );
  const actions = (deposit: FundDeposit) =>
    archived ? null : (
      <span className="flex justify-end gap-1">
        <EditDepositButton
          fundId={fund.id}
          draft={depositDraft(deposit, ctx.numberFormat)}
          format={ctx.numberFormat}
          label={t("edit")}
        />
        {deposit.source === "manual" && (
          <DeleteDeposit
            fundId={fund.id}
            depositId={deposit.id}
            label={t("delete")}
            toast={tf("toasts.depositDeleted")}
          />
        )}
      </span>
    );

  return (
    <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <Card padded={false} className="min-w-0" data-testid="fund-deposits">
        <CardHeader
          title={t("title")}
          actions={<span className="text-sm text-muted">{t("count", { count: rows.length })}</span>}
        />
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted" data-testid="deposits-empty">
            {t("empty", { when })}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto @5xl:block">
              <Table>
                <THead>
                  <Th>{t("date")}</Th>
                  <Th align="right">{t("charged")}</Th>
                  <Th align="right">{t("fee")}</Th>
                  <Th align="right">{t("invested")}</Th>
                  <Th>{t("source")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("edit")}</span>
                  </Th>
                </THead>
                <TBody>
                  {rows.map((deposit) => (
                    <Tr key={deposit.id} data-testid="deposit-line" data-on={deposit.on}>
                      <Td muted>{long(deposit.on)}</Td>
                      <Td align="right">{money(deposit.chargedCents)}</Td>
                      <Td align="right" className="text-neg">
                        {deposit.feeCents === null ? NULL_DISPLAY : money(-deposit.feeCents)}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {money(deposit.investedCents)}
                      </Td>
                      <Td>{source(deposit)}</Td>
                      <Td align="right">{actions(deposit)}</Td>
                    </Tr>
                  ))}
                  <TotalRow label={t("total")}>
                    <Td align="right" data-testid="deposits-total">
                      {money(total((deposit) => deposit.chargedCents))}
                    </Td>
                    <Td align="right" className="text-neg">
                      {money(-total((deposit) => deposit.feeCents))}
                    </Td>
                    <Td align="right">{money(total((deposit) => deposit.investedCents))}</Td>
                    <Td />
                    <Td />
                  </TotalRow>
                </TBody>
              </Table>
            </div>

            <ul className="flex flex-col @5xl:hidden">
              {rows.map((deposit) => (
                <li
                  key={deposit.id}
                  data-testid="deposit-item"
                  data-on={deposit.on}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span className="font-medium">{long(deposit.on)}</span>
                      {source(deposit)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(deposit.chargedCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span className="text-neg">
                      {t("fee")} {deposit.feeCents === null ? NULL_DISPLAY : money(-deposit.feeCents)}
                    </span>
                    <span>
                      {t("invested")} {money(deposit.investedCents)}
                    </span>
                  </div>
                  {actions(deposit)}
                </li>
              ))}
              <li className="flex flex-col gap-1 px-4 py-3 font-medium">
                <span className="flex items-center justify-between gap-2">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">{money(total((deposit) => deposit.chargedCents))}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 text-sm font-normal text-muted tabular-nums">
                  <span>
                    {t("fee")} {money(-total((deposit) => deposit.feeCents))}
                  </span>
                  <span>
                    {t("invested")} {money(total((deposit) => deposit.investedCents))}
                  </span>
                </span>
              </li>
            </ul>
          </>
        )}
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {!archived && (
          <AddDepositCard
            fundId={fund.id}
            draft={newDepositDraft(fund, todayOn, ctx.numberFormat)}
            format={ctx.numberFormat}
          />
        )}
        <Card className="flex min-w-0 flex-col gap-2" data-testid="fund-deposit-rule">
          <h2 className="text-lg font-semibold">{t("rule.title")}</h2>
          {rule === null ? (
            <p className="text-sm text-muted">{t("rule.none")}</p>
          ) : (
            <>
              <p className="text-sm">
                {t("rule.text", {
                  account: accounts.find((one) => one.id === rule.accountId)?.name ?? t("rule.anyAccount"),
                  match: rule.payeeMatch,
                  fee: fund.depositFeeCents === null ? t("rule.noFee") : money(fund.depositFeeCents),
                })}
              </p>
              <p className={cn("text-sm", rule.active ? "text-pos" : "text-muted")}>
                {rule.active ? t("rule.active") : t("rule.paused")}
              </p>
            </>
          )}
          <span className="flex flex-wrap items-center gap-3">
            <Link
              href={settingsHref as Route}
              className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
            >
              {t("rule.edit")}
            </Link>
            {!archived && (
              <DetectRuleButton
                fundId={fund.id}
                movements={[...movements]}
                accountId={fund.debitAccountId ?? ""}
                format={ctx.numberFormat}
                locale={ctx.locale}
                label={tf("detect.button")}
              />
            )}
          </span>
        </Card>
      </div>
    </div>
  );
}

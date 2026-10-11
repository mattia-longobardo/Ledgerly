import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { expenseLinkCandidates, pocketsView, type PocketView } from "@/modules/pockets/queries";
import {
  type DialogContext,
  PocketActions,
  type PocketSummary,
  RemovePlannedButton,
  UnlinkExpenseButton,
} from "@/modules/pockets/ui/pocket-actions";
import { percentOf } from "@/modules/budgets/rules";
import { requireSession } from "@/platform/auth/session";
import { addMonths, monthKey, today } from "@/platform/dates";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  formatWholePercent,
  NULL_DISPLAY,
} from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { MiniBars } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata({ params }: PageProps<"/pockets/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { id } = await params;
  const view = await pocketsView(ctx);
  const pocket = view.pockets.find((item) => item.pocket.id === id);
  return { title: pocket?.pocket.name ?? (await getTranslations("pockets"))("title") };
}

/**
 * One pocket (spec §7.4): what is left of its budget, what was spent from it — every expense of its
 * account, or the expenses linked to it — and the expenses still to come.
 */
export default async function PocketPage({ params }: PageProps<"/pockets/[id]">) {
  const ctx = await requireSession();
  const t = await getTranslations("pockets");
  const { id } = await params;
  const view = await pocketsView(ctx);
  const selected: PocketView | undefined = view.pockets.find((item) => item.pocket.id === id);
  if (!selected) notFound();
  const pocket = selected.pocket;
  const standalone = pocket.backingAccountId === null;
  const todayOn = today(ctx.timeZone);
  const thisMonth = monthKey(todayOn);
  const money = (cents: bigint | null, decimals = true) => formatMoney(cents, ctx.numberFormat, { decimals });

  const summary: PocketSummary = {
    id: pocket.id,
    name: pocket.name,
    state: pocket.state,
    backingAccountId: pocket.backingAccountId,
    accountName: selected.accountName,
    balanceCents: selected.balanceCents,
    freeCents: pocket.backingAccountId ? (view.freeByAccount[pocket.backingAccountId] ?? null) : null,
    targetInput: formatAmountInput(pocket.targetCents, ctx.numberFormat),
    monthlyInput: formatAmountInput(pocket.monthlyCents, ctx.numberFormat),
    startMonth: pocket.startMonth,
  };
  const context: DialogContext = {
    accounts: view.accounts,
    numberFormat: ctx.numberFormat,
    locale: ctx.locale,
    today: todayOn,
    thisMonth,
    candidates: standalone ? await expenseLinkCandidates(ctx) : undefined,
  };

  const target = pocket.targetCents;
  const funded = target === null ? 0 : percentOf(selected.balanceCents, target);
  const monthLabel = (month: string) => formatDate(month, "monthShort", ctx.locale);
  const expenseLabel = (expense: PocketView["expenses"][number]) =>
    `${formatDate(expense.on, "long", ctx.locale)} · ${expense.payee ?? t("expenses.noPayee")}`;

  return (
    <Page
      title={pocket.name}
      parent={{ href: "/pockets", label: t("title") }}
      actions={<PocketActions place="topbar" pocket={summary} context={context} />}
    >
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{pocket.name}</h1>

      <Card className="flex flex-col gap-4" data-testid="pocket-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm text-muted">
              {pocket.name} ·{" "}
              {selected.accountName
                ? t("detail.onAccount", { account: selected.accountName })
                : t("detail.standalone")}{" "}
              · {t("detail.since", { month: formatDate(pocket.startMonth, "monthYear", ctx.locale) })}
            </p>
            <p
              className={cn(
                "text-hero font-semibold tracking-[-0.02em] tabular-nums",
                selected.balanceCents < 0n && "text-neg",
              )}
            >
              {money(selected.balanceCents)}
            </p>
            <p className="text-sm text-muted">{t("detail.left")}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-sm text-muted">
              {target === null ? t("detail.noTargetLabel") : t("detail.target")}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {target === null ? NULL_DISPLAY : money(target, false)}
            </span>
          </div>
        </div>

        {pocket.state === "paused" && <p className="text-sm text-warn">{t("detail.paused")}</p>}

        {target === null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-dashed border-border2 p-3 text-sm text-muted">
            <span>{t("detail.openEnded")}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              value={funded / 100}
              label={t("detail.funded", { percent: formatWholePercent(funded, ctx.numberFormat) })}
            />
            <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
              <span>{t("detail.funded", { percent: formatWholePercent(funded, ctx.numberFormat) })}</span>
              <span className="text-muted">
                {selected.eta === 0
                  ? t("detail.reached")
                  : `${t("detail.toGo", { amount: money(target - selected.balanceCents) })} · ${
                      selected.eta === null
                        ? t("detail.noEta")
                        : t("detail.eta", {
                            months: selected.eta,
                            month: formatDate(addMonths(thisMonth, selected.eta), "monthYear", ctx.locale),
                          })
                    }`}
              </span>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 @3xl:grid-cols-5">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.budget")}</dt>
            <dd className="font-semibold tabular-nums">{money(selected.budgetCents)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.spent")}</dt>
            <dd className={cn("font-semibold tabular-nums", selected.spentCents < 0n && "text-neg")}>
              {selected.spentCents === 0n ? NULL_DISPLAY : money(selected.spentCents)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.monthly")}</dt>
            <dd className="font-semibold tabular-nums">
              {pocket.monthlyCents === null ? t("detail.manual") : money(pocket.monthlyCents)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.afterPlanned")}</dt>
            <dd className={cn("font-semibold tabular-nums", selected.projectedCents < 0n && "text-neg")}>
              {selected.planned.length === 0 ? NULL_DISPLAY : money(selected.projectedCents)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.interest")}</dt>
            <dd className="font-semibold tabular-nums">{money(selected.interestCents)}</dd>
            <dd className="text-xs text-faint">
              {selected.interestReason === "standalone"
                ? t("detail.interestStandalone")
                : selected.interestReason === "estimate"
                  ? t("detail.interestEstimate")
                  : t("detail.interestUnknown")}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-muted">{standalone ? t("detail.howStandalone") : t("detail.howBacked")}</p>

        <PocketActions place="detail" pocket={summary} context={context} />
      </Card>

      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <Card padded={false} className="min-w-0">
          <CardHeader
            title={t("chart.title")}
            actions={
              <span className="text-sm text-muted">
                {target === null ? t("chart.noTarget") : t("chart.topIsTarget")}
              </span>
            }
          />
          <div className="px-4 pb-4">
            <MiniBars
              values={selected.history.map((value) => (value === null ? null : Number(value)))}
              labels={view.months.map(
                (month, index) => `${monthLabel(month)} · ${money(selected.history[index])}`,
              )}
              xLabels={view.months.map((month) => formatDate(month, "month", ctx.locale))}
              target={target === null ? null : Number(target)}
              summary={t("chart.summary", { name: pocket.name, value: money(selected.balanceCents) })}
            />
          </div>
        </Card>

        <Card padded={false} className="min-w-0" data-testid="pocket-planned">
          <CardHeader
            title={t("planned.title")}
            actions={
              <span className="text-sm text-muted tabular-nums">
                {selected.planned.length === 0 ? null : money(-selected.plannedCents)}
              </span>
            }
          />
          {selected.planned.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("planned.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border px-4 pb-2">
              {selected.planned.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{row.description}</span>
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      {formatDate(row.dueOn, "long", ctx.locale)}
                      {row.overdue && <Badge tone="warn">{t("planned.overdue")}</Badge>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-neg tabular-nums">{money(-row.cents)}</span>
                    <RemovePlannedButton id={row.id} description={row.description} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padded={false} className="min-w-0" data-testid="pocket-expenses">
        <CardHeader
          title={t("expenses.title")}
          actions={
            <span className="text-sm text-muted">
              {t("expenses.count", { count: selected.expenses.length })}
            </span>
          }
        />
        {selected.expenses.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">
            {standalone ? t("expenses.emptyStandalone") : t("expenses.emptyBacked")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("expenses.date")}</Th>
                  <Th>{t("expenses.payee")}</Th>
                  <Th>{t("expenses.account")}</Th>
                  <Th align="right">{t("expenses.amount")}</Th>
                  {standalone && <Th align="right">{t("expenses.actions")}</Th>}
                </THead>
                <TBody>
                  {selected.expenses.map((expense) => (
                    <Tr key={expense.id}>
                      <Td muted>{formatDate(expense.on, "long", ctx.locale)}</Td>
                      <Td className="max-w-0 truncate font-medium">
                        {expense.payee ?? t("expenses.noPayee")}
                        {expense.note && (
                          <span className="ml-2 text-sm font-normal text-muted">{expense.note}</span>
                        )}
                      </Td>
                      <Td muted>
                        {expense.manual ? t("expenses.manual") : (expense.accountName ?? NULL_DISPLAY)}
                      </Td>
                      <Td align="right" className="text-neg">
                        {money(-expense.cents)}
                      </Td>
                      {standalone && (
                        <Td align="right">
                          {expense.linked && (
                            <UnlinkExpenseButton
                              pocketId={pocket.id}
                              transactionId={expense.id}
                              label={expenseLabel(expense)}
                            />
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-border px-4 pb-2 md:hidden">
              {selected.expenses.map((expense) => (
                <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{expense.payee ?? t("expenses.noPayee")}</span>
                    <span className="truncate text-sm text-muted">
                      {formatDate(expense.on, "long", ctx.locale)} ·{" "}
                      {expense.manual ? t("expenses.manual") : (expense.accountName ?? NULL_DISPLAY)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-neg tabular-nums">{money(-expense.cents)}</span>
                    {standalone && expense.linked && (
                      <UnlinkExpenseButton
                        pocketId={pocket.id}
                        transactionId={expense.id}
                        label={expenseLabel(expense)}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Page>
  );
}

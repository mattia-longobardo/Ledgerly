import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@/modules/accounts/queries";
import { categoryOptions } from "@/modules/transactions/taxonomy";
import { interestsView } from "@/modules/interests/queries";
import { draftOf, formatRate, newDraft, tierChips } from "@/modules/interests/ui/present";
import { RuleButton } from "@/modules/interests/ui/rule-dialog";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("interests"))("title") };
}

/** Interests (spec §7.6, design): one row per rule; the rule's page has its payouts and days. */
export default async function InterestsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("interests");
  const todayOn = today(ctx.timeZone);
  const [rows, accounts, categories] = await Promise.all([
    interestsView(ctx),
    listAccounts(ctx),
    // An interest payout is income: those are the categories a published settlement is filed under.
    categoryOptions(ctx, "income"),
  ]);
  const open = accounts.map((account) => ({ id: account.id, name: account.name }));
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  const add = (label: string) => (
    <RuleButton draft={newDraft(open, todayOn)} accounts={open} categories={categories} label={label} />
  );
  const labels = {
    upTo: (amount: string) => t("tier.upTo", { amount }),
    to: (amount: string) => t("tier.to", { amount }),
    above: t("tier.above"),
    any: t("tier.any"),
  };
  const gross = rows.reduce((sum, row) => sum + row.grossYtdCents, 0n);
  const net = rows.reduce((sum, row) => sum + row.accruedYtdCents, 0n);

  return (
    <Page title={t("title")} actions={add(t("add"))}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        {rows.length > 0 && (
          <p className="text-muted tabular-nums">
            {t("subtitle", { gross: money(gross), net: money(net), year: todayOn.slice(0, 4) })}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={add(t("empty.cta"))}
        />
      ) : (
        <>
          <Card padded={false}>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("columns.account")}</Th>
                  <Th>{t("columns.tiers")}</Th>
                  <Th align="right">{t("columns.tax")}</Th>
                  <Th>{t("columns.basis")}</Th>
                  <Th align="right">{t("columns.accrued")}</Th>
                  <Th>{t("columns.next")}</Th>
                  <Th>{t("columns.status")}</Th>
                  <Th>
                    <span className="sr-only">{t("columns.edit")}</span>
                  </Th>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <Tr key={row.rule.id} className="h-11" data-testid="rule-row">
                      <Td>
                        <Link
                          href={`/interests/${row.rule.id}` as Route}
                          className="focus-ring flex flex-col rounded-[2px] hover:underline"
                        >
                          <span className="font-medium">{row.accountName}</span>
                          <span className="text-xs text-muted">
                            {t("from", { date: formatDate(row.rule.validFrom, "long", ctx.locale) })}
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1.5">
                          {tierChips(row.tiers, ctx.numberFormat, labels).map((chip, index) => (
                            <span
                              key={index}
                              className="rounded-[5px] border border-border px-1.5 py-0.5 text-xs"
                            >
                              <span className="font-semibold">{chip.rate}</span>{" "}
                              <span className="text-muted">{chip.range}</span>
                            </span>
                          ))}
                        </span>
                      </Td>
                      <Td align="right" muted>
                        {formatRate(row.rule.taxRate, ctx.numberFormat)}
                      </Td>
                      <Td muted className="text-sm">
                        {t(`basis.${row.rule.dayBasis}`)} · {t(`settlement.${row.rule.settlement}`)}
                      </Td>
                      <Td
                        align="right"
                        className={cn("font-medium", row.accruedYtdCents > 0n ? "text-pos" : "text-muted")}
                      >
                        {row.accruedYtdCents > 0n ? money(row.accruedYtdCents) : NULL_DISPLAY}
                      </Td>
                      <Td muted>
                        {row.nextPayout ? formatDate(row.nextPayout, "long", ctx.locale) : NULL_DISPLAY}
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            row.rule.state === "active" ? "bg-pos-bg text-pos" : "bg-hover text-muted",
                          )}
                        >
                          {t(`state.${row.rule.state}`)}
                        </span>
                      </Td>
                      <Td>
                        <RuleButton
                          draft={draftOf(row, ctx.numberFormat)}
                          accounts={open}
                          categories={categories}
                          label={t("columns.edit")}
                          variant="ghost"
                          size="xs"
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col md:hidden">
              {rows.map((row) => (
                <li
                  key={row.rule.id}
                  data-testid="rule-item"
                  className="border-b border-border last:border-0"
                >
                  <Link href={`/interests/${row.rule.id}` as Route} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{row.accountName}</span>
                      <span className="font-medium text-pos tabular-nums">
                        {row.accruedYtdCents > 0n ? money(row.accruedYtdCents) : NULL_DISPLAY}
                      </span>
                    </span>
                    <span className="text-sm text-muted">
                      {tierChips(row.tiers, ctx.numberFormat, labels)
                        .map((chip) => `${chip.rate} ${chip.range}`)
                        .join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-sm text-faint">{t("footer")}</p>
        </>
      )}
    </Page>
  );
}

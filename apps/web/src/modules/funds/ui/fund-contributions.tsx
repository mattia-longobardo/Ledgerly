"use client";

import { useTranslations } from "next-intl";
import { funds } from "@ledgerly/api-contract/funds";
import { formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { DataTable } from "@ledgerly/ui/data-table";
import { Loaded } from "@ledgerly/ui/loaded";
import type { SectionApiQuery } from "@ledgerly/ui/period";
import { Td, TotalRow } from "@ledgerly/ui/table";
import { ContributionButton, type ContributionSetup } from "./contribution-dialog";
import { DebitCards, PeriodsCard } from "./contribution-sections";
import { columnsOf, RegisterItem, useRegisterColumns } from "./register-cells";
import { type Contributions, contributionSetupOf, useMovements, usePeriodLabel } from "./contribution-setup";
import { PayslipsCard } from "./payslips-card";
import { type Say, useSay } from "@/platform/say";
import { cents } from "./wire-forms";

type Operation = Contributions["operations"][number];

interface TabProps {
  fundId: string;
  /** The period of the address, as the API takes it. */
  period: SectionApiQuery;
  when: string;
  /** The Settings tab: the link of a recurring debit goes to its section there. */
  settingsHref: string;
}

/**
 * The Contributions tab of a fund (docs/design/rewrite-plan/ux/n6-pension-fund.md §5.3), read from
 * `GET /funds/{id}/contributions` (rewrite plan R3): the register of the period, then the payslips,
 * the periods and the recurring debits the fund's sources call for. Every total, status and default
 * is the server's. Every table has a list on a narrow page, with the same figures and the same
 * controls. The switch is `DataTable`'s, at `md` as in the rest of the app (UI-FND-5);
 * where the columns do not fit, the table scrolls in its own frame.
 */
export function FundContributions(props: TabProps) {
  const read = useLatest(
    useApi(funds.getFundContributions, { params: { id: props.fundId }, query: props.period }),
  );
  const say = useSay();
  return (
    <Loaded state={read}>
      {(contributions) => (
        <Loaded state={say}>
          {(words) => <ContributionsBody {...props} contributions={contributions} say={words} />}
        </Loaded>
      )}
    </Loaded>
  );
}

function ContributionsBody({
  when,
  settingsHref,
  contributions,
  say,
}: TabProps & { contributions: Contributions; say: Say }) {
  const { fund, payroll } = contributions;
  const label = usePeriodLabel(payroll?.accrualPeriod, say);
  const debit = contributions.debits.find((one) => one.state === "active") ?? null;
  const movements = useMovements(fund.id, debit?.accountId ?? null, say);
  const setup = contributionSetupOf(contributions, say, movements, label);
  const archived = fund.state === "archived";
  const money = (amount: string | null) =>
    amount === null ? NULL_DISPLAY : formatMoney(cents(amount), say.format);
  const signed = (amount: string | null) =>
    amount === null ? NULL_DISPLAY : formatMoney(cents(amount), say.format, { signed: true });
  return (
    <>
      <RegisterCard contributions={contributions} setup={setup} say={say} when={when} label={label} />
      {payroll !== null && (
        <PayslipsCard contributions={contributions} when={when} say={say} label={label} money={money} />
      )}
      {payroll !== null && payroll.hasCalendar && (
        <PeriodsCard
          contributions={contributions}
          payroll={payroll}
          archived={archived}
          when={when}
          say={say}
          label={label}
          money={money}
          signed={signed}
        />
      )}
      <DebitCards debits={contributions.debits} settingsHref={settingsHref} money={money} />
    </>
  );
}

/** The register of the period (§5.3), with its total row. */
function RegisterCard({
  contributions,
  setup,
  say,
  when,
  label,
}: {
  contributions: Contributions;
  setup: ContributionSetup | null;
  say: Say;
  when: string;
  label: (year: number, index: number) => string;
}) {
  const text = useTranslations("funds.fund.contributions");
  const register = useTranslations("funds.fund.contributions.register");
  const contribution = useTranslations("funds.contribution");
  const rows = contributions.operations;
  const { totals } = contributions;
  const money = (amount: string | null) =>
    amount === null ? NULL_DISPLAY : formatMoney(cents(amount), say.format);
  const negative = (amount: string) => formatMoney(-(cents(amount) ?? 0n), say.format);
  const long = (date: string) => formatDate(date, "long", say.locale);
  const columns = columnsOf(rows);
  const voluntaryHeader = columns.parts ? register("voluntary") : register("charged");
  const record = (variant: "primary" | "secondary") =>
    setup === null ? null : (
      <ContributionButton setup={setup} label={contribution("record")} variant={variant} />
    );
  const everEmpty = contributions.operationsEver === 0;
  const other = (one: Operation) =>
    one.classification === "withdrawal" ? negative(one.other) : money(one.other);
  const cells = { say, label, setup, money, negative, other, long, voluntaryHeader };
  const registerColumns = useRegisterColumns(columns, cells);

  return (
    <Card padded={false} className="min-w-0" data-testid="fund-contributions">
      <CardHeader
        title={register("title")}
        actions={
          <>
            <span className="text-sm text-muted @max-2xl:hidden">
              {register("count", { count: rows.length })}
            </span>
            {record("secondary")}
          </>
        }
      />
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 pb-4 text-sm" data-testid="contributions-empty">
          <p className="text-muted">{everEmpty ? register("emptyEver") : register("empty", { when })}</p>
          {everEmpty && contributions.fedBySources && <p className="text-muted">{register("fromSources")}</p>}
          {everEmpty && record("primary")}
        </div>
      ) : (
        <>
          <DataTable
            columns={registerColumns}
            rows={rows}
            rowKey={(one) => one.id}
            rowProps={(one) => ({ "data-testid": "contribution-row", "data-on": one.on })}
            cardProps={(one) => ({ "data-testid": "contribution-item", "data-on": one.on })}
            card={(one) => <RegisterItem one={one} cells={cells} />}
            footer={
              <TotalRow label={text("total")}>
                <Td />
                {columns.period && <Td />}
                {columns.parts && (
                  <>
                    <Td align="right">{money(totals.worker)}</Td>
                    <Td align="right">{money(totals.employer)}</Td>
                    <Td align="right">{money(totals.tfr)}</Td>
                  </>
                )}
                {columns.voluntary && (
                  <Td align="right" data-testid="contributions-voluntary-total">
                    {money(totals.voluntary)}
                  </Td>
                )}
                {columns.other && <Td align="right">{money(totals.other)}</Td>}
                <Td align="right" className="text-neg">
                  {negative(totals.fees)}
                </Td>
                <Td align="right" data-testid="contributions-total">
                  {money(totals.net)}
                </Td>
                <Td />
              </TotalRow>
            }
            cardFooter={
              <li className="flex flex-col gap-1 px-4 py-3 font-medium">
                <span className="flex items-center justify-between gap-2">
                  <span>{text("total")}</span>
                  <span className="tabular-nums">{money(totals.net)}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 text-sm font-normal text-muted tabular-nums">
                  {columns.voluntary && (
                    <span>
                      {voluntaryHeader} {money(totals.voluntary)}
                    </span>
                  )}
                  <span>
                    {register("fees")} {negative(totals.fees)}
                  </span>
                </span>
              </li>
            }
          />
          {columns.feeUnknown && (
            <p className="border-t border-border px-4 py-3 text-sm text-muted" data-testid="fee-unknown">
              {register("feeUnknown")}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

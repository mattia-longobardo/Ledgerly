"use client";

import { useTranslations } from "next-intl";
import { funds } from "@ledgerly/api-contract/funds";
import { formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import type { SectionApiQuery } from "@ledgerly/ui/period";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import {
  ContributionButton,
  type ContributionSetup,
  DeleteContributionButton,
  EditContributionButton,
} from "./contribution-dialog";
import { DebitCards, PayslipsCard, PeriodsCard } from "./contribution-sections";
import { type Contributions, contributionSetupOf, useMovements, usePeriodLabel } from "./contribution-setup";
import { type Say, useSay } from "./say";
import { cents, contributionFormOfRow } from "./wire-forms";

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
 * controls. The switch is at the width of the page and not at `md`: with the sidebar, these columns
 * do not fit a tablet.
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
          <div className="hidden overflow-x-auto @5xl:block">
            <Table>
              <THead>
                <Th>{register("date")}</Th>
                <Th>{register("origin")}</Th>
                {columns.period && <Th>{register("period")}</Th>}
                {columns.parts && (
                  <>
                    <Th align="right">{text("components.worker")}</Th>
                    <Th align="right">{text("components.employer")}</Th>
                    <Th align="right">{text("components.tfr")}</Th>
                  </>
                )}
                {columns.voluntary && <Th align="right">{voluntaryHeader}</Th>}
                {columns.other && <Th align="right">{text("other")}</Th>}
                <Th align="right">{register("fees")}</Th>
                <Th align="right">{register("invested")}</Th>
                <Th align="right">
                  <span className="sr-only">{register("actions")}</span>
                </Th>
              </THead>
              <TBody>
                {rows.map((one) => (
                  <RegisterRow key={one.id} one={one} columns={columns} cells={cells} />
                ))}
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
              </TBody>
            </Table>
          </div>

          <ul className="flex flex-col @5xl:hidden">
            {rows.map((one) => (
              <RegisterItem key={one.id} one={one} cells={cells} />
            ))}
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
          </ul>
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

const isVoluntary = (one: Operation) => one.classification === "voluntary";
const isZero = (amount: string) => cents(amount) === 0n;

/** The columns the rows have something to put in: which parts, a period, an unknown fee. */
function columnsOf(rows: readonly Operation[]) {
  return {
    period: rows.some((one) => one.competence !== null),
    parts: rows.some(
      (one) => !isVoluntary(one) && !(isZero(one.worker) && isZero(one.employer) && isZero(one.tfr)),
    ),
    voluntary: rows.some(isVoluntary),
    other: rows.some((one) => !isZero(one.other)),
    feeUnknown: rows.some((one) => one.fee === null),
  };
}

interface Cells {
  say: Say;
  label: (year: number, index: number) => string;
  setup: ContributionSetup | null;
  money: (amount: string | null) => string;
  negative: (amount: string) => string;
  /** A withdrawal's other money left the fund: it reads as a minus. */
  other: (one: Operation) => string;
  long: (on: string) => string;
  voluntaryHeader: string;
}

const periodOf = (one: Operation, cells: Cells) =>
  one.competence === null ? null : cells.label(one.competence.year, one.competence.index);
/** A component of the payslip; a voluntary payment has its own column. */
const partOf = (one: Operation, amount: string) => (isVoluntary(one) ? null : amount);

function Badges({ one }: { one: Operation }) {
  const register = useTranslations("funds.fund.contributions.register");
  const pension = useTranslations("funds.pension");
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone="neutral">{register(`origins.${one.origin}`)}</Badge>
      {one.classification !== "contribution" && !isVoluntary(one) && (
        <Badge tone="accent">{pension(`classes.${one.classification}`)}</Badge>
      )}
    </span>
  );
}

function Fee({ one, cells }: { one: Operation; cells: Cells }) {
  const register = useTranslations("funds.fund.contributions.register");
  return one.fee === null ? (
    <span title={register("feeUnknownCell")}>
      <span aria-hidden>{NULL_DISPLAY}</span>
      <span className="sr-only">{register("feeUnknownCell")}</span>
    </span>
  ) : (
    cells.negative(one.fee)
  );
}

const feeTone = (one: Operation) => cn(one.fee !== null && !isZero(one.fee) && "text-neg");

/**
 * One written by hand is edited and deleted. One the app found among the movements is only edited —
 * its fee is how an unknown fee becomes known —: it goes when its movement is hidden in Expenses. One
 * read from a document stays as it was read.
 */
function Actions({ one, cells }: { one: Operation; cells: Cells }) {
  const register = useTranslations("funds.fund.contributions.register");
  const { setup } = cells;
  if (setup === null || one.source === "import") return null;
  return (
    <span className="flex justify-end gap-1">
      <EditContributionButton
        setup={setup}
        form={contributionFormOfRow(one, cells.say.format)}
        locked={one.source === "rule"}
        label={register("edit")}
        ariaLabel={register("editLabel", { date: cells.long(one.on) })}
      />
      {one.source === "manual" && (
        <DeleteContributionButton
          fundId={setup.fundId}
          operationId={one.id}
          date={cells.long(one.on)}
          label={register("delete")}
          ariaLabel={register("deleteLabel", { date: cells.long(one.on) })}
        />
      )}
    </span>
  );
}

function RegisterRow({
  one,
  columns,
  cells,
}: {
  one: Operation;
  columns: ReturnType<typeof columnsOf>;
  cells: Cells;
}) {
  const { money } = cells;
  return (
    <Tr data-testid="contribution-row" data-on={one.on}>
      <Td muted className="whitespace-nowrap">
        {cells.long(one.on)}
      </Td>
      <Td>
        <Badges one={one} />
      </Td>
      {columns.period && <Td>{periodOf(one, cells) ?? NULL_DISPLAY}</Td>}
      {columns.parts && (
        <>
          <Td align="right">{money(partOf(one, one.worker))}</Td>
          <Td align="right">{money(partOf(one, one.employer))}</Td>
          <Td align="right">{money(partOf(one, one.tfr))}</Td>
        </>
      )}
      {columns.voluntary && <Td align="right">{money(isVoluntary(one) ? one.worker : null)}</Td>}
      {columns.other && <Td align="right">{cells.other(one)}</Td>}
      <Td align="right" className={feeTone(one)}>
        <Fee one={one} cells={cells} />
      </Td>
      <Td align="right" className="font-semibold">
        {money(one.net)}
      </Td>
      <Td align="right">
        <Actions one={one} cells={cells} />
      </Td>
    </Tr>
  );
}

function RegisterItem({ one, cells }: { one: Operation; cells: Cells }) {
  const text = useTranslations("funds.fund.contributions");
  const register = useTranslations("funds.fund.contributions.register");
  const { money } = cells;
  const period = periodOf(one, cells);
  return (
    <li
      data-testid="contribution-item"
      data-on={one.on}
      className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{cells.long(one.on)}</span>
        <span className="shrink-0 font-semibold tabular-nums">{money(one.net)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Badges one={one} />
        {period !== null && <span className="text-muted">{period}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
        {isVoluntary(one) ? (
          <span>
            {cells.voluntaryHeader} {money(one.worker)}
          </span>
        ) : (
          (["worker", "employer", "tfr"] as const).map(
            (part) =>
              !isZero(one[part]) && (
                <span key={part}>
                  {text(`components.${part}`)} {money(one[part])}
                </span>
              ),
          )
        )}
        {!isZero(one.other) && (
          <span>
            {text("other")} {cells.other(one)}
          </span>
        )}
        <span className={feeTone(one)}>
          {register("fees")} <Fee one={one} cells={cells} />
        </span>
      </div>
      <Actions one={one} cells={cells} />
    </li>
  );
}

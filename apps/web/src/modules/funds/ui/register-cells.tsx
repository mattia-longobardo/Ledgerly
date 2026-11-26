"use client";

// The cells of a fund's register (§5.3): its columns in the table and its card on a phone.
import { useTranslations } from "next-intl";
import { NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import type { DataColumn } from "@ledgerly/ui/data-table";
import { withParams } from "@ledgerly/ui/url";
import {
  type ContributionSetup,
  DeleteContributionButton,
  EditContributionButton,
} from "./contribution-dialog";
import type { Contributions } from "./contribution-setup";
import type { Say } from "@/platform/say";
import { cents, contributionFormOfRow } from "./wire-forms";

type Operation = Contributions["operations"][number];

const isVoluntary = (one: Operation) => one.classification === "voluntary";
const isZero = (amount: string) => cents(amount) === 0n;

/** The columns the rows have something to put in: which parts, a period, an unknown fee. */
export function columnsOf(rows: readonly Operation[]) {
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
  /** The fund's account: where a voluntary contribution's leg is (PERS-651). */
  accountId: string;
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
  const leg = one.legTransactionId !== null && (
    // shortcut: Expenses opens on the leg's day and account, not on the leg itself; upgrade when it takes a movement id.
    <ButtonLink
      size="sm"
      variant="ghost"
      href={withParams("/expenses", {}, { from: one.on, to: one.on, acc: cells.accountId })}
      aria-label={register("legLabel", { date: cells.long(one.on) })}
      data-testid="register-leg"
    >
      {register("leg")}
    </ButtonLink>
  );
  if (setup === null || one.source === "import")
    return leg ? <span className="flex justify-end gap-1">{leg}</span> : null;
  return (
    <span className="flex justify-end gap-1">
      {leg}
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

const amount = (key: string, header: string, cell: (one: Operation) => string): DataColumn<Operation> => ({
  key,
  header,
  align: "right",
  cell,
});

const periodColumn = (header: string, cells: Cells): DataColumn<Operation> => ({
  key: "period",
  header,
  cell: (one) => periodOf(one, cells) ?? NULL_DISPLAY,
});

/** The register's columns: those the rows have something to put in. */
export function useRegisterColumns(
  columns: ReturnType<typeof columnsOf>,
  cells: Cells,
): DataColumn<Operation>[] {
  const text = useTranslations("funds.fund.contributions");
  const register = useTranslations("funds.fund.contributions.register");
  const { money } = cells;
  return [
    {
      key: "date",
      header: register("date"),
      muted: true,
      className: "whitespace-nowrap",
      cell: (one) => cells.long(one.on),
    },
    { key: "origin", header: register("origin"), cell: (one) => <Badges one={one} /> },
    ...(columns.period ? [periodColumn(register("period"), cells)] : []),
    ...(columns.parts
      ? (["worker", "employer", "tfr"] as const).map((part) =>
          amount(part, text(`components.${part}`), (one) => money(partOf(one, one[part]))),
        )
      : []),
    ...(columns.voluntary
      ? [amount("voluntary", cells.voluntaryHeader, (one) => money(isVoluntary(one) ? one.worker : null))]
      : []),
    ...(columns.other ? [amount("other", text("other"), cells.other)] : []),
    {
      key: "fees",
      header: register("fees"),
      align: "right",
      className: feeTone,
      cell: (one) => <Fee one={one} cells={cells} />,
    },
    {
      key: "invested",
      header: register("invested"),
      align: "right",
      className: "font-semibold",
      cell: (one) => money(one.net),
    },
    {
      key: "actions",
      header: register("actions"),
      hiddenHeader: true,
      align: "right",
      cell: (one) => <Actions one={one} cells={cells} />,
    },
  ];
}

export function RegisterItem({ one, cells }: { one: Operation; cells: Cells }) {
  const text = useTranslations("funds.fund.contributions");
  const register = useTranslations("funds.fund.contributions.register");
  const { money } = cells;
  const period = periodOf(one, cells);
  return (
    <>
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
    </>
  );
}

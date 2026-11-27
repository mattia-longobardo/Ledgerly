"use client";

// The executions of one plan, newest first (PERS-681 §7): waiting for prices, proposed, recorded,
// discarded or expired, with the shares of each line, the budget and the carry to the next, why it
// waits, and the bank movement found for it (E7). Read from `…/plans/{planId}/runs`; every figure is
// the server's, none is summed here.
import { useTranslations } from "next-intl";
import { quantityText } from "@ledgerly/domain/investments/client";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Loaded } from "@ledgerly/ui/loaded";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { plans } from "@ledgerly/api-contract/investments";
import type { ServicePage } from "../service/service-view";
import { RunActions } from "./run-actions";
import { amountText, type Plan, type PlansText, type Run, RUN_TONES } from "./plan-words";

/** The state, and what the person has to know about it: why it waits, or why it bought nothing. */
function RunState({ run, text }: { run: Run; text: PlansText }) {
  const note = run.reason
    ? text(`reasons.${run.reason}`)
    : run.state === "waiting_price"
      ? text("waitingPrices")
      : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge status={run.state} tones={RUN_TONES}>
        {text(`runStates.${run.state}`)}
      </StatusBadge>
      {note && (
        <span data-testid="run-reason" className="text-xs text-muted">
          {note}
        </span>
      )}
    </span>
  );
}

/**
 * What the execution buys: the shares of each line («A: 2 shares · 82,60 €») or why it buys none, its
 * budget and, once closed, what passes to the next one (M1, D2); a recorded one links to Activity.
 */
function Purchase({ run, text, page }: { run: Run; text: PlansText; page: ServicePage }) {
  const money = (amount: string) => amountText(amount, run.currency, page.say.format);
  const budget = run.budget === null ? null : money(run.budget);
  return (
    <span className="flex flex-col items-start gap-1">
      {run.lines.length === 0 ? (
        NULL_DISPLAY
      ) : (
        <ul className="flex flex-col gap-0.5">
          {run.lines.map((line) => (
            <li key={line.assetId}>
              {line.state === "buy"
                ? text("line", {
                    name: line.name,
                    quantity: quantityText(line.quantity, null, page.say.format),
                    spent: money(line.spent),
                  })
                : text("lineNone", { name: line.name, why: text(`lineStates.${line.state}`) })}
            </li>
          ))}
        </ul>
      )}
      {budget !== null && (
        <span data-testid="run-budget" className="text-xs text-muted">
          {run.carryOut === null
            ? text("budget", { budget })
            : text("budgetCarry", { budget, carry: money(run.carryOut) })}
        </span>
      )}
      {run.state === "recorded" && (
        <Link
          href={page.href("activity")}
          className="focus-ring rounded-sm text-xs underline hover:no-underline"
        >
          {text("toActivity")}
        </Link>
      )}
    </span>
  );
}

function debitText(run: Run, text: PlansText, page: ServicePage): string {
  if (run.debit === null) return NULL_DISPLAY;
  const words = {
    date: formatDate(run.debit.on, "long", page.say.locale),
    amount: amountText(run.debit.amount, run.debit.currency, page.say.format),
    payee: run.debit.payee ?? NULL_DISPLAY,
  };
  return text(run.debit.linked ? "debitLinked" : "debitFound", words);
}

function useColumns(page: ServicePage, plan: Plan): DataColumn<Run>[] {
  const text = useTranslations("investments.plans");
  return [
    {
      key: "due",
      header: text("columns.due"),
      card: "title",
      rowHeader: true,
      cell: (run) => formatDate(run.dueOn, "long", page.say.locale),
    },
    {
      key: "state",
      header: text("columns.state"),
      cell: (run) => <RunState run={run} text={text} />,
    },
    {
      key: "proposal",
      header: text("columns.purchase"),
      card: "labelled",
      cell: (run) => <Purchase run={run} text={text} page={page} />,
    },
    {
      key: "debit",
      header: text("columns.debit"),
      card: "labelled",
      muted: true,
      cell: (run) => debitText(run, text, page),
    },
    {
      key: "actions",
      header: text("columns.actions"),
      hiddenHeader: true,
      align: "right",
      card: "action",
      cell: (run) => <RunActions page={page} plan={plan} run={run} />,
    },
  ];
}

function RunsTable({ page, plan, runs }: { page: ServicePage; plan: Plan; runs: readonly Run[] }) {
  const text = useTranslations("investments.plans");
  const columns = useColumns(page, plan);
  if (runs.length === 0) return <p className="px-4 pb-4 text-sm text-muted">{text("noRuns")}</p>;
  return (
    <DataTable
      columns={columns}
      rows={runs}
      rowKey={(run) => run.id}
      cardProps={(run) => ({ "data-testid": "plan-run", "data-state": run.state })}
      rowProps={(run) => ({ "data-testid": "plan-run", "data-state": run.state })}
      testIds={{ table: "plan-runs-table", list: "plan-runs-list" }}
    />
  );
}

export function PlanRuns({ page, plan }: { page: ServicePage; plan: Plan }) {
  const text = useTranslations("investments.plans");
  const read = useApi(plans.listPlanRuns, { params: { accountId: page.id, planId: plan.id } });
  return (
    <Card>
      <CardHeader title={text("runsTitle", { name: plan.name })} />
      <Loaded state={read}>{(answer) => <RunsTable page={page} plan={plan} runs={answer.runs} />}</Loaded>
    </Card>
  );
}

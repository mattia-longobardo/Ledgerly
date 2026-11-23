"use client";

// The instalments of one plan, newest first (R5d, step 2; §11.3.2): due, waiting for a price, proposed,
// recorded or skipped, with the purchase the server proposes at its price, why the job left it to the
// person (P2), and the bank movement it found for it (E7). Read from `…/plans/{planId}/runs`.
import { useTranslations } from "next-intl";
import { priceText, quantityText } from "@ledgerly/domain/investments/client";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Loaded } from "@ledgerly/ui/loaded";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { plans } from "@ledgerly/api-contract/investments";
import type { ServicePage } from "../service/service-view";
import { RunActions } from "./run-actions";
import { amountText, type Plan, type PlansText, type Run, RUN_TONES } from "./plan-words";

/** The state, and what the person has to know about it: why it waits, or that the job wrote it. */
function RunState({ run, text, page }: { run: Run; text: PlansText; page: ServicePage }) {
  const note = run.reason
    ? text(`reasons.${run.reason}`)
    : run.state === "waiting_price" && run.waitingSince
      ? text("waitingSince", { date: formatDate(run.waitingSince, "long", page.say.locale) })
      : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-1">
        <StatusBadge status={run.state} tones={RUN_TONES}>
          {text(`runStates.${run.state}`)}
        </StatusBadge>
        {run.automatic && <Badge tone="neutral">{text("automatic")}</Badge>}
      </span>
      {note && (
        <span data-testid="run-reason" className="text-xs text-muted">
          {note}
        </span>
      )}
    </span>
  );
}

/** The purchase proposed: a quantity at a price, what it spends and its fee; or the close found. */
function proposalText(run: Run, text: PlansText, page: ServicePage): string {
  const { format } = page.say;
  if (run.proposal)
    return text("proposal", {
      quantity: quantityText(run.proposal.quantity, null, format),
      price: priceText(run.proposal.unitPrice, run.currency, format),
      amount: amountText(run.proposal.amount, run.currency, format),
      fee: amountText(run.proposal.fee, run.currency, format),
    });
  return run.price === null
    ? NULL_DISPLAY
    : text("priceOnly", { price: priceText(run.price, run.currency, format) });
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
      cell: (run) => <RunState run={run} text={text} page={page} />,
    },
    {
      key: "proposal",
      header: text("columns.purchase"),
      card: "labelled",
      cell: (run) => proposalText(run, text, page),
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

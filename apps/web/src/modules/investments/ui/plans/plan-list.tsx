"use client";

// The plans of a portfolio (R5d; baskets, PERS-681 §7): a table from `md`, a card each below it. A
// plan's name opens its executions below the list; its instruments with their percentage, its amount,
// its carry, its state and its next execution are the server's (`GET /investments/{accountId}/plans`).
// A converted plan has no amount yet: «Amount to type», and «Set amount» opens its form.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import type { ServicePage } from "../service/service-view";
import { PlanMenu } from "./plan-menu";
import {
  amountText,
  instrumentsText,
  type Plan,
  PLAN_TONES,
  type PlansText,
  scheduleText,
} from "./plan-words";

const PlanDialog = lazy(() => import("./plan-dialog").then((one) => ({ default: one.PlanDialog })));

/** The amount of each execution, or «Amount to type» and «Set amount» on a converted plan (M4). */
function PlanAmount({ page, plan }: { page: ServicePage; plan: Plan }) {
  const text = useTranslations("investments.plans");
  const [open, setOpen] = useState(false);
  if (plan.amount !== null) return amountText(plan.amount, plan.currency, page.say.format);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="warn">{text("amountMissing")}</Badge>
      <Button size="xs" onClick={() => setOpen(true)} aria-label={text("setAmountOf", { name: plan.name })}>
        {text("setAmount")}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <PlanDialog context={page.context} plan={plan} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </span>
  );
}

/** The executions waiting for the person: to confirm, or with no price yet. */
function Waiting({ plan, text }: { plan: Plan; text: PlansText }) {
  if (plan.toConfirm + plan.waitingPrice === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {plan.toConfirm > 0 && <Badge tone="accent">{text("toConfirm", { count: plan.toConfirm })}</Badge>}
      {plan.waitingPrice > 0 && (
        <Badge tone="warn">{text("waitingPrice", { count: plan.waitingPrice })}</Badge>
      )}
    </span>
  );
}

/** A plan's name and its instruments: the link that opens its instalments below the list. */
function PlanLink({ page, plan, chosen }: { page: ServicePage; plan: Plan; chosen: boolean }) {
  const { format } = page.say;
  return (
    <Link
      href={page.href("plans", { plan: plan.id })}
      aria-current={chosen ? "true" : undefined}
      className="focus-ring inline-flex min-h-6 flex-col rounded-sm hover:underline aria-[current]:font-semibold"
    >
      <span>{plan.name}</span>
      <span className="text-xs font-normal text-muted">{instrumentsText(plan, format)}</span>
    </Link>
  );
}

function useColumns(page: ServicePage, chosen: string | null): DataColumn<Plan>[] {
  const text = useTranslations("investments.plans");
  const { format, locale } = page.say;
  // A column a card shows with its label.
  const labelled = (key: "amount" | "schedule" | "next" | "carry", cell: DataColumn<Plan>["cell"]) => ({
    key,
    header: text(`columns.${key}`),
    card: "labelled" as const,
    cell,
  });
  return [
    {
      key: "name",
      header: text("columns.plan"),
      card: "title",
      rowHeader: true,
      cell: (plan) => <PlanLink page={page} plan={plan} chosen={plan.id === chosen} />,
    },
    labelled("amount", (plan) => <PlanAmount page={page} plan={plan} />),
    labelled("schedule", (plan) => scheduleText(plan, text)),
    labelled("next", (plan) =>
      plan.nextDueOn === null ? NULL_DISPLAY : formatDate(plan.nextDueOn, "long", locale),
    ),
    { ...labelled("carry", (plan) => amountText(plan.carry, plan.currency, format)), align: "right" },
    {
      key: "state",
      header: text("columns.state"),
      card: "line",
      cell: (plan) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={plan.state} tones={PLAN_TONES}>
            {text(`states.${plan.state}`)}
          </StatusBadge>
          <Waiting plan={plan} text={text} />
        </span>
      ),
    },
    {
      key: "actions",
      header: text("columns.actions"),
      hiddenHeader: true,
      align: "right",
      card: "action",
      cell: (plan) => <PlanMenu page={page} plan={plan} />,
    },
  ];
}

export function PlanList({
  page,
  list,
  chosen,
}: {
  page: ServicePage;
  list: readonly Plan[];
  chosen: string | null;
}) {
  return (
    <DataTable
      columns={useColumns(page, chosen)}
      rows={list}
      rowKey={(plan) => plan.id}
      testIds={{ table: "plans-table", list: "plans-list" }}
    />
  );
}

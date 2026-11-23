"use client";

// The plans of a portfolio (R5d, step 2): a table from `md`, a card each below it. A plan's name opens
// its instalments below the list; its state, its next instalment and the instalments waiting are the
// server's (`GET /investments/{accountId}/plans`).
import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import type { ServicePage } from "../service/service-view";
import { PlanMenu } from "./plan-menu";
import { type Plan, PLAN_TONES, type PlansText, scheduleText, sizeText } from "./plan-words";

/** The instalments waiting for the person: to confirm, or with no price yet. */
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

/** A plan's name and asset: the link that opens its instalments below the list. */
function PlanLink({ page, plan, chosen }: { page: ServicePage; plan: Plan; chosen: boolean }) {
  return (
    <Link
      href={page.href("plans", { plan: plan.id })}
      aria-current={chosen ? "true" : undefined}
      className="focus-ring inline-flex min-h-6 flex-col rounded-sm hover:underline aria-[current]:font-semibold"
    >
      <span>{plan.name}</span>
      <span className="text-xs font-normal text-muted">{plan.asset.name}</span>
    </Link>
  );
}

function useColumns(page: ServicePage, chosen: string | null): DataColumn<Plan>[] {
  const text = useTranslations("investments.plans");
  const { format, locale } = page.say;
  return [
    {
      key: "name",
      header: text("columns.plan"),
      card: "title",
      rowHeader: true,
      cell: (plan) => <PlanLink page={page} plan={plan} chosen={plan.id === chosen} />,
    },
    {
      key: "size",
      header: text("columns.instalment"),
      cell: (plan) => `${sizeText(plan, text, format)} · ${scheduleText(plan, text)}`,
    },
    {
      key: "mode",
      header: text("columns.mode"),
      card: "labelled",
      muted: true,
      cell: (plan) => text(`modes.${plan.mode}`),
    },
    {
      key: "next",
      header: text("columns.next"),
      card: "labelled",
      cell: (plan) => (plan.nextDueOn === null ? NULL_DISPLAY : formatDate(plan.nextDueOn, "long", locale)),
    },
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

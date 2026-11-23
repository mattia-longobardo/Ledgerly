"use client";

// The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3): each
// plan with its schedule, its state and its next instalment, and the instalments of the plan chosen —
// by default the first with one waiting, where «Da fare» sends the person. Read from
// `GET /investments/{accountId}/plans` and `…/plans/{planId}/runs`; every figure is the server's.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useRef, useState } from "react";
import { plans } from "@ledgerly/api-contract/investments";
import { Button } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { EmptyState } from "@ledgerly/ui/states";
import type { ServicePage } from "../service/service-view";
import { ToOverview } from "../service/to-overview";
import { PlanList } from "./plan-list";
import { PlanRuns } from "./plan-runs";
import type { Plan } from "./plan-words";

// The form loads when it opens: the registry's search and the accounts come with it.
const PlanDialog = lazy(() => import("./plan-dialog").then((one) => ({ default: one.PlanDialog })));

/** The plan of the address, or the first with an instalment waiting, or the first. */
function chosenPlan(list: readonly Plan[], wanted: string | null): Plan | null {
  return (
    list.find((plan) => plan.id === wanted) ??
    list.find((plan) => plan.toConfirm + plan.waitingPrice > 0) ??
    list[0] ??
    null
  );
}

/** «New plan», and its form while open. */
function NewPlan({ page, primary }: { page: ServicePage; primary?: boolean }) {
  const text = useTranslations("investments.plans");
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={opener}
        size="sm"
        variant={primary ? "primary" : "secondary"}
        onClick={() => setOpen(true)}
      >
        {text("new")}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <PlanDialog context={page.context} plan={null} onClose={() => setOpen(false)} opener={opener} />
        </Suspense>
      )}
    </>
  );
}

function PlansView({ page, list }: { page: ServicePage; list: readonly Plan[] }) {
  const text = useTranslations("investments.plans");
  if (list.length === 0)
    return (
      <EmptyState
        title={text("emptyTitle")}
        description={text("emptyDescription")}
        actions={<NewPlan page={page} primary />}
      />
    );
  const chosen = chosenPlan(list, page.search.get("plan"));
  return (
    <>
      <Card>
        <CardHeader title={text("title")} actions={<NewPlan page={page} />} />
        <PlanList page={page} list={list} chosen={chosen?.id ?? null} />
      </Card>
      {chosen && <PlanRuns key={chosen.id} page={page} plan={chosen} />}
    </>
  );
}

function PlansRead({ page }: { page: ServicePage }) {
  const read = useApi(plans.listPlans, { params: { accountId: page.id } });
  return <Loaded state={read}>{(answer) => <PlansView page={page} list={answer.plans} />}</Loaded>;
}

/** Only a manual portfolio has plans (§11.3.3): any other service goes back to its Overview. */
export function PlansTab({ page }: { page: ServicePage }) {
  if (!page.context.portfolio) return <ToOverview page={page} />;
  return <PlansRead page={page} />;
}

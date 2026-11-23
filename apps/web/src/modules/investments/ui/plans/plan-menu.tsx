"use client";

// The commands of a plan (R5d, step 2): change it, pause it or start it again, end it, and «Record the
// past instalments» of a plan that started before today (P4). An ended plan is read only.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { ActionMenu } from "@ledgerly/ui/menu";
import { setPlanState } from "../../plan-calls";
import { ConfirmAction, useOutcome } from "../dialog-kit";
import type { ServicePage } from "../service/service-view";
import type { Plan } from "./plan-words";

const PlanDialog = lazy(() => import("./plan-dialog").then((one) => ({ default: one.PlanDialog })));
const BackfillDialog = lazy(() =>
  import("./backfill-dialog").then((one) => ({ default: one.BackfillDialog })),
);

type MenuDialog = "edit" | "end" | "backfill";

function useItems(page: ServicePage, plan: Plan, open: (dialog: MenuDialog) => void) {
  const text = useTranslations("investments.plans");
  const outcome = useOutcome();
  const state = async (next: "active" | "paused") =>
    outcome(await setPlanState(page.id, plan.id, next), text(next === "paused" ? "paused" : "resumed"));
  if (plan.state === "ended") return [];
  return [
    { label: text("edit"), onSelect: () => open("edit") },
    plan.state === "active"
      ? { label: text("pause"), onSelect: () => void state("paused") }
      : { label: text("resume"), onSelect: () => void state("active") },
    ...(plan.startOn < page.say.todayOn
      ? [{ label: text("backfill.open"), onSelect: () => open("backfill") }]
      : []),
    { label: text("end"), onSelect: () => open("end"), danger: true },
  ];
}

function MenuDialogs({
  page,
  plan,
  open,
  close,
}: {
  page: ServicePage;
  plan: Plan;
  open: MenuDialog | null;
  close: () => void;
}) {
  const text = useTranslations("investments.plans");
  const outcome = useOutcome();
  if (open === "end")
    return (
      <ConfirmAction
        onClose={close}
        title={text("endTitle", { name: plan.name })}
        description={text("endDescription")}
        confirm={text("end")}
        onConfirm={async () => {
          const result = await setPlanState(page.id, plan.id, "ended");
          outcome(result, text("ended"));
          return result.ok;
        }}
      />
    );
  if (open === null) return null;
  return (
    <Suspense fallback={null}>
      {open === "edit" ? (
        <PlanDialog context={page.context} plan={plan} onClose={close} />
      ) : (
        <BackfillDialog page={page} plan={plan} onClose={close} />
      )}
    </Suspense>
  );
}

export function PlanMenu({ page, plan }: { page: ServicePage; plan: Plan }) {
  const text = useTranslations("investments.plans");
  const [open, setOpen] = useState<MenuDialog | null>(null);
  const items = useItems(page, plan, setOpen);
  if (items.length === 0) return null;
  return (
    <>
      <ActionMenu label={text("actions", { name: plan.name })} items={items} />
      <MenuDialogs page={page} plan={plan} open={open} close={() => setOpen(null)} />
    </>
  );
}

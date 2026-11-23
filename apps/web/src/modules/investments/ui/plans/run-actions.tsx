"use client";

// The commands of an instalment (R5d, step 2): «Confirm» and «Skip» while it waits, «Record a deposit»
// when the job found no cash for it (P2 A), and «Link the movement» the server found on the debit
// account of a recorded one (E7) — linked only on the person's word.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import type { ActionResult } from "../../calls";
import { linkRunDebit, skipRun } from "../../plan-calls";
import { ConfirmAction, useOutcome } from "../dialog-kit";
import type { ServicePage } from "../service/service-view";
import { amountText, isOpen, type Plan, type Run } from "./plan-words";

const ConfirmRunDialog = lazy(() =>
  import("./confirm-run").then((one) => ({ default: one.ConfirmRunDialog })),
);
const RecordOperationDialog = lazy(() =>
  import("../portfolio/record-operation").then((one) => ({ default: one.RecordOperationDialog })),
);

type RunDialog = { kind: "confirm" | "skip" | "link" } | { kind: "deposit"; day: string };

interface DialogProps {
  page: ServicePage;
  plan: Plan;
  run: Run;
  close: () => void;
}

/** «Skip» and «Link the movement»: a question, then the write. */
function RunQuestion({ page, plan, run, close, kind }: DialogProps & { kind: "skip" | "link" }) {
  const text = useTranslations("investments.plans");
  const outcome = useOutcome();
  const ref = { accountId: page.id, planId: plan.id, runId: run.id };
  const write = async (work: Promise<ActionResult>, done: string) => {
    const result = await work;
    outcome(result, done);
    return result.ok;
  };
  if (kind === "skip" || run.debit === null)
    return (
      <ConfirmAction
        onClose={close}
        title={text("skip.title", { date: formatDate(run.dueOn, "long", page.say.locale) })}
        description={text("skip.description")}
        confirm={text("skip.submit")}
        onConfirm={() => write(skipRun(ref), text("skipped"))}
      />
    );
  return (
    <ConfirmAction
      onClose={close}
      title={text("link.title")}
      description={text("link.description", {
        date: formatDate(run.debit.on, "long", page.say.locale),
        amount: amountText(run.debit.amount, run.debit.currency, page.say.format),
      })}
      confirm={text("link.submit")}
      onConfirm={() => write(linkRunDebit(ref), text("linked"))}
    />
  );
}

function RunDialogs({
  open,
  setOpen,
  ...props
}: Omit<DialogProps, "close"> & {
  open: RunDialog;
  setOpen: (open: RunDialog | null) => void;
}) {
  const close = () => setOpen(null);
  if (open.kind === "skip" || open.kind === "link")
    return <RunQuestion {...props} close={close} kind={open.kind} />;
  return (
    <Suspense fallback={null}>
      {open.kind === "deposit" ? (
        <RecordOperationDialog
          onClose={close}
          context={props.page.context}
          start={{ kind: "deposit", day: open.day }}
        />
      ) : (
        <ConfirmRunDialog {...props} onClose={close} onDeposit={(day) => setOpen({ kind: "deposit", day })} />
      )}
    </Suspense>
  );
}

export function RunActions({ page, plan, run }: { page: ServicePage; plan: Plan; run: Run }) {
  const text = useTranslations("investments.plans");
  const [open, setOpen] = useState<RunDialog | null>(null);
  const day = formatDate(run.dueOn, "long", page.say.locale);
  const linkable = run.state === "recorded" && run.debit !== null && !run.debit.linked;
  return (
    <span className="flex flex-wrap justify-end gap-2">
      {run.reason === "negative_cash" && (
        <Button size="xs" onClick={() => setOpen({ kind: "deposit", day: run.proposal?.on ?? run.dueOn })}>
          {text("recordDeposit")}
        </Button>
      )}
      {isOpen(run) && (
        <>
          <Button
            size="xs"
            variant="primary"
            aria-label={text("confirmOf", { date: day })}
            onClick={() => setOpen({ kind: "confirm" })}
          >
            {text("confirmRun")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-label={text("skipOf", { date: day })}
            onClick={() => setOpen({ kind: "skip" })}
          >
            {text("skipRun")}
          </Button>
        </>
      )}
      {linkable && (
        <Button
          size="xs"
          aria-label={text("linkOf", { date: day })}
          onClick={() => setOpen({ kind: "link" })}
        >
          {text("linkRun")}
        </Button>
      )}
      {open && <RunDialogs page={page} plan={plan} run={run} open={open} setOpen={setOpen} />}
    </span>
  );
}

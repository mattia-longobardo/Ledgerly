"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { clearDecisionAction, decideDifferenceAction } from "../calls";
import { ErrorLine, useResult } from "./fund-forms";

interface DifferenceTarget {
  year: number;
  quarter: number;
  component: string;
  componentLabel: string;
  differenceCents: string;
  accruedCents: string | null;
  creditedCents: string | null;
  competenceIds: string[];
  operationIds: string[];
  difference: string;
}

/**
 * "Accept this difference" (GC §11.9): a person's word, with the note that explains it. No amount
 * is ever invented to make the two sides meet.
 */
export function AcceptDifferenceButton({
  fundId,
  target,
  label,
}: {
  fundId: string;
  target: DifferenceTarget;
  label: string;
}) {
  const t = useTranslations("funds.pension.reconciliation");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { error, setError, ok } = useResult();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    startTransition(async () => {
      if (ok(await decideDifferenceAction(fundId, { ...target, note }))) {
        setOpen(false);
        notify(t("accepted"));
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("accept.title", { component: target.componentLabel })}
        description={t("accept.description", { difference: target.difference })}
        width={520}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label={t("accept.note")} htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} name="note" required maxLength={500} autoFocus />
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("accept.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("accept.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** "Reopen": the accepted difference goes back to being a difference. */
export function ClearDecisionButton({
  fundId,
  year,
  quarter,
  component,
  label,
}: {
  fundId: string;
  year: number;
  quarter: number;
  component: string;
  label: string;
}) {
  const t = useTranslations("funds");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await clearDecisionAction(fundId, year, quarter, component);
          if (result.ok) router.refresh();
          else notify(t("errors.failed"), "error");
        })
      }
    >
      {label}
    </Button>
  );
}

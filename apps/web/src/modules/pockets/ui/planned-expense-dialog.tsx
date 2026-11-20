"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useTransition } from "react";
import { MAX_DESCRIPTION } from "@ledgerly/api-contract/pockets";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, InputGroup } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { addPlannedExpense } from "../calls";
import { type DialogContext, type PocketDetail, usePocketError } from "./dialog-context";

function PlannedFields({ context }: { context: DialogContext }) {
  const text = useTranslations("pockets");
  const id = useId();
  return (
    <>
      <Field label={text("plan.what")} htmlFor={`${id}-description`}>
        <Input
          id={`${id}-description`}
          name="description"
          required
          maxLength={MAX_DESCRIPTION}
          autoFocus
          placeholder={text("plan.whatPlaceholder")}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={text("plan.amount")} htmlFor={`${id}-amount`}>
          <InputGroup suffix="€">
            <Input id={`${id}-amount`} name="amount" inputMode="decimal" numeric required />
          </InputGroup>
        </Field>
        <Field label={text("plan.due")} htmlFor={`${id}-due`}>
          <Input
            id={`${id}-due`}
            name="due"
            type="date"
            min={context.today}
            defaultValue={context.today}
            required
          />
        </Field>
      </div>
      <p className="text-sm text-muted">{text("plan.note")}</p>
    </>
  );
}

/** "Plan an expense": one expected on a day to come, which only lowers what the pocket would have left. */
export function PlannedExpenseDialog({
  onClose,
  pocket,
  context,
}: {
  onClose: () => void;
  pocket: PocketDetail;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const [pending, startTransition] = useTransition();
  const { error, report } = usePocketError();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      const result = await addPlannedExpense(pocket.id, {
        amount: value("amount"),
        dueOn: value("due"),
        description: value("description"),
      });
      if (!report(result)) return;
      notify(text("toasts.planned"));
      onClose();
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("plan.title")}
      description={text("plan.description", { name: pocket.name })}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("plan.submit")}
    >
      <PlannedFields context={context} />
    </FormDialog>
  );
}

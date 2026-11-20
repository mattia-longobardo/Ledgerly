"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useTransition } from "react";
import { pockets } from "@ledgerly/api-contract/pockets";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Select } from "@ledgerly/ui/input";
import { Loaded } from "@ledgerly/ui/loaded";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { linkExpense } from "../calls";
import { type DialogContext, type PocketDetail, usePocketError } from "./dialog-context";

type Candidate = RouteOutput<typeof pockets.listPocketCandidates>["candidates"][number];

function LinkForm({
  onClose,
  pocket,
  context,
  candidates,
}: {
  onClose: () => void;
  pocket: PocketDetail;
  context: DialogContext;
  candidates: readonly Candidate[];
}) {
  const text = useTranslations("pockets");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, report } = usePocketError();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const transaction = String(new FormData(event.currentTarget).get("expense") ?? "");
    startTransition(async () => {
      if (!report(await linkExpense(pocket.id, transaction))) return;
      notify(text("toasts.linked"));
      onClose();
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("link.title")}
      description={text("link.description", { name: pocket.name })}
      width={520}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("link.submit")}
    >
      <Field label={text("link.expense")} htmlFor={`${id}-expense`}>
        <Select id={`${id}-expense`} name="expense" required defaultValue={candidates[0].id}>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {[
                formatDate(candidate.on, "dayMonth", context.locale),
                candidate.payee ?? text("expenses.noPayee"),
                formatMoney(-parseCents(candidate.amount), context.numberFormat),
                candidate.account,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </Select>
      </Field>
    </FormDialog>
  );
}

/** "Link an expense": files one of the recent expenses (`GET /pockets/candidates`) under a standalone pocket. */
export function LinkExpenseDialog({
  onClose,
  pocket,
  context,
}: {
  onClose: () => void;
  pocket: PocketDetail;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const read = useApi(pockets.listPocketCandidates, {});
  return (
    <Loaded state={read}>
      {({ candidates }) =>
        candidates.length > 0 ? (
          <LinkForm onClose={onClose} pocket={pocket} context={context} candidates={candidates} />
        ) : (
          <Modal
            open
            onOpenChange={(open) => !open && onClose()}
            title={text("link.title")}
            description={text("link.description", { name: pocket.name })}
            width={520}
          >
            <p className="text-sm text-muted">{text("link.empty")}</p>
            <div className="flex justify-end">
              <Button onClick={onClose}>{text("form.cancel")}</Button>
            </div>
          </Modal>
        )
      }
    </Loaded>
  );
}

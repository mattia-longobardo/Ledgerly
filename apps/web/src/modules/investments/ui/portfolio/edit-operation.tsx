"use client";

// «Edit» of an operation of a manual portfolio (PERS-693): the operation read back from the server,
// then «Record operation» on it, which saves with the PATCH of the same route.
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ApiError } from "@ledgerly/api-client";
import { register } from "@ledgerly/api-contract/investments";
import { useApi } from "@ledgerly/ui/data";
import { notify } from "@ledgerly/ui/toast";
import { type ServiceContext, useErrorText } from "../dialog-kit";
import { editStartOf, type RowInstrument } from "./edit-start";
import { RecordOperationDialog } from "./record-operation";

export function EditOperationDialog({
  eventId,
  instrument,
  context,
  onClose,
}: {
  eventId: string;
  instrument: RowInstrument;
  context: ServiceContext;
  onClose: () => void;
}) {
  const text = useTranslations("investments.portfolioOps");
  const errorText = useErrorText();
  const read = useApi(register.getOperation, { params: { accountId: context.accountId, eventId } });
  const start = read.data && editStartOf(eventId, read.data.body, instrument, context.numberFormat);
  const failed = read.error != null;
  useEffect(() => {
    if (!failed && start !== null) return;
    // A refusal by its own words (`not_editable`, `not_found`); else the read failed.
    const error = read.error;
    notify(
      error instanceof ApiError && error.status < 500
        ? errorText(error.reason ?? error.code)
        : text("readFailed"),
      "error",
    );
    onClose();
  }, [failed, start, read.error, errorText, text, onClose]);
  if (!start) return null;
  return <RecordOperationDialog onClose={onClose} context={context} start={start} />;
}

"use client";

// An operation's commands (PERS-342): delete, only for one the person typed before; and «Edit» where
// the server rewrites it (`editable`, PERS-693), in the form that records it.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { ActionMenu } from "@ledgerly/ui/menu";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { deleteOperation } from "../calls";
import { ConfirmAction, type ServiceContext, useErrorText } from "./dialog-kit";
import { isFormKind, type RowInstrument } from "./portfolio/edit-start";

// The form and the registry's search load when «Edit» opens.
const EditOperationDialog = lazy(() =>
  import("./portfolio/edit-operation").then((one) => ({ default: one.EditOperationDialog })),
);

function LazyEdit(props: Parameters<typeof EditOperationDialog>[0]) {
  return (
    <Suspense fallback={null}>
      <EditOperationDialog {...props} />
    </Suspense>
  );
}

type OperationKind =
  | "opening_cash"
  | "opening_position"
  | "deposit"
  | "withdrawal"
  | "buy"
  | "sell"
  | "valuation"
  | "close"
  | "income"
  | "fee"
  | "account_valuation"
  | "adjustment";

interface OperationSummary {
  id: string;
  kind: OperationKind;
  on: string;
  origin: string;
  /** A decimal string of the wire. */
  amount: string;
  /** «Edit» rewrites it (the server's rule). */
  editable: boolean;
  instrument: RowInstrument;
}

export function OperationMenu({
  operation,
  context,
}: {
  operation: OperationSummary;
  context: ServiceContext;
}) {
  const text = useTranslations("investments");
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  if (operation.origin !== "manual") return null;
  const date = formatDate(operation.on, "long", context.locale);
  const kind = text(`kinds.${operation.kind}`);
  const close = () => setOpen(null);
  const edit = operation.editable && isFormKind(operation.kind);
  return (
    <>
      <ActionMenu
        label={text("actions.operationMenu", { date })}
        items={[
          ...(edit ? [{ label: text("actions.edit"), onSelect: () => setOpen("edit" as const) }] : []),
          { label: text("actions.delete"), onSelect: () => setOpen("delete"), danger: true },
        ]}
      />
      {open === "edit" && (
        <LazyEdit
          eventId={operation.id}
          instrument={operation.instrument}
          context={context}
          onClose={close}
        />
      )}
      {open === "delete" && (
        <ConfirmAction
          onClose={close}
          title={text("confirm.deleteTitle")}
          description={text("confirm.deleteDescription", {
            kind,
            date,
            amount: formatMoney(parseCents(operation.amount), context.numberFormat, {
              currency: context.currency,
            }),
          })}
          confirm={text("actions.delete")}
          onConfirm={async () => {
            const result = await deleteOperation(context.accountId, operation.id);
            if (!result.ok) {
              notify(errorText(result.error), "error");
              return false;
            }
            notify(text("toasts.deleted", { kind, date }));
            router.refresh();
            return true;
          }}
        />
      )}
    </>
  );
}

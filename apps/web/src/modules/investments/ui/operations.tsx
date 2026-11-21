"use client";

// An operation's command (PERS-342): delete, only for one the person typed before. Nothing is edited
// or added here any more: a manual service's money in and out are its account's movements.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { ActionMenu } from "@ledgerly/ui/menu";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { deleteOperation } from "../calls";
import { ConfirmAction, type ServiceContext, useErrorText } from "./dialog-kit";

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

export interface OperationSummary {
  id: string;
  kind: OperationKind;
  on: string;
  origin: string;
  /** A decimal string of the wire. */
  amount: string;
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
  const [open, setOpen] = useState(false);
  if (operation.origin !== "manual") return null;
  const date = formatDate(operation.on, "long", context.locale);
  const kind = text(`kinds.${operation.kind}`);
  return (
    <>
      <ActionMenu
        label={text("actions.operationMenu", { date })}
        items={[{ label: text("actions.delete"), onSelect: () => setOpen(true), danger: true }]}
      />
      {open && (
        <ConfirmAction
          onClose={() => setOpen(false)}
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

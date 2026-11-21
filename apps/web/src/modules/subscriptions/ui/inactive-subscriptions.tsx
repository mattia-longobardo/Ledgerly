"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { ConfirmDialog } from "@ledgerly/ui/form-dialog";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { notify } from "@ledgerly/ui/toast";
import { deleteSubscription } from "../calls";
import { type DialogOptions, SubscriptionDialog, type SubscriptionDraft } from "./subscription-dialog";
import type { SubscriptionView } from "./subscriptions-table";

/**
 * The plans that are not running, folded under the table — the paused and the cancelled in **two**
 * sections rather than one list (owner, 2026-09-21), because they are two different things: one is
 * a plan waiting to come back, the other a plan that is over. Each opens on a click and each is a
 * real table, so a name is not the only thing a person can see before deciding.
 *
 * `deletable` is set only for the cancelled: deleting is offered where it cannot be reached by
 * accident from a row that merely pauses (`deleteSubscription` refuses anything else anyway).
 */
export function InactiveSubscriptions({
  rows,
  options,
  title,
  deletable = false,
}: {
  rows: readonly SubscriptionView[];
  options: DialogOptions;
  title: string;
  deletable?: boolean;
}) {
  const text = useTranslations("subscriptions");
  const [editing, setEditing] = useState<SubscriptionDraft | null>(null);
  const [removing, setRemoving] = useState<SubscriptionView | null>(null);
  const { pending, remove } = useDelete();

  if (rows.length === 0) return null;
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-muted marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="transition-transform">
            ▸
          </span>
          {title}
        </span>
      </summary>
      <InactiveTable
        rows={rows}
        onEdit={(row) => setEditing(row.draft)}
        onDelete={deletable ? setRemoving : null}
        pending={pending}
      />
      {editing && <SubscriptionDialog draft={editing} options={options} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={text("inactive.deleteTitle")}
          description={text("inactive.deleteWarning", { name: removing.name })}
          detail={text("inactive.deleteDetail")}
          cancelLabel={text("inactive.cancelDelete")}
          confirmLabel={text("inactive.delete")}
          pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null);
            remove(removing);
          }}
        />
      )}
    </details>
  );
}

/** Deletes a cancelled subscription and says how it went. */
function useDelete() {
  const text = useTranslations("subscriptions");
  const [pending, startTransition] = useTransition();
  const remove = (row: SubscriptionView) =>
    startTransition(async () => {
      const result = await deleteSubscription(row.draft.id);
      if (result.ok) {
        notify(text("inactive.deletedToast", { name: row.name }));
        return;
      }
      // A service code, spelled out one branch at a time so the catalogue keys stay literal.
      notify(
        result.error === "not_cancelled"
          ? text("errors.not_cancelled")
          : result.error === "not_found"
            ? text("errors.not_found")
            : text("errors.failed"),
        "error",
      );
    });
  return { pending, remove };
}

/** The table of one section; `onDelete` is null where deleting is not offered. */
function InactiveTable({
  rows,
  onEdit,
  onDelete,
  pending,
}: {
  rows: readonly SubscriptionView[];
  onEdit: (row: SubscriptionView) => void;
  onDelete: ((row: SubscriptionView) => void) | null;
  pending: boolean;
}) {
  const text = useTranslations("subscriptions");
  return (
    <div className="overflow-x-auto border-t border-border">
      <Table>
        <THead>
          <Th>{text("columns.name")}</Th>
          <Th>{text("columns.billing")}</Th>
          <Th align="right">{text("columns.price")}</Th>
          <Th>{text("columns.paidFrom")}</Th>
          <Th align="right">
            <span className="sr-only">{text("columns.edit")}</span>
          </Th>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.draft.id} data-testid="inactive-row">
              <Td className="font-medium">
                <NameCell row={row} />
              </Td>
              <Td muted className="text-sm">
                {text(`cycles.${row.cycle}`)}
              </Td>
              <Td align="right">{row.price}</Td>
              <Td muted className="truncate text-sm">
                {row.accountName}
              </Td>
              <Td align="right">
                <span className="inline-flex flex-wrap justify-end gap-1 whitespace-normal">
                  <Button size="xs" variant="ghost" onClick={() => onEdit(row)}>
                    {text("columns.edit")}
                  </Button>
                  {onDelete && (
                    <Button size="xs" variant="danger" disabled={pending} onClick={() => onDelete(row)}>
                      {text("inactive.delete")}
                    </Button>
                  )}
                </span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** The name, after its category's colour. */
function NameCell({ row }: { row: SubscriptionView }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.categoryName && (
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: row.categoryColor ?? undefined }}
        />
      )}
      <span className="truncate">{row.name}</span>
    </span>
  );
}

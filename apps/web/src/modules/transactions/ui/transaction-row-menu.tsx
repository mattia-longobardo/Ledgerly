"use client";

import { useTranslations } from "next-intl";
import { Button } from "@ledgerly/ui/button";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Modal } from "@ledgerly/ui/modal";
import { useRouter } from "@ledgerly/ui/router";
import { useCategoryActions } from "./category-actions";
import { useManualMovement } from "./manual-movement";
import type { RowView } from "./view";

/** The rule editor, prefilled from a movement. */
const ruleFrom = (id: string) => `/settings/finance/rules?from=${id}`;

/**
 * The menu of one Expenses row. A manual movement is changed in its own dialog and deleted without
 * being hidden first; any other row opens the details panel, and is deleted only once hidden.
 */
export function TransactionRowMenu({
  row,
  onEditCategory,
  onOpenDetails,
  onTransfer,
  onVisibility,
  onDeleteHidden,
}: {
  row: RowView;
  onEditCategory: () => void;
  onOpenDetails: () => void;
  /** The choice of the other account: a giroconto's, or one that makes the movement a giroconto. */
  onTransfer: () => void;
  /** Hides the row, or restores it when it is hidden. */
  onVisibility: () => void;
  onDeleteHidden: () => void;
}) {
  const text = useTranslations("expenses");
  const router = useRouter();
  const manual = useManualMovement();
  const automatic = useCategoryActions();

  const head = [
    // A giroconto has no category: its other account takes the category's place (decision 10A).
    row.transfer
      ? { label: text("transfer.title"), onSelect: onTransfer }
      : { label: text("row.editCategory"), onSelect: onEditCategory },
    ...(automatic ? [{ label: text("row.createRule"), onSelect: () => router.push(ruleFrom(row.id)) }] : []),
  ];
  const visibility = {
    label: row.hidden ? text("selection.restore") : text("selection.hide"),
    onSelect: onVisibility,
  };

  if (row.manual && manual) {
    return (
      <ActionMenu
        label={text("row.menu")}
        items={[
          ...head,
          { label: text("manual.row.edit"), onSelect: () => manual.openEdit(row) },
          ...(row.send?.state === "not_sent" && manual.retrySend
            ? [{ label: text("manual.row.retrySend"), onSelect: () => manual.retrySend?.(row) }]
            : []),
          visibility,
          { label: text("selection.delete"), onSelect: () => manual.openDelete(row), danger: true },
        ]}
      />
    );
  }
  return (
    <ActionMenu
      label={text("row.menu")}
      items={[
        ...head,
        { label: text("row.edit"), onSelect: onOpenDetails },
        ...(row.transfer ? [] : [{ label: text("transfer.make"), onSelect: onTransfer }]),
        { ...visibility, danger: !row.hidden },
        ...(row.hidden ? [{ label: text("selection.delete"), onSelect: onDeleteHidden, danger: true }] : []),
      ]}
    />
  );
}

/** "Delete" on a hidden row asks first: the row is gone for good, and a synced one never comes back. */
export function DeleteHiddenModal({
  open,
  pending,
  onCancel,
  onDelete,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const text = useTranslations("expenses");
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      title={text("deleteHidden.title")}
      description={text("deleteHidden.description")}
      footer={
        <>
          <Button onClick={onCancel}>{text("deleteHidden.cancel")}</Button>
          <Button variant="danger" disabled={pending} onClick={onDelete}>
            {text("selection.delete")}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

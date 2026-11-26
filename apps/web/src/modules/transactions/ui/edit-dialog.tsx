"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useState } from "react";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { type EditKind, kindOf, sideOf } from "./edit-plan";
import { EditActions } from "./edit-actions";
import { BankFields, CategoryField, NoteAndLabels, SideField, SourceFields, TypeField } from "./edit-fields";
import { useEditSave } from "./edit-save";
import type { CategoryOption, LabelOption, RowView } from "./view";

const FORM_ID = "transaction-edit";

interface EditProps {
  row: RowView;
  labels: readonly LabelOption[];
  categories: readonly CategoryOption[];
  /** The person's accounts: the other side a giroconto can be given. */
  accounts: readonly { id: string; name: string }[];
  /** Where the focus goes on closing: the row the dialog was opened from. */
  finalFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** A category chosen for this one movement: the similar ones may follow (decision K3). */
  onCategoryChosen: (id: string, categoryId: string) => void;
  /** Hides the row, or restores it when it is hidden. */
  onVisibility: () => void;
  /** Asks before deleting a hidden row for good. */
  onDeleteHidden: () => void;
}

/** The type and what goes with it: the category of a spending or an income, a giroconto's other side. */
function useTypeChoice(row: RowView, categories: readonly CategoryOption[]) {
  const [kind, setKind] = useState<EditKind>(kindOf(row));
  const [categoryId, setCategoryId] = useState<string | null>(row.transfer ? null : row.categoryId);
  const [side, setSide] = useState(sideOf(row));
  /** A category of the other type does not follow the movement to the new one. */
  function changeKind(next: EditKind) {
    setKind(next);
    const type = categories.find((option) => option.id === categoryId)?.type;
    if (type !== undefined && type !== next) setCategoryId(null);
  }
  return { kind, changeKind, categoryId, setCategoryId, side, setSide };
}

function TypeChoiceFields({
  row,
  categories,
  accounts,
  choice,
  disabled,
}: Pick<EditProps, "row" | "categories" | "accounts"> & {
  choice: ReturnType<typeof useTypeChoice>;
  disabled: boolean;
}) {
  const { kind } = choice;
  return (
    <>
      <TypeField row={row} kind={kind} onChange={choice.changeKind} disabled={disabled} />
      {kind === "transfer" ? (
        <SideField
          accountId={row.accountId}
          accounts={accounts}
          value={choice.side}
          onChange={choice.setSide}
          disabled={disabled}
        />
      ) : (
        <CategoryField
          rowId={row.id}
          categories={categories.filter((option) => option.type === undefined || option.type === kind)}
          value={choice.categoryId}
          onChange={choice.setCategoryId}
          disabled={disabled}
        />
      )}
    </>
  );
}

function SaveError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  );
}

function EditFooter({ disabled, onClose }: { disabled: boolean; onClose: () => void }) {
  const text = useTranslations("expenses.row");
  return (
    <>
      <Button size="sm" onClick={onClose}>
        {text("cancel")}
      </Button>
      <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={disabled}>
        {text("save")}
      </Button>
    </>
  );
}

/**
 * One movement, opened from its row (owner, 2026-11-26: one «Edit» dialog, in
 * Ledgerly's style): its type on top — spending, income or giroconto —, then its category, or the
 * other account for a giroconto, the bank's fields, the note and the labels, and one Save. The type
 * changes in any direction in that one save; the sign of the amount decides which types it may take.
 *
 * Payee, amount and date are shown as context and nothing else: they belong to the provider, and
 * `updateTransaction` refuses a patch that carries them (`provider_owned`). A field the person did
 * not touch is not submitted at all, so an unchanged dialog claims nothing in `locally_edited` — the
 * movement keeps following its source until they really disagree with it. A movement edited at its
 * source (`row.atSource`, owner 2026-09-24) is the exception: type, amount, payee and note are saved
 * there first, and nothing changes here unless the source accepts them.
 */
export function TransactionEdit(props: EditProps) {
  const { row, labels, onClose } = props;
  const text = useTranslations("expenses");
  const choice = useTypeChoice(row, props.categories);
  const [chosen, setChosen] = useState<readonly string[]>(row.labelIds);
  const { error, pending, save } = useEditSave(row, onClose, props.onCategoryChosen);
  const unsaveable = pending || (choice.kind === "transfer" && choice.side === "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unsaveable) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const { kind, categoryId, side } = choice;
    save({
      kind,
      categoryId,
      side,
      labelIds: chosen,
      note: field("note"),
      amount: field("amount"),
      payee: field("payee"),
    });
  }

  const toggle = (label: string) =>
    setChosen((current) =>
      current.includes(label) ? current.filter((one) => one !== label) : [...current, label],
    );

  return (
    <Modal
      width={520}
      open
      onOpenChange={(open) => !open && onClose()}
      title={text("edit.title")}
      finalFocus={props.finalFocus}
      footer={<EditFooter disabled={unsaveable} onClose={onClose} />}
    >
      <form
        id={FORM_ID}
        data-testid="transaction-edit"
        onSubmit={onSubmit}
        aria-busy={pending}
        className="flex flex-col gap-3"
      >
        <SaveError error={error} />
        <TypeChoiceFields {...props} choice={choice} disabled={pending} />
        <BankFields row={row} />
        <SourceFields row={row} />
        <NoteAndLabels row={row} labels={labels} chosen={chosen} onToggle={toggle} disabled={pending} />
        <EditActions
          row={row}
          disabled={pending}
          onClose={onClose}
          onVisibility={props.onVisibility}
          onDeleteHidden={props.onDeleteHidden}
        />
      </form>
    </Modal>
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

"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { CATEGORY_COLORS, NAME_MAX } from "@ledgerly/domain/transactions/client";
import { Button } from "@ledgerly/ui/button";
import { ColorPicker } from "@ledgerly/ui/color-picker";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { Segmented } from "@ledgerly/ui/segmented";
import type { BoardLine, Dialog, Macro } from "./board-model";
import { type BoardWrites, whereOf } from "./board-writes";

/** What every dialog of the board reads from it. */
export interface DialogContext {
  ids: string;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog) => void;
  error: string | null;
  close: () => void;
  writes: BoardWrites;
  lines: readonly BoardLine[];
  groupsOf: (type: Macro) => BoardLine[];
  /** A category was added under a group: the group opens, so it shows. */
  opened: (groupId: string) => void;
}

const valueOf = (event: FormEvent<HTMLFormElement>, name: string) =>
  String(new FormData(event.currentTarget).get(name) ?? "");

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  );
}

/** «Cancel», and the dialog's action: the submit of its form, or a plain click. */
function DialogFooter({
  board,
  label,
  formId,
  onConfirm,
}: {
  board: DialogContext;
  label: string;
  formId?: string;
  onConfirm?: () => void;
}) {
  const settingsText = useTranslations("settings.categories");
  const action = formId ? { type: "submit" as const, form: formId } : { onClick: onConfirm };
  return (
    <>
      <Button size="sm" onClick={board.close}>
        {settingsText("cancel")}
      </Button>
      <Button
        {...action}
        variant="primary"
        size="sm"
        disabled={board.writes.pending}
        aria-busy={board.writes.pending}
      >
        {label}
      </Button>
    </>
  );
}

/** The colour of a group: automatic until one is picked. */
function ColorField({ id, initial, disabled }: { id: string; initial: string | null; disabled: boolean }) {
  const settingsText = useTranslations("settings.categories");
  const [color, setColor] = useState<string | null>(initial);
  return (
    <Field label={settingsText("color")} htmlFor={id} hint={settingsText("colorHint")}>
      <ColorPicker
        swatches={CATEGORY_COLORS}
        id={id}
        name="color"
        value={color}
        clearLabel={settingsText("autoColor")}
        disabled={disabled}
        onChange={setColor}
      />
    </Field>
  );
}

type Creating = Extract<Dialog, { kind: "group" | "add" }>;

/** Where the new category goes: the macro of a new group, or its group and macro. */
function CreatePlace({ creating, board }: { creating: Creating; board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  if (creating.kind === "add") {
    return (
      <p className="text-sm text-muted">
        {text("addIn", { macro: text(`macro.${creating.macro}`), group: creating.group.name })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden className="text-sm font-medium">
        {text("macroLabel")}
      </span>
      <Segmented
        label={text("macroLabel")}
        value={creating.macro}
        onChange={(next) => board.setDialog({ kind: "group", macro: next })}
        options={(["income", "expense"] as const).map((key) => ({ value: key, label: text(`macro.${key}`) }))}
      />
    </div>
  );
}

function createTitle(
  text: ReturnType<typeof useTranslations<"expenses.categories">>,
  creating: Creating | null,
) {
  if (creating?.kind === "group") return text("newGroup");
  return text("addCategory");
}

/** New group, and a new category under a group (§5.5). */
export function CreateDialog({ board }: { board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const { dialog, ids } = board;
  const creating = dialog?.kind === "group" || dialog?.kind === "add" ? dialog : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creating) return;
    const color = valueOf(event, "color") || null;
    const group = creating.kind === "add" ? creating.group : null;
    const type = creating.macro;
    const input = {
      name: valueOf(event, "name").trim(),
      parentId: group?.id ?? "",
      type,
      color: group ? null : color,
    };
    board.writes.create(input, group?.name ?? text(`macro.${type}`), () => group && board.opened(group.id));
  }

  return (
    <Modal
      open={creating !== null}
      onOpenChange={(next) => !next && board.close()}
      title={createTitle(text, creating)}
      width={420}
      footer={<DialogFooter board={board} label={settingsText("save")} formId={`${ids}-create`} />}
    >
      {creating && (
        <form id={`${ids}-create`} onSubmit={submit} className="flex flex-col gap-3">
          <ErrorLine error={board.error} />
          <Field label={settingsText("name")} htmlFor={`${ids}-name`}>
            <Input id={`${ids}-name`} name="name" maxLength={NAME_MAX} required autoFocus />
          </Field>
          <CreatePlace creating={creating} board={board} />
          {(creating.kind === "group" || creating.group === null) && (
            <ColorField id={`${ids}-color`} initial={null} disabled={board.writes.pending} />
          )}
        </form>
      )}
    </Modal>
  );
}

export function ColorDialog({ board }: { board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const { dialog, ids } = board;
  const line = dialog?.kind === "color" ? dialog.line : null;
  return (
    <Modal
      open={line !== null}
      onOpenChange={(next) => !next && board.close()}
      title={line ? text("colorOf", { name: line.name }) : text("color")}
      width={420}
      footer={<DialogFooter board={board} label={settingsText("save")} formId={`${ids}-color-form`} />}
    >
      {line && (
        <form
          id={`${ids}-color-form`}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            board.writes.recolor(line, valueOf(event, "color") || null);
          }}
        >
          <ErrorLine error={board.error} />
          <ColorField id={`${ids}-recolor`} initial={line.chosenColor} disabled={board.writes.pending} />
        </form>
      )}
    </Modal>
  );
}

export function MoveDialog({ board }: { board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const { dialog, ids } = board;
  const line = dialog?.kind === "move" ? dialog.line : null;
  return (
    <Modal
      open={line !== null}
      onOpenChange={(next) => !next && board.close()}
      title={text("move.group")}
      width={420}
      footer={<DialogFooter board={board} label={text("move.action")} formId={`${ids}-move`} />}
    >
      {line && (
        <form
          id={`${ids}-move`}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            board.writes.move(line, valueOf(event, "parentId"));
          }}
        >
          <ErrorLine error={board.error} />
          <p className="text-sm text-muted">
            {text("move.body", { name: line.name, macro: text(`macro.${line.type}`) })}
          </p>
          <Field label={settingsText("group")} htmlFor={`${ids}-parent`}>
            <Select id={`${ids}-parent`} name="parentId" required defaultValue="">
              <option value="" disabled>
                {text("move.pick")}
              </option>
              {board
                .groupsOf(line.type)
                .filter((group) => group.id !== line.parentId)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </Select>
          </Field>
        </form>
      )}
    </Modal>
  );
}

/** The categories a line may merge into: same macro, open, not from a source; a group with children only into a group. */
function mergeTargets(lines: readonly BoardLine[], merging: Extract<Dialog, { kind: "merge" }>) {
  return lines.filter(
    (one) =>
      one.id !== merging.line.id &&
      one.type === merging.line.type &&
      one.canMerge &&
      !one.archived &&
      // Sub-categories can only move under a group: a third level is refused.
      (!merging.hasChildren || one.parentId === null),
  );
}

export function MergeDialog({ board }: { board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const { dialog, ids } = board;
  const merging = dialog?.kind === "merge" ? dialog : null;
  return (
    <Modal
      open={merging !== null}
      onOpenChange={(next) => !next && board.close()}
      title={settingsText("merge.dialog.title")}
      width={460}
      footer={<DialogFooter board={board} label={text("merge.action")} formId={`${ids}-merge`} />}
    >
      {merging && (
        <form
          id={`${ids}-merge`}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            board.writes.merge(merging.line, valueOf(event, "keepId"));
          }}
        >
          <ErrorLine error={board.error} />
          <Field label={text("merge.keep")} htmlFor={`${ids}-keep`}>
            <Select id={`${ids}-keep`} name="keepId" required defaultValue="">
              <option value="" disabled>
                {text("merge.pick")}
              </option>
              {mergeTargets(board.lines, merging).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.parentId === null ? one.name : `${whereOf(text, board.lines, one)} › ${one.name}`}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-muted">
            {text("merge.body", { name: merging.line.name, count: merging.line.usage })}
          </p>
        </form>
      )}
    </Modal>
  );
}

export function ArchiveDialog({ board }: { board: DialogContext }) {
  const text = useTranslations("expenses.categories");
  const settingsText = useTranslations("settings.categories");
  const archiving = board.dialog?.kind === "archive" ? board.dialog : null;
  return (
    <Modal
      open={archiving !== null}
      onOpenChange={(next) => !next && board.close()}
      title={archiving ? text("archive.title", { name: archiving.line.name }) : settingsText("archive")}
      width={420}
      footer={
        <DialogFooter
          board={board}
          label={settingsText("archive")}
          onConfirm={() => archiving && board.writes.archive(archiving.line)}
        />
      }
    >
      {archiving && (
        <div className="flex flex-col gap-2">
          <ErrorLine error={board.error} />
          <p>{text("archive.body", { count: archiving.line.usage, name: archiving.line.name })}</p>
          {archiving.children > 0 && <p>{text("archive.children", { count: archiving.children })}</p>}
        </div>
      )}
    </Modal>
  );
}

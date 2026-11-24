"use client";

// Time off › Settings, the types of leave (R5g): a person's own list — its names, colours, units,
// which have an allowance and which go to the external calendar. Each change is saved on its own.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import type { LeaveType } from "@ledgerly/domain/timeoff/client";
import { LEAVE_COLORS, LEAVE_UNITS } from "@ledgerly/domain/timeoff/client";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { COLOR_FILL } from "@/modules/timeoff/client";
import { deleteLeaveTypeAction, type LeaveTypeFields, saveLeaveTypeAction, settingsChanged } from "./calls";
import { ErrorLine } from "./settings-forms";

/** A type as the wire carries it: the two words only the server reads are left out. */
type TypeRow = Omit<LeaveType, "balanceKey" | "calendarKind">;

const EMPTY: LeaveTypeFields = {
  name: "",
  color: "primary",
  unit: "half_day",
  hasAllowance: false,
  toCalendar: false,
};

export function LeaveTypes({ types }: { types: TypeRow[] }) {
  const text = useTranslations("timeoff.settings.types");
  /** The type the dialog is about: `null` for a new one; the dialog is closed while unset. */
  const [editing, setEditing] = useState<{ type: TypeRow | null } | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(type: TypeRow) {
    if (!window.confirm(text("confirmRemove", { name: type.name }))) return;
    start(async () => {
      const result = await deleteLeaveTypeAction(type.id);
      if (!result.ok) {
        setError(result.error === "in_use" ? text("inUse", { name: type.name }) : text("failed"));
        return;
      }
      setError(null);
      notify(text("removed", { name: type.name }));
      settingsChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {types.length === 0 ? (
        <p className="text-muted">{text("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="leave-types">
          {types.map((type) => (
            <TypeLine
              key={type.id}
              type={type}
              pending={pending}
              onEdit={() => setEditing({ type })}
              onRemove={() => remove(type)}
            />
          ))}
        </ul>
      )}
      <ErrorLine error={error} />
      <div>
        <Button onClick={() => setEditing({ type: null })}>{text("add")}</Button>
      </div>
      {editing !== undefined && <TypeDialog type={editing.type} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function TypeLine({
  type,
  pending,
  onEdit,
  onRemove,
}: {
  type: TypeRow;
  pending: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const text = useTranslations("timeoff.settings.types");
  const traits = [
    text(`units.${type.unit}`),
    type.hasAllowance ? text("withAllowance") : null,
    type.toCalendar ? text("toCalendar") : null,
  ].filter((one): one is string => one !== null);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border p-3">
      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-xs-plus", COLOR_FILL[type.color])} />
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate font-medium">{type.name}</div>
        <div className="text-sm text-muted">{traits.join(" · ")}</div>
      </div>
      <div className="ml-auto flex gap-1.5">
        <Button
          size="xs"
          disabled={pending}
          onClick={onEdit}
          aria-label={text("editOf", { name: type.name })}
        >
          {text("edit")}
        </Button>
        <Button
          size="xs"
          variant="danger"
          disabled={pending}
          onClick={onRemove}
          aria-label={text("removeOf", { name: type.name })}
        >
          {text("remove")}
        </Button>
      </div>
    </li>
  );
}

/** Adds a type, or changes one: the same five fields. */
function TypeDialog({ type, onClose }: { type: TypeRow | null; onClose: () => void }) {
  const text = useTranslations("timeoff.settings.types");
  const actions = useTranslations("timeoff.actions");
  const [fields, setFields] = useState<LeaveTypeFields>(() =>
    type === null
      ? EMPTY
      : {
          name: type.name,
          color: type.color,
          unit: type.unit,
          hasAllowance: type.hasAllowance,
          toCalendar: type.toCalendar,
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (fields.name.trim() === "") return setError(text("nameMissing"));
    start(async () => {
      const result = await saveLeaveTypeAction(type?.id ?? null, { ...fields, name: fields.name.trim() });
      if (!result.ok) return setError(result.error === "conflict" ? text("duplicate") : text("failed"));
      notify(type === null ? text("added", { name: fields.name.trim() }) : text("saved"));
      settingsChanged();
      onClose();
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={type === null ? text("addTitle") : text("editTitle")}
      width={460}
      onSubmit={submit}
      error={error}
      pending={pending}
      cancelLabel={actions("cancel")}
      submitLabel={text("submit")}
    >
      <TypeFields fields={fields} onChange={setFields} />
    </FormDialog>
  );
}

/** The five fields of a type. */
function TypeFields({
  fields,
  onChange,
}: {
  fields: LeaveTypeFields;
  onChange: (change: (was: LeaveTypeFields) => LeaveTypeFields) => void;
}) {
  const text = useTranslations("timeoff.settings.types");
  const id = useId();
  const set = <K extends keyof LeaveTypeFields>(key: K, value: LeaveTypeFields[K]) =>
    onChange((was) => ({ ...was, [key]: value }));
  return (
    <>
      <Field label={text("name")} htmlFor={`${id}-name`}>
        <Input
          id={`${id}-name`}
          maxLength={40}
          value={fields.name}
          onChange={(event) => set("name", event.target.value)}
          required
        />
      </Field>
      <Field label={text("color")} htmlFor={`${id}-color`}>
        <Choices
          id={`${id}-color`}
          value={fields.color}
          options={LEAVE_COLORS.map((one) => ({ value: one, label: text(`colors.${one}`) }))}
          onChange={(next) => set("color", next)}
        />
      </Field>
      <Field label={text("unit")} htmlFor={`${id}-unit`} hint={text("unitHint")}>
        <Choices
          id={`${id}-unit`}
          value={fields.unit}
          options={LEAVE_UNITS.map((one) => ({ value: one, label: text(`units.${one}`) }))}
          onChange={(next) => set("unit", next)}
        />
      </Field>
      <Checkbox
        label={text("hasAllowance")}
        checked={fields.hasAllowance}
        onChange={(event) => set("hasAllowance", event.target.checked)}
      />
      <Checkbox
        label={text("goesToCalendar")}
        checked={fields.toCalendar}
        onChange={(event) => set("toCalendar", event.target.checked)}
      />
    </>
  );
}

/** A select of a closed list: what it hands back is one of the list, never the bare string of the DOM. */
function Choices<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(options.find((one) => one.value === event.target.value)?.value ?? value)}
    >
      {options.map((one) => (
        <option key={one.value} value={one.value}>
          {one.label}
        </option>
      ))}
    </Select>
  );
}

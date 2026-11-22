"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState } from "react";
import { NOTE_MAX } from "@ledgerly/domain/transactions/client";
import type { NumberFormat } from "@ledgerly/format/format";
import { type PreviewView, previewRuleAction, type RuleInput, saveRuleAction } from "@/modules/transactions";
import { Button } from "@ledgerly/ui/button";
import { CategoryPicker, type CategoryOption } from "@ledgerly/ui/category-picker";
import { Checkbox, Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { MovementList } from "./apply-dialog";
import { ConditionsField, type Patch } from "./rule-conditions";
import { type Editing, inputOf, type Named } from "./rule-lines";

const DEBOUNCE_MS = 400;

/** The live preview (§4.6): only for a valid rule, at most every 400 ms; "busy" while it runs. */
function useRulePreview(input: RuleInput | null, ruleId: string | null) {
  // The answer and the rule it is for: an answer for another rule is "Calculating…".
  const [answer, setAnswer] = useState<{ for: string; value: PreviewView | "error" } | null>(null);
  const serial = input === null ? null : JSON.stringify(input);
  useEffect(() => {
    if (serial === null) return;
    let live = true;
    const timer = setTimeout(() => {
      previewRuleAction(JSON.parse(serial), ruleId)
        .then((value) => live && setAnswer({ for: serial, value: value ?? "error" }))
        .catch(() => live && setAnswer({ for: serial, value: "error" }));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [serial, ruleId]);
  if (serial === null) return null;
  return answer?.for === serial ? answer.value : "busy";
}

function CategoryField({
  editing,
  set,
  categories,
  fieldId,
}: {
  editing: Editing;
  set: Patch;
  categories: CategoryOption[];
  fieldId: string;
}) {
  const text = useTranslations("settings.rules");
  const [pickerOpen, setPickerOpen] = useState(false);
  const category = categories.find((one) => one.id === editing.categoryId) ?? null;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${fieldId}-category`} className="text-sm">
        {text("action.category")}
      </span>
      <CategoryPicker
        categories={categories}
        currentId={editing.categoryId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(categoryId) => set({ categoryId })}
        searchLabel={text("searchCategory")}
        noMatchLabel={text("noCategoryMatch")}
        triggerLabel={`${text("action.category")}: ${category?.name ?? text("chooseCategory")}`}
        triggerClassName="focus-ring flex h-8 w-full items-center gap-2 rounded-control border border-border bg-card px-2 text-left"
      >
        {category ? (
          <>
            <span aria-hidden className="size-2 shrink-0 rounded-xs" style={{ background: category.color }} />
            <span className="min-w-0 truncate">
              {category.section ? `${category.section} › ` : ""}
              {category.name}
            </span>
          </>
        ) : (
          <span className="text-muted">{text("chooseCategory")}</span>
        )}
      </CategoryPicker>
    </div>
  );
}

function LabelsField({ editing, set, labels }: { editing: Editing; set: Patch; labels: Named[] }) {
  const text = useTranslations("settings.rules");
  if (labels.length === 0) return null;
  return (
    <div role="group" aria-label={text("action.labels")} className="flex flex-col gap-1">
      <span className="text-sm">{text("action.labels")}</span>
      <div className="flex max-h-28 flex-wrap gap-x-4 overflow-y-auto">
        {labels.map((label) => (
          <Checkbox
            key={label.id}
            label={label.name}
            checked={editing.labelIds.includes(label.id)}
            onChange={(event) =>
              set({
                labelIds: event.target.checked
                  ? [...editing.labelIds, label.id]
                  : editing.labelIds.filter((one) => one !== label.id),
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function NoteField({ editing, set, fieldId }: { editing: Editing; set: Patch; fieldId: string }) {
  const text = useTranslations("settings.rules");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${fieldId}-note`} className="text-sm">
        {text("action.note")}
      </label>
      <Input
        id={`${fieldId}-note`}
        value={editing.note}
        maxLength={NOTE_MAX}
        aria-describedby={`${fieldId}-note-hint`}
        onChange={(event) => set({ note: event.target.value })}
      />
      <p id={`${fieldId}-note-hint`} className="text-sm text-muted">
        {text("noteHint")}
      </p>
    </div>
  );
}

function PreviewAnswer({ preview }: { preview: PreviewView }) {
  const text = useTranslations("settings.rules");
  const [seeAll, setSeeAll] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <p>
        {text("preview.match", { count: preview.matched })}{" "}
        {preview.kept > 0 && text("preview.kept", { count: preview.kept })}
      </p>
      {preview.rows.length > 0 && (
        <>
          <Button
            size="xs"
            variant="ghost"
            type="button"
            className="self-start"
            aria-expanded={seeAll}
            onClick={() => setSeeAll(!seeAll)}
          >
            {seeAll ? text("preview.hide") : text("preview.see")}
          </Button>
          {seeAll && <MovementList rows={preview.rows} />}
        </>
      )}
    </div>
  );
}

function RulePreview({ preview }: { preview: PreviewView | "busy" | "error" | null }) {
  const text = useTranslations("settings.rules");
  const message = (key: "preview.invalid" | "preview.busy" | "preview.error") => (
    <p className="text-muted">{text(key)}</p>
  );
  let body;
  if (preview === null) body = message("preview.invalid");
  else if (preview === "busy") body = message("preview.busy");
  else if (preview === "error") body = message("preview.error");
  else body = <PreviewAnswer preview={preview} />;
  return (
    <div
      aria-live="polite"
      aria-busy={preview === "busy" || undefined}
      className="text-sm"
      data-testid="rule-preview"
    >
      {body}
    </div>
  );
}

/** Saves the rule the editor holds; `error` is the message of a refusal. */
function useSaveRule(editing: Editing, onSaved: (id: string, changes: number, name: string) => void) {
  const text = useTranslations("settings.rules");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (input: RuleInput) => {
    setSaving(true);
    setError(null);
    saveRuleAction(editing.id, input)
      .then((result) => {
        if (result.ok) onSaved(result.id, result.changes, input.name);
        else setError(result.error === "limit" ? text("limit") : text("error"));
      })
      .catch(() => setError(text("error")))
      .finally(() => setSaving(false));
  };
  return { saving, error, save };
}

function NameField({ editing, set, fieldId }: { editing: Editing; set: Patch; fieldId: string }) {
  const text = useTranslations("settings.rules");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
        {text("name")}
      </label>
      <Input
        id={`${fieldId}-name`}
        value={editing.name}
        maxLength={80}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus
      />
    </div>
  );
}

function EditorFooter({
  formId,
  ready,
  saving,
  onClose,
}: {
  formId: string;
  ready: boolean;
  saving: boolean;
  onClose: () => void;
}) {
  const text = useTranslations("settings.rules");
  return (
    <>
      <Button size="sm" onClick={onClose} disabled={saving}>
        {text("cancel")}
      </Button>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        form={formId}
        disabled={!ready || saving}
        aria-busy={saving || undefined}
      >
        {saving ? text("saving") : text("save")}
      </Button>
    </>
  );
}

interface RuleEditorProps {
  editing: Editing;
  setEditing: (next: Editing) => void;
  categories: CategoryOption[];
  labels: Named[];
  accounts: Named[];
  currencies: string[];
  numberFormat: NumberFormat;
  onClose: () => void;
  onSaved: (id: string, changes: number, name: string) => void;
}

/** The editor of a rule (§4.3-§4.6): name, conditions, what it does and the live preview. */
export function RuleEditor({
  editing,
  setEditing,
  categories,
  labels,
  accounts,
  currencies,
  numberFormat,
  onClose,
  onSaved,
}: RuleEditorProps) {
  const text = useTranslations("settings.rules");
  const id = useId();
  const input = inputOf(editing, numberFormat);
  const preview = useRulePreview(input, editing.id);
  const { saving, error, save } = useSaveRule(editing, onSaved);
  const set: Patch = (patch) => setEditing({ ...editing, ...patch });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input !== null && !saving) save(input);
  }

  const footer = (
    <EditorFooter formId={`${id}-form`} ready={input !== null} saving={saving} onClose={onClose} />
  );
  return (
    <Modal
      open
      width={520}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={editing.id === null ? text("new") : text("edit")}
      footer={footer}
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4" data-testid="rule-editor">
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
        <NameField editing={editing} set={set} fieldId={id} />
        <ConditionsField editing={editing} set={set} accounts={accounts} currencies={currencies} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-sm font-medium">{text("then")}</legend>
          <CategoryField editing={editing} set={set} categories={categories} fieldId={id} />
          <LabelsField editing={editing} set={set} labels={labels} />
          <NoteField editing={editing} set={set} fieldId={id} />
        </fieldset>
        <RulePreview preview={preview} />
      </form>
    </Modal>
  );
}

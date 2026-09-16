"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { createLabelAction, deleteLabelAction, saveLabelAction } from "./actions";
import { ColorDot, ColorSwatchPicker } from "./color-swatch";
import { NAME_MAX } from "@/modules/transactions/rules";

/** What the browser gets per label: the row itself plus how many movements carry it. */
export interface LabelRow {
  id: string;
  name: string;
  color: string | null;
  usage: number;
}

interface Draft {
  /** `null` while adding: the same dialog creates and edits. */
  id: string | null;
  name: string;
  color: string | null;
}

const EMPTY_DRAFT: Draft = { id: null, name: "", color: null };

const FORM_ID = "label-form";

/**
 * Settings › Data › Labels (spec §7.2): create, rename, colour, delete. A label is really deleted,
 * so the confirmation says how many movements lose it first.
 */
export function LabelsCard({ rows }: { rows: LabelRow[] }) {
  const t = useTranslations("settings.data.labels");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<LabelRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** A `TaxonomyError` code, spelled out one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "duplicate") return t("errors.duplicate");
    if (code === "invalid") return t("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return t("errors.notFound");
    return t("errors.failed");
  }

  function open(row?: LabelRow) {
    setError(null);
    setDraft(row ? { id: row.id, name: row.name, color: row.color } : EMPTY_DRAFT);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = { name: text("name"), color: text("color") || null };
    const id = draft.id;
    startTransition(async () => {
      try {
        const result = id ? await saveLabelAction(id, input) : await createLabelAction(input);
        if (!result.ok) {
          setError(messageFor(result.error));
          return;
        }
        setError(null);
        setDraft(null);
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function onRemove() {
    if (!removing) return;
    const id = removing.id;
    startTransition(async () => {
      try {
        const result = await deleteLabelAction(id);
        if (!result.ok) {
          setError(messageFor(result.error));
          return;
        }
        setError(null);
        setRemoving(null);
        notify(t("removedToast"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-2.5">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => open()}>
          {t("add")}
        </Button>
      </div>

      {error && draft === null && removing === null && (
        <p role="alert" className="border-b border-border px-4 py-2.5 text-sm text-neg">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="p-4 text-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Th>{t("name")}</Th>
              <Th align="right">
                <span className="sr-only">{t("edit")}</span>
              </Th>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <ColorDot color={row.color} />
                      <span className="min-w-0 truncate">{row.name}</span>
                    </span>
                    <span className="block pl-[18px] text-sm text-muted">
                      {t("usage", { count: row.usage })}
                    </span>
                  </Td>
                  <Td align="right">
                    <ActionMenu
                      label={row.name}
                      items={[
                        { label: t("rename"), onSelect: () => open(row) },
                        {
                          label: t("remove"),
                          onSelect: () => {
                            setError(null);
                            setRemoving(row);
                          },
                          danger: true,
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? t("edit") : t("add")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
            <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={pending}>
              {t("save")}
            </Button>
          </>
        }
      >
        {draft && (
          <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
            {/* The open dialog hides the card behind it from assistive technology, so the
                refusal has to be announced in here rather than up in the card. */}
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={t("name")} htmlFor="label-name">
              <Input
                id="label-name"
                name="name"
                defaultValue={draft.name}
                maxLength={NAME_MAX}
                required
                autoFocus
              />
            </Field>
            <Field label={t("color")} htmlFor="label-color">
              <ColorSwatchPicker
                id="label-color"
                name="color"
                value={draft.color}
                clearLabel={t("noColor")}
                disabled={pending}
                onChange={(color) => setDraft({ ...draft, color })}
              />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("remove_confirm.title")}
        description={t("remove_confirm.description", { count: removing?.usage ?? 0 })}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setRemoving(null)}>
              {t("remove_confirm.cancel")}
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={onRemove}>
              {t("remove_confirm.confirm")}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        ) : (
          <span />
        )}
      </Modal>
    </div>
  );
}

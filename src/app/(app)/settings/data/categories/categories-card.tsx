"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { CATEGORY_TYPES, type CategoryType } from "@/modules/transactions/rules";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import {
  archiveCategoryAction,
  createCategoryAction,
  restoreCategoryAction,
  saveCategoryAction,
} from "./actions";
import { ColorDot, ColorSwatchPicker } from "./color-swatch";
import { NAME_MAX } from "@/modules/transactions/rules";

/** What the browser gets per category: the row itself plus how many movements point at it. */
export interface CategoryRow {
  id: string;
  name: string;
  group: string | null;
  type: CategoryType;
  color: string | null;
  archived: boolean;
  usage: number;
}

interface Draft {
  /** `null` while adding: the same dialog creates and edits. */
  id: string | null;
  name: string;
  group: string;
  type: CategoryType;
  color: string | null;
}

const EMPTY_DRAFT: Draft = { id: null, name: "", group: "", type: "expense", color: null };

const FORM_ID = "category-form";

/**
 * Settings › Data › Categories (spec §7.2): create, rename, group, colour, type, archive and
 * restore. Archived rows stay in the table behind "Show archived" rather than disappearing — a
 * synced category is adopted by name, so knowing a name is taken is worth seeing.
 */
export function CategoriesCard({ rows }: { rows: CategoryRow[] }) {
  const t = useTranslations("settings.data.categories");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasArchived = rows.some((row) => row.archived);
  const visible = showArchived ? rows : rows.filter((row) => !row.archived);

  /** A `TaxonomyError` code, spelled out one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "duplicate") return t("errors.duplicate");
    if (code === "invalid") return t("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return t("errors.notFound");
    return t("errors.failed");
  }

  function open(row?: CategoryRow) {
    setError(null);
    setDraft(
      row
        ? { id: row.id, name: row.name, group: row.group ?? "", type: row.type, color: row.color }
        : EMPTY_DRAFT,
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      name: text("name"),
      group: text("group"),
      type: text("type"),
      color: text("color") || null,
    };
    const id = draft.id;
    startTransition(async () => {
      try {
        const result = id ? await saveCategoryAction(id, input) : await createCategoryAction(input);
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

  function onArchive(row: CategoryRow) {
    startTransition(async () => {
      try {
        const result = row.archived
          ? await restoreCategoryAction(row.id)
          : await archiveCategoryAction(row.id);
        if (!result.ok) {
          setError(messageFor(result.error));
          return;
        }
        setError(null);
        notify(t(row.archived ? "restoredToast" : "archivedToast"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        {hasArchived ? (
          <Checkbox
            label={t("showArchived")}
            checked={showArchived}
            onChange={(event) => setShowArchived(event.currentTarget.checked)}
          />
        ) : (
          <span />
        )}
        <Button size="sm" variant="primary" disabled={pending} onClick={() => open()}>
          {t("add")}
        </Button>
      </div>

      {error && draft === null && (
        <p role="alert" className="border-b border-border px-4 py-2.5 text-sm text-neg">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="p-4 text-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Th>{t("name")}</Th>
              <Th>{t("group")}</Th>
              <Th>{t("type")}</Th>
              <Th align="right">
                <span className="sr-only">{t("edit")}</span>
              </Th>
            </THead>
            <TBody>
              {visible.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <ColorDot color={row.color} />
                      <span className="min-w-0 truncate">{row.name}</span>
                      {row.archived && <Badge tone="neutral">{t("archived")}</Badge>}
                    </span>
                    <span className="block pl-[18px] text-sm text-muted">
                      {t("usage", { count: row.usage })}
                    </span>
                  </Td>
                  <Td muted>{row.group ?? t("noGroup")}</Td>
                  <Td>{t(`types.${row.type}`)}</Td>
                  <Td align="right">
                    <ActionMenu
                      label={row.name}
                      items={[
                        { label: t("rename"), onSelect: () => open(row) },
                        {
                          label: row.archived ? t("restore") : t("archive"),
                          onSelect: () => onArchive(row),
                          danger: !row.archived,
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
            <Field label={t("name")} htmlFor="category-name">
              <Input
                id="category-name"
                name="name"
                defaultValue={draft.name}
                maxLength={NAME_MAX}
                required
                autoFocus
              />
            </Field>
            <Field label={t("group")} htmlFor="category-group">
              <Input id="category-group" name="group" defaultValue={draft.group} maxLength={NAME_MAX} />
            </Field>
            <Field label={t("type")} htmlFor="category-type">
              <Select id="category-type" name="type" defaultValue={draft.type}>
                {CATEGORY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("color")} htmlFor="category-color">
              <ColorSwatchPicker
                id="category-color"
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
    </div>
  );
}

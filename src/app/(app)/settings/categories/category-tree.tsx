"use client";

import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { CATEGORY_TYPES, type CategoryType, NAME_MAX } from "@/modules/transactions/rules";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  archiveCategoryAction,
  createCategoryAction,
  deleteCategoryAction,
  restoreCategoryAction,
  saveCategoryAction,
} from "./actions";
import { ColorDot, ColorSwatchPicker } from "./color-swatch";

/** One category as the tree draws it. `color` is already resolved: a child carries its group's. */
export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  type: CategoryType;
  /** The colour it is drawn in — never null, because a group with none gets one from its id. */
  color: string;
  /** What the person actually chose, or null while the colour is the automatic one. */
  chosenColor: string | null;
  archived: boolean;
  usage: number;
  /** The categories of a source that count under it, where their names say more than its own. */
  source?: { name: string; names: readonly string[]; href: string | null } | null;
}

export interface CategoryGroup {
  group: CategoryNode;
  children: CategoryNode[];
}

interface Draft {
  /** `null` while adding: the same dialog creates and edits. */
  id: string | null;
  name: string;
  parentId: string;
  type: CategoryType;
  color: string | null;
  /** A group with sub-categories cannot go inside another group (a third level, spec §7.2). */
  hasChildren: boolean;
}

const FORM_ID = "category-form";

function draftFor(node: CategoryNode, hasChildren: boolean): Draft {
  return {
    id: node.id,
    name: node.name,
    parentId: node.parentId ?? "",
    type: node.type,
    color: node.chosenColor,
    hasChildren,
  };
}

/**
 * Settings › Categories (spec §7.2, owner 2026-09-21): the tree as a tree.
 *
 * A group is a section with its colour and its type; its sub-categories sit under it, each with
 * "add another" at the end of the list. It replaces the flat table of Settings › Data, where the
 * only way to see that a category belonged to a group was to read a second column, and the only
 * way to move it was to open a dialog and hunt through a picker.
 *
 * A sub-category has **no colour of its own**: it is drawn in its group's, so a legend, a chart
 * and a table never disagree about the same money. The dialog says so instead of offering a
 * control that would be ignored.
 */
export function CategoryTree({ groups }: { groups: CategoryGroup[] }) {
  const t = useTranslations("settings.categories");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<CategoryNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasArchived = groups.some(
    ({ group, children }) => group.archived || children.some((child) => child.archived),
  );
  const shown = groups
    .filter(({ group }) => showArchived || !group.archived)
    .map(({ group, children }) => ({
      group,
      children: showArchived ? children : children.filter((child) => !child.archived),
    }));
  const open = groups.filter(({ group }) => !group.archived).map(({ group }) => group);
  const parent = draft?.parentId ? open.find((group) => group.id === draft.parentId) : undefined;

  /** "From {source}: …" under a category that a source's categories count under (ux §6.4). */
  function sourceNote(node: CategoryNode) {
    if (!node.source || node.source.names.length === 0) return null;
    const text = t("source.fromProvider", {
      provider: node.source.name,
      names: node.source.names.join(", "),
    });
    // The match is changed on the source's page (plugin-settings.md §2.2): the note leads there.
    return node.source.href === null ? (
      <span className="truncate text-sm text-muted">{text}</span>
    ) : (
      <Link
        href={node.source.href as Route}
        className="focus-ring block min-h-6 truncate rounded-[2px] text-sm leading-6 text-muted hover:underline"
      >
        {text}
      </Link>
    );
  }

  /** A `TaxonomyError` code, spelled out one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "duplicate") return t("errors.duplicate");
    if (code === "invalid") return t("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return t("errors.notFound");
    if (code === "invalid_parent") return t("errors.invalidParent");
    return t("errors.failed");
  }

  function edit(node: CategoryNode, hasChildren: boolean) {
    setError(null);
    setDraft(draftFor(node, hasChildren));
  }

  function add(parentId: string | null, type: CategoryType) {
    setError(null);
    setDraft({ id: null, name: "", parentId: parentId ?? "", type, color: null, hasChildren: false });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      name: text("name"),
      parentId: text("parentId"),
      type: text("type"),
      // A sub-category never carries a colour: it is its group's (see this component's note).
      color: text("parentId") === "" ? text("color") || null : null,
    };
    const id = draft.id;
    startTransition(async () => {
      const result = id ? await saveCategoryAction(id, input) : await createCategoryAction(input);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      setError(null);
      setDraft(null);
      notify(t("saved"));
    });
  }

  function onArchive(node: CategoryNode) {
    startTransition(async () => {
      const result = node.archived
        ? await restoreCategoryAction(node.id)
        : await archiveCategoryAction(node.id);
      notify(
        result.ok ? t(node.archived ? "restoredToast" : "archivedToast") : messageFor(result.error),
        result.ok ? "success" : "error",
      );
    });
  }

  function onDelete(node: CategoryNode) {
    setRemoving(null);
    startTransition(async () => {
      const result = await deleteCategoryAction(node.id);
      if (!result.ok) {
        notify(messageFor(result.error), "error");
        return;
      }
      notify(t("deletedToast", { name: node.name, count: result.uncategorised }));
      // Wallet is a second story with its own ending, told separately so neither hides the other.
      const wallet = result.wallet;
      if (wallet.state === "deleted") notify(t("wallet.deleted", { count: wallet.count }));
      if (wallet.state === "refused") notify(t("wallet.refused", { reason: wallet.reasons[0] }), "error");
      if (wallet.state === "failed") notify(t("wallet.failed", { reason: wallet.reason }), "error");
    });
  }

  function actionsFor(node: CategoryNode, hasChildren: boolean) {
    return (
      <ActionMenu
        label={node.name}
        items={[
          { label: t("edit"), onSelect: () => edit(node, hasChildren) },
          {
            label: node.archived ? t("restore") : t("archive"),
            onSelect: () => onArchive(node),
          },
          { label: t("delete"), onSelect: () => setRemoving(node), danger: true },
        ]}
      />
    );
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
        <Button size="sm" variant="primary" disabled={pending} onClick={() => add(null, "expense")}>
          {t("addGroup")}
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="p-4 text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map(({ group, children }) => (
            <li key={group.id} className="border-b border-border last:border-0">
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <ColorDot color={group.color} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{group.name}</span>
                  {sourceNote(group)}
                </span>
                {group.archived && <Badge tone="neutral">{t("archived")}</Badge>}
                <span className="text-sm text-muted">{t(`types.${group.type}`)}</span>
                <span className="text-sm text-muted">{t("usage", { count: group.usage })}</span>
                {actionsFor(group, children.length > 0)}
              </div>
              <ul className="flex flex-col">
                {children.map((child) => (
                  <li
                    key={child.id}
                    className="flex flex-wrap items-center gap-2 border-t border-border py-2 pr-4 pl-10"
                  >
                    <ColorDot color={child.color} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{child.name}</span>
                      {sourceNote(child)}
                    </span>
                    {child.archived && <Badge tone="neutral">{t("archived")}</Badge>}
                    <span className="text-sm text-muted">{t("usage", { count: child.usage })}</span>
                    {actionsFor(child, false)}
                  </li>
                ))}
                {!group.archived && (
                  <li className="border-t border-border py-1.5 pr-4 pl-10">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => add(group.id, group.type)}
                    >
                      {t("addChild")}
                    </Button>
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.id ? t("edit") : draft?.parentId ? t("addChild") : t("addGroup")}
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
            {/* The open dialog hides the list behind it from assistive technology, so the refusal
                has to be announced in here rather than out there. */}
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
              <Select
                id="category-group"
                name="parentId"
                value={draft.parentId}
                disabled={draft.hasChildren}
                onChange={(event) => setDraft({ ...draft, parentId: event.currentTarget.value })}
              >
                <option value="">{t("noGroup")}</option>
                {open
                  .filter((group) => group.id !== draft.id)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {draft.hasChildren && <p className="-mt-1.5 text-sm text-muted">{t("hasChildren")}</p>}
            <Field label={t("type")} htmlFor="category-type">
              {/* In a group the type is the group's (spec §7.2): shown, locked, and still submitted
                  — a disabled field is left out of the form, so a hidden one carries it. */}
              <Select
                id="category-type"
                name={parent ? undefined : "type"}
                value={parent?.type ?? draft.type}
                disabled={parent !== undefined}
                onChange={(event) => setDraft({ ...draft, type: event.currentTarget.value as CategoryType })}
              >
                {CATEGORY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
              {parent && <input type="hidden" name="type" value={parent.type} />}
            </Field>
            {parent ? (
              <p className="-mt-1.5 flex items-center gap-2 text-sm text-muted">
                <ColorDot color={parent.color} />
                {t("colorFromGroup", { group: parent.name })}
              </p>
            ) : (
              <Field label={t("color")} htmlFor="category-color" hint={t("colorHint")}>
                <ColorSwatchPicker
                  id="category-color"
                  name="color"
                  value={draft.color}
                  clearLabel={t("autoColor")}
                  disabled={pending}
                  onChange={(color) => setDraft({ ...draft, color })}
                />
              </Field>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t("deleteTitle")}
        description={removing ? t("deleteWarning", { name: removing.name }) : undefined}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => setRemoving(null)}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => removing && onDelete(removing)}
            >
              {t("delete")}
            </Button>
          </>
        }
      >
        {removing && (
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted">
            <li>{t("deleteMovements", { count: removing.usage })}</li>
            <li>{t("deleteBudgets")}</li>
            {removing.parentId === null && <li>{t("deleteChildren")}</li>}
            <li className="font-medium text-neg">{t("deleteWallet")}</li>
          </ul>
        )}
      </Modal>
    </div>
  );
}

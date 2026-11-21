"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type RefObject, useRef, useState, useTransition } from "react";
import { saveSourceAction } from "../calls";
import { Button, buttonClassName } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { notify } from "@ledgerly/ui/toast";
import { removeSourceAction, restoreSourceAction, setSourceStateAction } from "../calls";
import { newSourceForm, type SourceForm } from "@ledgerly/domain/funds/client";
import type { SourceKind } from "@ledgerly/domain/funds/client";
import { SourceDialog, type SourceSetup } from "./source-dialog";
import { freeComponents } from "./source-text";

interface Item {
  label: string;
  onSelect: () => void;
  /** An item that only explains why the action is not there. */
  disabled?: boolean;
}

/**
 * The menu of a source and the one behind "Add source". The app's `ActionMenu` and `ButtonMenu`
 * with one thing more: an item can be disabled, which is how the menu says why "Remove" is missing.
 */
function SourceMenu({
  trigger,
  label,
  items,
  triggerRef,
}: {
  trigger: "actions" | "add";
  label: string;
  items: Item[];
  /** The button of "Add source": the dialog it opens gives the focus back to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Menu.Root>
      {trigger === "actions" ? (
        <Menu.Trigger
          aria-label={label}
          title={label}
          className="focus-ring inline-grid size-6 place-items-center rounded-tag text-muted hover:bg-hover hover:text-fg"
        >
          <Ellipsis aria-hidden className="size-3.5" />
        </Menu.Trigger>
      ) : (
        <Menu.Trigger
          ref={triggerRef}
          data-add-source
          className={cn(buttonClassName("secondary", "sm"), "gap-1")}
        >
          <Plus aria-hidden className="size-3.5" />
          {label}
          <ChevronDown aria-hidden className="size-3.5" />
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align={trigger === "actions" ? "end" : "start"} className="z-30">
          <Menu.Popup className="max-w-[calc(100vw-32px)] min-w-40 animate-in rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="flex min-h-7 cursor-default items-center rounded-tag px-2 text-base data-[disabled]:text-muted data-[highlighted]:bg-hover"
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * "Edit" and the menu of one source (screens §6.2): pause or resume, and remove — at once, with
 * "Undo" in the toast — for a source with no contribution. One with contributions is only paused:
 * the menu says so with a disabled item.
 */
export function SourceActions({
  source,
  contributions,
  customDue,
  ...setup
}: SourceSetup & {
  source: SourceForm & { id: string };
  /** How many contributions the source has. */
  contributions: number;
  customDue?: string | null;
}) {
  const t = useTranslations("funds.sources");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const { fundId } = setup;
  const kind = t(`kinds.${source.kind}`);

  function setState(state: "active" | "paused") {
    startTransition(async () => {
      const result = await setSourceStateAction(fundId, source.id, state);
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.error === "component_taken") {
        notify(t("errors.componentTaken", { fund: result.detail ?? "" }), "error");
      } else if (result.error === "payroll_active") notify(t("errors.onePayroll"), "error");
      else notify(t(result.error === "archived" ? "errors.archived" : "errors.failed"), "error");
    });
  }

  function remove() {
    // After the removal the focus goes to the row that follows, or to "Add source".
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="source-row"]'));
    const at = rows.findIndex((row) => row.dataset.source === source.id);
    const next = rows[at + 1] ?? rows[at - 1];
    startTransition(async () => {
      const result = await removeSourceAction(fundId, source.id);
      if (!result.ok) {
        notify(t(result.error === "archived" ? "errors.archived" : "errors.failed"), "error");
        return;
      }
      router.refresh();
      notify(t("removed"), "success", {
        label: t("undo"),
        onClick: () => {
          void restoreSourceAction(fundId, result.removed).then((restored) => {
            if (restored.ok) router.refresh();
            else notify(t("undoFailed"), "error");
          });
        },
      });
      requestAnimationFrame(() => {
        const target =
          next?.querySelector<HTMLElement>("button") ??
          document.querySelector<HTMLElement>("[data-add-source]");
        target?.focus();
      });
    });
  }

  const items: Item[] = [];
  if (source.kind !== "manual") {
    items.push(
      source.state === "active"
        ? { label: t("pause"), onSelect: () => setState("paused") }
        : { label: t("resume"), onSelect: () => setState("active") },
    );
  }
  items.push(
    contributions > 0
      ? { label: t("removeBlocked", { count: contributions }), onSelect: () => {}, disabled: true }
      : { label: t("remove"), onSelect: remove },
  );

  return (
    <>
      {source.kind !== "manual" && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          aria-label={t("editLabel", { kind })}
          onClick={() => setEditing(true)}
        >
          {t("edit")}
        </Button>
      )}
      <SourceMenu trigger="actions" label={t("actions", { kind })} items={items} />
      {source.kind !== "manual" && (
        <SourceDialog
          {...setup}
          open={editing}
          onOpenChange={setEditing}
          source={source}
          customDue={customDue}
        />
      )}
    </>
  );
}

/**
 * "Add source": a payslip or a debit opens the source dialog; "payments by hand" has no field and
 * is added at once. A fund has one "payments by hand" at most, and no payslip without Payroll.
 */
export function AddSource({
  hasManual,
  provider,
  ...setup
}: SourceSetup & {
  /** True when the fund has "payments by hand" already: the item is disabled. */
  hasManual: boolean;
  /** The fund's provider: what "Payee contains" of a new debit starts from. */
  provider: string;
}) {
  const t = useTranslations("funds.sources");
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState<SourceForm | null>(null);
  // The dialog keeps its last source while it closes, so its title does not change on the way out.
  const [last, setLast] = useState<SourceForm>(() => newSourceForm("bank_debit"));

  function open(kind: Exclude<SourceKind, "manual">) {
    const source =
      kind === "payroll"
        ? { ...newSourceForm("payroll"), components: freeComponents(setup.taken) }
        : newSourceForm("bank_debit", { payeeMatch: provider.slice(0, 80) });
    setLast(source);
    setAdding(source);
  }

  function addManual() {
    startTransition(async () => {
      const result = await saveSourceAction(setup.fundId, newSourceForm("manual"));
      if (result.ok) {
        notify(t("saved"));
        router.refresh();
      } else notify(t(result.error === "archived" ? "errors.archived" : "errors.failed"), "error");
    });
  }

  const items: Item[] = [
    ...(setup.payrollAvailable ? [{ label: t("kinds.payroll"), onSelect: () => open("payroll") }] : []),
    { label: t("kinds.bank_debit"), onSelect: () => open("bank_debit") },
    { label: t("kinds.manual"), onSelect: addManual, disabled: hasManual },
  ];

  return (
    <>
      <SourceMenu trigger="add" label={t("add")} items={items} triggerRef={trigger} />
      <SourceDialog
        {...setup}
        open={adding !== null}
        onOpenChange={(next) => {
          if (!next) setAdding(null);
        }}
        source={last}
        finalFocus={trigger}
      />
    </>
  );
}

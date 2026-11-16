"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import type { CommandResult } from "./commands";
import { type ManualCategoryOption, ManualTransactionDialog } from "./manual-dialog";
import type { ManualCommands, ShownRange } from "./manual-types";
import type { LabelOption, RowView } from "./view";

/** What the Expenses components ask of the manual movement: its dialogs, and the row writes. */
interface ManualMovementApi {
  openCreate(): void;
  openEdit(row: RowView): void;
  openDelete(row: RowView): void;
  /** "Retry sending", where the page offers it: `null` otherwise. */
  retrySend: ((row: RowView) => void) | null;
  visibility(ids: readonly string[], change: "hide" | "restore" | "delete"): Promise<CommandResult>;
}

const ManualMovementContext = createContext<ManualMovementApi | null>(null);

/** `null` where no page set the manual movement up: the rows then behave as they did before it. */
export function useManualMovement(): ManualMovementApi | null {
  return useContext(ManualMovementContext);
}

/** The last day of the month `on` falls in, as a civil date. */
function monthEnd(on: string): string {
  const [year, month] = on.split("-").map(Number);
  return `${on.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * The manual movement of the Expenses screen (ux/n3-categories-manual.md §9): one dialog to write
 * and to change, the confirmation before a deletion, and the toasts that say what happened. The
 * button, the table and the empty state open it through {@link useManualMovement}; `openOnMount`
 * is the palette's command, which arrives as an address.
 */
export function ManualMovement({
  commands,
  categories,
  labels,
  shown,
  openOnMount = false,
  path = "/expenses",
  children,
}: {
  commands: ManualCommands;
  categories: readonly ManualCategoryOption[];
  labels: readonly LabelOption[];
  shown: ShownRange;
  openOnMount?: boolean;
  path?: string;
  children: ReactNode;
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  /** The open dialog: the row it changes (`null` to write), and the key of this opening. */
  const [dialog, setDialog] = useState<{ row: RowView | null; key: string } | null>(() =>
    // The palette's command: the page arrives with the dialog already open.
    openOnMount ? { row: null, key: crypto.randomUUID() } : null,
  );
  const [deleting, setDeleting] = useState<RowView | null>(null);
  const [pending, startTransition] = useTransition();
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((row: RowView | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A new key for each opening: the same key sent twice is one movement, never two openings.
    setDialog({ row, key: crypto.randomUUID() });
  }, []);

  useEffect(() => {
    // The address said "add" once: a reload must not open the dialog again.
    if (openOnMount) router.replace(path as Route);
  }, [openOnMount, router, path]);

  const api = useMemo<ManualMovementApi>(
    () => ({
      openCreate: () => open(null),
      openEdit: (row) => open(row),
      openDelete: (row) => setDeleting(row),
      retrySend: commands.retrySend
        ? (row) => {
            const retry = commands.retrySend;
            if (!retry) return;
            startTransition(async () => {
              try {
                // A movement that went leaves its badges; one that did not keeps "Not sent": the
                // row says it, and the state of the connection is in Settings (ux §9.8).
                const result = await retry(row.id);
                if (!result.ok) notify(t("errors.failed"), "error");
              } catch {
                notify(t("errors.failed"), "error");
              }
            });
          }
        : null,
      visibility: (ids, change) => commands.visibility([...ids], change),
    }),
    [open, commands, t],
  );

  function inView(on: string, accountId: string): boolean {
    if (shown.narrowed || on < shown.from || on > shown.to) return false;
    return shown.accountIds.length === 0 || shown.accountIds.includes(accountId);
  }

  return (
    <ManualMovementContext.Provider value={api}>
      {children}
      {dialog !== null && (
        <ManualTransactionDialog
          key={dialog.key}
          row={dialog.row}
          idempotencyKey={dialog.key}
          commands={commands}
          categories={categories}
          labels={labels}
          finalFocus={opener}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            const changed = dialog.row !== null;
            setDialog(null);
            if (changed) {
              notify(t("manual.toasts.saved"));
            } else if (inView(result.on, result.accountId)) {
              notify(t("manual.toasts.added"));
            } else {
              notify(t("manual.toasts.addedElsewhere", { date: result.date }), "success", {
                label: t("manual.toasts.show"),
                onClick: () =>
                  router.push(`${path}?from=${result.on.slice(0, 7)}-01&to=${monthEnd(result.on)}` as Route),
              });
            }
          }}
        />
      )}
      <Modal
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t("manual.delete.title")}
        description={deleting ? t("manual.delete.description", { date: deleting.date }) : undefined}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{t("row.cancel")}</Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const row = deleting;
                setDeleting(null);
                if (!row) return;
                startTransition(async () => {
                  try {
                    const result = await commands.remove(row.id);
                    notify(
                      result.ok ? t("toasts.deleted", { count: result.count }) : t("errors.failed"),
                      result.ok ? "success" : "error",
                    );
                  } catch {
                    notify(t("errors.failed"), "error");
                  }
                });
              }}
            >
              {t("selection.delete")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </ManualMovementContext.Provider>
  );
}

/** "Add transaction", wherever the page puts it: in the header, or in the empty state. */
export function AddMovementButton({ short = false }: { short?: boolean }) {
  const t = useTranslations("expenses");
  const manual = useManualMovement();
  if (manual === null) return null;
  return (
    <Button variant="primary" onClick={manual.openCreate} aria-label={t("manual.add")}>
      {short ? (
        <>
          <span className="sm:hidden">{t("manual.addShort")}</span>
          <span className="max-sm:hidden">{t("manual.add")}</span>
        </>
      ) : (
        t("manual.add")
      )}
    </Button>
  );
}

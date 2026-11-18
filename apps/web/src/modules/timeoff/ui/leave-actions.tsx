"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { useLeaveBoard } from "./leave-board";

/** The year's allowance as the dialog shows it, in the units a contract states. */
export interface AllowanceSummary {
  year: number;
  vacationDays: string;
  rolDays: string;
  /** Vacation and ROL together, in days, as the contract states it (N7). */
  totalDays: string;
  note: string;
}

/* The buttons the page places */

/** "Add leave" — in the header in every state of the page, and in the empty state. */
export function AddLeave({ label, className }: { label: string; className?: string }) {
  const board = useLeaveBoard();
  return (
    <Button
      variant="primary"
      icon={<Plus aria-hidden className="size-4" />}
      className={cn("max-md:h-9", className)}
      onClick={board.openAdd}
    >
      {label}
    </Button>
  );
}

/** One table row's Edit and Remove: the same panel, and the same removal with its "Undo". */
export function RowActions({ id, on }: { id: string; on: string }) {
  const t = useTranslations("timeoff");
  const board = useLeaveBoard();
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="xs" onClick={() => board.openEdit(on, id)} disabled={board.busy}>
        {t("actions.edit")}
      </Button>
      <Button size="xs" variant="danger" onClick={() => board.remove({ id })} disabled={board.busy}>
        {t("actions.remove")}
      </Button>
    </div>
  );
}

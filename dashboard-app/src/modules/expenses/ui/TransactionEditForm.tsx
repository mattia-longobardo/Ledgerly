"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateTransactionAction } from "@/app/actions/expenses";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { TransactionRow } from "./load-transactions";

export interface TransactionEditFormProps {
  row: TransactionRow;
  categories: readonly { id: string; name: string }[];
}

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

/** Category and note only — the two fields `updateTransaction` (Task 9) accepts from this page. */
export function TransactionEditForm({ row, categories }: TransactionEditFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        formData.set("id", row.id);
        formData.set("version", String(row.version));
        setError(null);
        startTransition(async () => {
          const result = await updateTransactionAction(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      {error !== null && <ErrorInline message={error} />}

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Category</span>
        <select name="categoryId" defaultValue={row.categoryId ?? ""} className={FIELD}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Note</span>
        <input name="note" defaultValue={row.note ?? ""} className={FIELD} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
      >
        Save
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPayslipAction } from "@/app/actions/payroll";

/**
 * The whole upload UI: one file input and one button. Validation is deliberately
 * *not* duplicated here — `uploadPayslipAction` calls `validateUpload`, the same
 * gate the API uses, so the browser and an API client are told the same thing
 * for the same reason. `accept` is a convenience for the file picker, never a
 * check (spec §8.3: the bytes have the last word).
 */
export function UploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await uploadPayslipAction(form);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-2 text-body-sm text-fg-muted">
        Payslip PDF
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-body-sm text-fg"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Upload payslip"}
      </button>
      {error && <p className="text-body-sm text-negative">{error}</p>}
    </form>
  );
}

"use client";

// The answer of a write in a form (audit UI-DS-9): nothing, or the refusal in the person's words,
// which `FormDialog` shows on its error line. The words come from the caller's catalogue: `packages/ui`
// knows no messages.
import { useState } from "react";

type MutationResult = { ok: true } | { ok: false; error: string };

export function useMutationResult(messageOf: (code: string) => string) {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    /** True when the write went through; otherwise the refusal is shown and false. */
    report: (result: MutationResult): boolean => {
      if (result.ok) return true;
      setError(messageOf(result.error));
      return false;
    },
  };
}

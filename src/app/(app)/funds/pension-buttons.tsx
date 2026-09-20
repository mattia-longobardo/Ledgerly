"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { notify } from "@/ui/toast";
import { type ActionResult, rebuildCompetencesAction } from "./pension-setup";

function useResult() {
  const t = useTranslations("funds.pension");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    setError,
    ok(result: ActionResult): boolean {
      if (result.ok) {
        setError(null);
        return true;
      }
      setError(
        t(`errors.${result.error === "duplicate_name" ? "duplicate_name" : "failed"}` as "errors.failed"),
      );
      return false;
    },
  };
}

/** Settings › "Rebuild from payslips" (plan F6 §3.4.2). */
export function RebuildCompetencesButton({ fundId, label }: { fundId: string; label: string }) {
  const t = useTranslations("funds.pension.settings");
  const router = useRouter();
  const { error, ok } = useResult();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await rebuildCompetencesAction(fundId);
            if (!ok(result)) return;
            notify(t("rebuilt", { count: result.ok ? (result.count ?? 0) : 0 }));
            router.refresh();
          })
        }
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-neg">
          {error}
        </span>
      )}
    </span>
  );
}

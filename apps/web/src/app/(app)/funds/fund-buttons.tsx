"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { notify } from "@ledgerly/ui/toast";
import { rebuildCompetencesAction } from "./fund-setup";

/** Settings › Contributions › "Rebuild from payslips": the payslip source's competences, read again. */
export function RebuildCompetencesButton({ fundId, label }: { fundId: string; label: string }) {
  const t = useTranslations("funds");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await rebuildCompetencesAction(fundId);
            if (!result.ok) {
              setError(t(result.error === "archived" ? "errors.archived" : "errors.failed"));
              return;
            }
            setError(null);
            notify(t("sources.rebuilt", { count: result.count ?? 0 }));
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

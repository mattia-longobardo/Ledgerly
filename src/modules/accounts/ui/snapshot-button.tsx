"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { notify } from "@/ui/toast";
import { runSnapshotNowAction } from "../actions";

/** Settings › Data: runs the caller's own monthly snapshot at once (spec §10.3). */
export function SnapshotButton() {
  const t = useTranslations("settings.snapshots");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    startTransition(async () => {
      try {
        const result = await runSnapshotNowAction();
        if (!result.ok) {
          setError(t("failed"));
          return;
        }
        setError(null);
        notify(t("taken"));
      } catch {
        setError(t("failed"));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={onClick} disabled={pending}>
        {t("takeNow")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
    </div>
  );
}

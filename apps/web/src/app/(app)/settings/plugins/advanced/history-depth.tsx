"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Select } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { useRunConnection } from "../connection-row";

/**
 * How far back a connection's history goes, and "Download again" (spec §9.1, F2.5), for a provider
 * that reads a chosen number of months. It only imports, which is what makes it safe to offer as
 * a plain button: it never removes a movement.
 */
export function HistoryDepth({
  connectionId,
  months: initial,
  choices,
}: {
  connectionId: string;
  months: number;
  choices: readonly number[];
}) {
  const t = useTranslations("settings.connections");
  const router = useRouter();
  const run = useRunConnection();
  const id = useId();
  const [months, setMonths] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download() {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await run(connectionId, "history", months);
        if (!result.ok) {
          setFailure(result.message);
          return;
        }
        if (result.toast !== null) notify(result.toast);
        router.refresh();
      } catch {
        setFailure(t("codes.network"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={id} className="text-muted">
          {t("advanced.history.label")}
        </label>
        <Select
          id={id}
          value={String(months)}
          onChange={(event) => setMonths(Number(event.currentTarget.value))}
          className="w-auto"
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {t("advanced.history.months", { count: choice })}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={pending} onClick={download}>
          {t("advanced.history.action")}
        </Button>
        <span className="text-muted">{t("advanced.history.hint")}</span>
      </div>
      {failure !== null && (
        <p role="alert" className="text-neg">
          {failure}
        </p>
      )}
    </div>
  );
}

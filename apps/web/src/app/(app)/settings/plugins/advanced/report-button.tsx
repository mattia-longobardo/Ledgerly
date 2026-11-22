"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@ledgerly/ui/button";
import { Textarea } from "@ledgerly/ui/input";

/**
 * "Copy report" (ux/n2-connection-status.md §8.4): the report of the current filter, built on the
 * server from a closed list of fields, goes to the clipboard. Where the clipboard is not there,
 * the report is shown to be selected and copied by hand.
 */
export function ReportButton({ report }: { report: string }) {
  const t = useTranslations("settings.connections.advanced.report");
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    setState("busy");
    try {
      await navigator.clipboard.writeText(report);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div>
        <Button size="sm" disabled={state === "busy"} onClick={copy}>
          <span aria-live="polite">{state === "copied" ? t("copied") : t("copy")}</span>
        </Button>
      </div>
      {state === "failed" && (
        <>
          <p role="alert" className="text-sm text-neg">
            {t("failed")}
          </p>
          <Textarea
            readOnly
            rows={8}
            value={report}
            aria-label={t("label")}
            className="font-mono text-sm"
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      )}
    </div>
  );
}

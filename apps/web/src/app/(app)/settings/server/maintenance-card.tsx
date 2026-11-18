"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { notify } from "@/ui/toast";
import { backupNowAction, runJobAction } from "./actions";

export interface MaintenanceProps {
  /** Everything already formatted for the reader; null when it has never happened. */
  lastBackup: { at: string; size: string } | null;
  lastExport: { at: string; users: number; size: string } | null;
  schedule: string;
  retention: string;
  version: string;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

/** Admin › Server › Maintenance (design rows 886–891). */
export function MaintenanceCard({ lastBackup, lastExport, schedule, retention, version }: MaintenanceProps) {
  const t = useTranslations("settings.maintenance");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"backup" | "export" | null>(null);

  function onBackup() {
    setRunning("backup");
    startTransition(async () => {
      const result = await backupNowAction();
      setRunning(null);
      notify(result.ok ? t("backupDone") : t(`errors.${result.error}`), result.ok ? "success" : "error");
      router.refresh();
    });
  }

  function onExport() {
    setRunning("export");
    startTransition(async () => {
      const result = await runJobAction("export-all");
      setRunning(null);
      notify(result.ok ? t("exportStarted") : t("errors.failed"), result.ok ? "success" : "error");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col">
      <Row label={t("lastBackup")}>
        {lastBackup ? t("backupDetail", { at: lastBackup.at, size: lastBackup.size }) : t("never")}
      </Row>
      <Row label={t("schedule")}>{schedule}</Row>
      <Row label={t("retention")}>{retention}</Row>
      <Row label={t("lastExport")}>
        {lastExport
          ? t("exportDetail", { at: lastExport.at, users: lastExport.users, size: lastExport.size })
          : t("never")}
      </Row>
      <Row label={t("version")}>{version}</Row>
      <div className="flex flex-wrap gap-2 pt-3">
        <Button size="sm" disabled={pending} onClick={onBackup}>
          {running === "backup" ? t("backupRunning") : t("backupNow")}
        </Button>
        <Button size="sm" disabled={pending} onClick={onExport}>
          {running === "export" ? t("exportRunning") : t("exportAll")}
        </Button>
      </div>
    </div>
  );
}

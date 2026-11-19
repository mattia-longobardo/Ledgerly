"use client";

import { DataTable } from "@ledgerly/ui/data-table";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import type { Tier } from "@/platform/jobs/registry";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { notify } from "@ledgerly/ui/toast";
import { runJobAction } from "./calls";

interface JobRow {
  name: string;
  tier: Tier;
  /** Already formatted for the reader; null when it has never run. */
  lastRun: string | null;
  status: "running" | "success" | "failed" | "skipped" | null;
  error: string | null;
}

const TONE = { running: "accent", success: "pos", failed: "neg", skipped: "neutral" } as const;

/**
 * Admin › Server › Scheduled jobs (spec §10.3): every registered job, when it last ran, and "Run
 * now". Spec §7.10 put it on Integrations; the owner moved it here in PERS-158, because a job belongs
 * to the instance and not to one person's connections.
 */
export function JobsCard({ jobs }: { jobs: JobRow[] }) {
  const t = useTranslations("settings.jobs");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onRun(job: JobRow) {
    startTransition(async () => {
      const result = await runJobAction(job.name);
      notify(result.ok ? t("started", { job: job.name }) : t("failed"), result.ok ? "success" : "error");
      // The job was only *started*: this table tells the rest of the story on the next render.
      router.refresh();
    });
  }

  /** The state of the last run, and its error beside it when it failed. */
  const result = (job: (typeof jobs)[number]) =>
    job.status ? (
      <span className="flex items-center gap-2">
        <Badge tone={TONE[job.status]}>{t(`states.${job.status}`)}</Badge>
        {job.error && (
          <span className="max-w-60 truncate text-sm text-muted" title={job.error}>
            {job.error}
          </span>
        )}
      </span>
    ) : null;

  return (
    <>
      <DataTable
        rows={jobs}
        rowKey={(job) => job.name}
        rowClassName="h-9"
        columns={[
          {
            key: "job",
            header: t("columns.job"),
            cell: (job) => job.name,
            className: "font-mono text-sm",
            card: "title",
          },
          {
            key: "tier",
            header: t("columns.tier"),
            cell: (job) => t(`tiers.${job.tier}`),
            muted: true,
            className: "text-sm",
            card: "labelled",
          },
          {
            key: "lastRun",
            header: t("columns.lastRun"),
            cell: (job) => job.lastRun ?? t("never"),
            muted: true,
            className: "text-sm",
            card: "labelled",
          },
          { key: "result", header: t("columns.result"), cell: result },
          {
            key: "actions",
            header: t("columns.actions"),
            hiddenHeader: true,
            align: "right",
            card: "action",
            cell: (job) => (
              <Button size="xs" disabled={pending} onClick={() => onRun(job)}>
                {t("runNow")}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}

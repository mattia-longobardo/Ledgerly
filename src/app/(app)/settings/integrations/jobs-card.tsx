"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import type { Tier } from "@/platform/jobs/registry";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { runJobAction } from "../server/actions";

export interface JobRow {
  name: string;
  tier: Tier;
  /** Already formatted for the reader; null when it has never run. */
  lastRun: string | null;
  status: "running" | "success" | "failed" | "skipped" | null;
  error: string | null;
}

const TONE = { running: "accent", success: "pos", failed: "neg", skipped: "neutral" } as const;

/**
 * Settings › Integrations › Scheduled jobs (spec §7.10, §10.3): every registered job, when it last
 * ran, and "Run now" for an admin.
 *
 * It lives here rather than in Admin › Server because §7.10 puts it here, beside the sync log it
 * belongs with — the plan proposed the other page, the spec decides.
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

  return (
    <>
      {/* Five columns and a button do not fit a phone: below `md` the same jobs are a list, with
          the very same "Run now" beside each one (plan F9 §3.3). */}
      <div className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            <Th>{t("columns.job")}</Th>
            <Th>{t("columns.tier")}</Th>
            <Th>{t("columns.lastRun")}</Th>
            <Th>{t("columns.result")}</Th>
            <Th align="right">
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {jobs.map((job) => (
              <Tr key={job.name} className="h-9">
                <Td className="font-mono text-sm">{job.name}</Td>
                <Td muted className="text-sm">
                  {t(`tiers.${job.tier}`)}
                </Td>
                <Td muted className="text-sm">
                  {job.lastRun ?? t("never")}
                </Td>
                <Td>
                  {job.status ? (
                    <span className="flex items-center gap-2">
                      <Badge tone={TONE[job.status]}>{t(`states.${job.status}`)}</Badge>
                      {job.error && (
                        <span className="max-w-60 truncate text-sm text-muted" title={job.error}>
                          {job.error}
                        </span>
                      )}
                    </span>
                  ) : null}
                </Td>
                <Td align="right">
                  <Button size="xs" disabled={pending} onClick={() => onRun(job)}>
                    {t("runNow")}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col md:hidden">
        {jobs.map((job) => (
          <li key={job.name} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-mono text-sm break-all">{job.name}</span>
              {job.status && <Badge tone={TONE[job.status]}>{t(`states.${job.status}`)}</Badge>}
            </div>
            <span className="text-sm text-muted">
              {t(`tiers.${job.tier}`)} · {job.lastRun ?? t("never")}
            </span>
            {job.error && <span className="text-sm break-words text-muted">{job.error}</span>}
            <div>
              <Button size="xs" disabled={pending} onClick={() => onRun(job)}>
                {t("runNow")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

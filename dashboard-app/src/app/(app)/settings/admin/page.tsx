import { notFound } from "next/navigation";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import type { JobName } from "@/lib/contracts";
import { db } from "@/lib/db";
import { formatMonth } from "@/lib/format";
import { llmConfigStatus } from "@/lib/payroll/llm-config";
import { lastSuccess, recentRuns } from "@/lib/repo/jobs";
import { monthKey } from "@/lib/time";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { LlmForm } from "../_components/SettingsForms";
import { loadUsers } from "../_lib/load-settings";
import { interestAccrualNotice } from "./interest-accrual-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };

const COLUMN = "flex flex-col gap-10";

const JOBS: readonly JobName[] = [
  "monthly_close",
  "sweep",
  "wallet_refresh",
  "wallet_accounts_sync",
  "wallet_transactions_sync",
  "interest_accrual",
  "trek_sync",
  "sync_queue",
];

const JOB_LABEL: Record<string, string> = {
  monthly_close: "Monthly close",
  sweep: "Sweep",
  wallet_refresh: "Wallet refresh",
  wallet_accounts_sync: "Wallet accounts sync",
  wallet_transactions_sync: "Wallet transactions sync",
  interest_accrual: "Interest accrual",
  trek_sync: "Trek leave sync",
  sync_queue: "Webhook sync queue",
};

const STATUS_TONE: Record<string, string> = {
  success: "text-positive",
  success_after_retry: "text-positive",
  already_done: "text-fg-muted",
  running: "text-fg-muted",
  failed: "text-negative",
  poisoned: "text-negative",
  missed: "text-warning",
};

const RUN_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const USER_JOINED = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Rome",
});

export default async function AdminSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  // `notFound`, not a 403: a member must not learn the page exists.
  if (!principal.permissions.has("admin.users")) notFound();

  const now = monthKey(new Date());
  const [users, runs, successes, llm] = await Promise.all([
    loadUsers(db, principal),
    recentRuns(undefined, 20),
    Promise.all(JOBS.map((job) => lastSuccess(job))),
    // Status only — `llmConfigStatus()` carries no key value, so the secret is
    // never serialised into this server component's HTML.
    llmConfigStatus(),
  ]);

  return (
    <>
      <PageHeader title="Administration" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="People and configuration" bodyClassName={COLUMN}>
          <SettingsSection
            title="Users"
            footnote="Read-only in this release. Invitations, role changes and suspension arrive with the security phase."
          >
            <ul className="hairline-t">
              {users.map((user) => (
                <li key={user.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">{user.displayName}</span>
                    <span className="block truncate text-caption text-fg-muted">
                      {user.email ?? "No email"} · {user.roles.join(", ") || "no roles"}
                    </span>
                  </span>
                  <span className="num shrink-0 text-caption text-fg-muted">
                    {user.status} · {USER_JOINED.format(user.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </SettingsSection>

          <SettingsSection
            title="Payslip AI"
            description="An OpenAI-compatible model reads each payslip alongside the deterministic rules; the two are cross-checked and disagreements are flagged for you."
            footnote={
              llm.disabledReason ??
              "Values set here override OPENAI_API_KEY, OPENAI_BASE_URL and LLM_MODEL from the environment."
            }
          >
            <LlmForm
              baseUrl={llm.baseUrl}
              model={llm.model}
              hasKey={llm.hasKey}
              keySource={llm.keySource}
              hasStoredKey={llm.hasStoredKey}
            />
          </SettingsSection>
        </Panel>

        <Panel span={6} ariaLabel="Operations" bodyClassName={COLUMN}>
          <SettingsSection title="Scheduled jobs">
            <ul className="hairline-t">
              {JOBS.map((job, index) => {
                const run = successes[index] ?? null;
                const notice = job === "interest_accrual" ? interestAccrualNotice(run?.detail) : null;
                return (
                  <li key={job} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">{JOB_LABEL[job] ?? job}</span>
                      {notice !== null && (
                        <span className="block truncate text-caption text-warning">{notice}</span>
                      )}
                    </span>
                    <StaleBadge capturedAt={run?.startedAt ?? null} stale={run === null} />
                  </li>
                );
              })}
            </ul>
          </SettingsSection>

          <SettingsSection
            title="Recent runs"
            footnote={<>Current month: <span className="num">{formatMonth(now)}</span>.</>}
          >
            {runs.length === 0 ? (
              <EmptyState
                title="Cron has never fired"
                description="No job has run yet. Either the sidecar is not up, or it cannot reach the app on the internal network."
              />
            ) : (
              <ul className="hairline-t">
                {runs.map((run) => (
                  <li key={run.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">
                        {JOB_LABEL[run.jobName] ?? run.jobName}
                      </span>
                      <span className="num block truncate text-caption text-fg-muted">
                        {RUN_TIME.format(run.startedAt)} · {run.trigger}
                        {run.attempt > 1 && ` · attempt ${run.attempt}`}
                      </span>
                      {run.error !== null && (
                        <span title={run.error} className="block truncate text-caption text-fg-muted">
                          {run.error}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "num shrink-0 text-caption whitespace-nowrap",
                        STATUS_TONE[run.status] ?? "text-fg-muted",
                      )}
                    >
                      {run.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

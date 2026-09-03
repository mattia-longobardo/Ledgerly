import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import { effectiveRate } from "@/lib/calc/vacation-fund";
import type { JobName } from "@/lib/contracts";
import { formatMonth } from "@/lib/format";
import { llmConfigStatus } from "@/lib/payroll/llm-config";
import { listFunds } from "@/lib/repo/funds";
import { lastSuccess, recentRuns } from "@/lib/repo/jobs";
import { SETTING_KEYS, getSetting } from "@/lib/repo/settings";
import { balance as ledgerBalance, ledger, rates } from "@/lib/repo/vacation";
import { monthKey } from "@/lib/time";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { DEFAULT_HOURS_PER_DAY } from "../_lib/vacation";
import {
  ClearPoisonedButton,
  HoursPerDayForm,
  LlmForm,
  RunSnapshotButton,
  VacationSetupForm,
} from "./_components/SettingsForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const JOBS: readonly JobName[] = [
  "monthly_snapshot",
  "payslip_ingest",
  "sweep",
  "wallet_refresh",
  "trek_sync",
];

const JOB_LABEL: Record<string, string> = {
  monthly_snapshot: "Monthly snapshot",
  payslip_ingest: "Payslip ingest",
  sweep: "Sweep",
  wallet_refresh: "Wallet refresh",
  trek_sync: "Trek leave sync",
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

/** The rhythm between settings blocks. Applied to the panel BODY. */
const COLUMN = "flex flex-col gap-10";

export default async function SettingsPage() {
  await requireUserOrRedirect("/settings");

  const now = monthKey(new Date());
  const [funds, runs, successes, rateRows, entries, balance, hoursRaw, llm] =
    await Promise.all([
      listFunds(),
      recentRuns(undefined, 20),
      Promise.all(JOBS.map((job) => lastSuccess(job))),
      rates(),
      ledger(),
      ledgerBalance(),
      getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY),
      // Status only — `llmConfigStatus()` deliberately carries no key value, so
      // the secret is never serialised into this server component's HTML.
      llmConfigStatus(),
    ]);

  const parsedHours = Number(hoursRaw);
  const hoursPerDay =
    Number.isFinite(parsedHours) && parsedHours > 0
      ? parsedHours
      : DEFAULT_HOURS_PER_DAY;

  const rate = effectiveRate(rateRows, now);
  const hasInitialValue = entries.some((e) => e.entryType === "initial");

  return (
    <>
      <PageHeader
        title="Settings"
        eyebrow={
          <Link
            href="/"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            &larr; Home
          </Link>
        }
      />

      {/*
        One flat column on mobile. From `lg:` up, two: what you configure on
        the left, what the machine does on the right — the operational pair
        (jobs + their run log) reads together, and the run list is the one
        section long enough to balance the short forms.
      */}
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Configuration" bodyClassName={COLUMN}>
          <SettingsSection title="Vacation fund">
            <VacationSetupForm
              monthlyAmount={
                rate === null ? "" : String(rate).replace(".", ",")
              }
              effectiveFrom={now.slice(0, 7)}
              hasInitialValue={hasInitialValue}
              currentMonth={now.slice(0, 7)}
              balance={balance}
            />
          </SettingsSection>

          <SettingsSection title="Leave">
            <HoursPerDayForm hoursPerDay={hoursPerDay} />
          </SettingsSection>

          <SettingsSection title="Funds">
            {funds.length === 0 ? (
              <p className="text-body-sm text-fg-muted">
                No funds registered. The seed migration has not run.
              </p>
            ) : (
              <ul className="hairline-t">
                {funds.map((fund) => (
                  <li key={fund.id}>
                    <Link
                      href={`/finance/funds/${fund.slug}`}
                      className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-fg">
                          {fund.name}
                        </span>
                        <span
                          title={fund.teableColumn}
                          className="num block truncate text-caption text-fg-muted"
                        >
                          Teable column “{fund.teableColumn}”
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="shrink-0 text-body-sm text-accent"
                      >
                        Settings &rarr;
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection
            title="Accounts"
            description="Manual and synced accounts, their groups, and archived accounts now live in Finance."
          >
            <Link
              href="/finance/management/accounts"
              className="inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Finance &rsaquo; Management &rarr;
            </Link>
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

          <SettingsSection title="Theme">
            {/* Block-level flex already fills the column; the cap stops a
                three-item control from spanning the whole desktop column. */}
            <ThemeToggle variant="segmented" className="max-w-xs" />
          </SettingsSection>
        </Panel>

        <Panel span={6} ariaLabel="Operations" bodyClassName={COLUMN}>
          <SettingsSection title="Scheduled jobs">
            <ul className="hairline-t">
              {JOBS.map((job, index) => {
                const run = successes[index] ?? null;
                return (
                  <li
                    key={job}
                    className="flex min-h-11 items-center gap-3 py-2 hairline-b"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-fg">
                      {JOB_LABEL[job] ?? job}
                    </span>
                    <StaleBadge
                      capturedAt={run?.startedAt ?? null}
                      stale={run === null}
                    />
                  </li>
                );
              })}
            </ul>

            <div className="mt-4">
              <RunSnapshotButton />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Recent runs"
            footnote={
              <>
                A poisoned month has stopped retrying on its own. Clearing it
                queues the cached values for the next sweep; it never re-reads
                the Wallet API. Current month:{" "}
                <span className="num">{formatMonth(now)}</span>.
              </>
            }
          >
            {runs.length === 0 ? (
              <EmptyState
                title="Cron has never fired"
                description="No job has run yet. Either the sidecar is not up, or it cannot reach the app on the internal network. “Run the snapshot now” above tests that path."
              />
            ) : (
              <ul className="hairline-t">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex min-h-11 items-center gap-3 py-2 hairline-b"
                  >
                    {/*
                      `run.error` is a free-form DB string with no length or
                      whitespace guarantee, so it gets its own truncated line
                      rather than trailing the meta line and pushing the row
                      past the viewport. The full text is on the title.
                    */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">
                        {JOB_LABEL[run.jobName] ?? run.jobName}
                      </span>
                      <span className="num block truncate text-caption text-fg-muted">
                        {RUN_TIME.format(run.startedAt)} · {run.trigger}
                        {run.attempt > 1 && ` · attempt ${run.attempt}`}
                      </span>
                      {run.error !== null && (
                        <span
                          title={run.error}
                          className="block truncate text-caption text-fg-muted"
                        >
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
                    {run.status === "poisoned" && run.dedupeKey !== null && (
                      <ClearPoisonedButton month={run.dedupeKey} />
                    )}
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

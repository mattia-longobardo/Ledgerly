import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { civilDateIn } from "@/platform/dates";
import { formatDate, NULL_DISPLAY } from "@/platform/format";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { listConnections, listRuns, readSyncJob, type SyncRun } from "@/platform/integrations/service";
import { backfillDepth } from "@/platform/integrations/wallet/depth";
import { Badge } from "@/ui/badge";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { WalletCard, type WalletCardState } from "./wallet-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.integrations")} · ${t("title")}` };
}

/** One page of history is enough here: the whole log is the service's `listRuns` default. */
const RUNS_LIMIT = 20;

/** The counts a run may report, in the order they read best. Absent keys are simply not shown. */
const COUNT_KEYS = [
  "created",
  "updated",
  "skipped",
  "removed",
  // The two-way category sync of F6 (`platform/integrations/wallet/categories.ts`), which rides
  // along with the movements pass: what it adopted from Wallet, what it wrote there, what it
  // created there, and how many categories it has something to say about.
  "categoriesAdded",
  "categoriesAdopted",
  "categoriesPushed",
  "categoriesCreated",
  "categoriesReported",
  "categoriesRetyped",
] as const;

const RUN_TONE = {
  running: "accent",
  success: "pos",
  failed: "neg",
  skipped: "neutral",
} as const;

/**
 * An instant as this page shows it: the civil day in the user's zone (spec §8.5) and the clock,
 * because an hourly sync is told apart by its time of day and `platform/format` has no date-time
 * style yet.
 */
function formatInstant(instant: Date, ctx: Ctx): string {
  const day = formatDate(civilDateIn(instant, ctx.timeZone), "long", ctx.locale);
  const clock = new Intl.DateTimeFormat(ctx.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ctx.timeZone,
  }).format(instant);
  return `${day}, ${clock}`;
}

/** How long a finished run took, to the second; `null` while it is still running. */
function durationSeconds(run: SyncRun): number | null {
  if (run.finishedAt === null) return null;
  return Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000));
}

/**
 * Settings › Integrations (spec §9.1 and §10.3): the Wallet link, and the log of what it did.
 *
 * The connection is read through `listConnections`, which cannot carry credentials — the sealed
 * column is only ever opened by `readCredentials`, and only inside a Server Action. Nothing on
 * this page knows the token, so nothing on this page can send it to the browser.
 *
 * The admin side of §10.3 — running any job by hand — is a separate card and not part of F2.
 */
export default async function SettingsIntegrationsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("settings.integrations");
  const [connections, runs] = await Promise.all([listConnections(ctx), listRuns(ctx, { limit: RUNS_LIMIT })]);

  const wallet = connections.find((connection) => connection.provider === WALLET_PROVIDER) ?? null;
  const state: WalletCardState = wallet?.state ?? "absent";
  const lastSync = wallet?.lastOkAt ? formatInstant(wallet.lastOkAt, ctx) : null;
  const job = wallet ? await readSyncJob(ctx, wallet.id, "transactions") : null;

  return (
    <SettingsGrid>
      <SettingsSection title={t("title")} description={t("description")} padded={false}>
        <WalletCard state={state} lastSync={lastSync} history={backfillDepth(job?.cursor)} />
      </SettingsSection>

      <SettingsSection title={t("runs.title")} description={t("runs.description")} padded={false}>
        {runs.length === 0 ? (
          <p className="p-4 text-muted">{t("runs.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{t("runs.started")}</Th>
                <Th>{t("runs.kind")}</Th>
                <Th>{t("runs.result")}</Th>
                <Th>{t("runs.counts")}</Th>
                <Th>{t("runs.detail")}</Th>
              </THead>
              <TBody>
                {runs.map((run) => {
                  const seconds = durationSeconds(run);
                  const counts = COUNT_KEYS.filter((key) => run.counts?.[key] !== undefined).map((key) =>
                    t(`counts.${key}`, { count: run.counts?.[key] ?? 0 }),
                  );
                  return (
                    <Tr key={run.id}>
                      <Td>{formatInstant(run.startedAt, ctx)}</Td>
                      <Td>{t(`kinds.${run.kind}`)}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <Badge tone={RUN_TONE[run.state]}>{t(`runStates.${run.state}`)}</Badge>
                          <span className="text-sm whitespace-nowrap text-muted">
                            {seconds === null ? t("runs.running") : t("runs.duration", { seconds })}
                          </span>
                        </span>
                      </Td>
                      <Td muted>{counts.length === 0 ? NULL_DISPLAY : counts.join(" · ")}</Td>
                      <Td muted className="max-w-80 truncate" title={run.error ?? undefined}>
                        {run.error ?? NULL_DISPLAY}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </SettingsSection>
    </SettingsGrid>
  );
}

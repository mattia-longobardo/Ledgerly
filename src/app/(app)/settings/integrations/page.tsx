import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { NULL_DISPLAY } from "@/platform/format";
import { PAPERLESS_PROVIDER, TREK_PROVIDER, WALLET_PROVIDER } from "@/platform/integrations/rules";
import {
  type Connection,
  listConnections,
  listRuns,
  readSyncJob,
  type SyncRun,
} from "@/platform/integrations/service";
import { backfillDepth } from "@/platform/integrations/wallet/depth";
import { providerOf } from "@/modules/investments/catalog";
import { listInvestmentAccounts } from "@/modules/investments/service";
import { pendingCount } from "@/modules/timeoff/service";
import { SyncNowButton } from "@/modules/investments/ui/dialogs";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { ConnectionRow } from "./connection-row";
import { formatInstant } from "./format-instant";
import { PaperlessCard, type PaperlessCardState } from "./paperless-card";
import { recommendedSchedule } from "./recommended-schedule";
import { ScheduleControl } from "./schedule-control";
import { TrekCard, type TrekCardState } from "./trek-card";
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

/** How long a finished run took, to the second; `null` while it is still running. */
function durationSeconds(run: SyncRun): number | null {
  if (run.finishedAt === null) return null;
  return Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000));
}

/**
 * Settings › Integrations (spec §9.1 and §7.10): every connection, in one kind of row, and the log
 * of what they did. The scheduled jobs moved to Admin › Server in PERS-158.
 *
 * The connection is read through `listConnections`, which cannot carry credentials — the sealed
 * column is only ever opened by `readCredentials`, and only inside a Server Action. Nothing on
 * this page knows the token, so nothing on this page can send it to the browser.
 */
export default async function SettingsIntegrationsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("settings.integrations");
  const [connections, runs] = await Promise.all([listConnections(ctx), listRuns(ctx, { limit: RUNS_LIMIT })]);

  const wallet = connections.find((connection) => connection.provider === WALLET_PROVIDER) ?? null;
  const state: WalletCardState = wallet?.state ?? "absent";
  const lastSync = wallet?.lastOkAt ? formatInstant(wallet.lastOkAt, ctx) : null;
  const job = wallet ? await readSyncJob(ctx, wallet.id, "transactions") : null;

  const connectionName = (provider: string) =>
    providerOf(provider)?.name ??
    t(
      provider === WALLET_PROVIDER
        ? "providers.wallet.name"
        : provider === TREK_PROVIDER
          ? "providers.trek.name"
          : "providers.paperless.name",
    );

  // The schedule control of a connection (D7); a provider with no link keeps the fixed label.
  const scheduleOf = (connection: Connection | null) =>
    connection && (
      <ScheduleControl
        provider={connection.provider}
        name={connectionName(connection.provider)}
        schedule={connection.schedule}
        recommended={recommendedSchedule(connection.provider)}
        next={connection.nextSyncAt ? formatInstant(connection.nextSyncAt, ctx) : null}
        timeZone={ctx.timeZone}
      />
    );

  const trek = connections.find((connection) => connection.provider === TREK_PROVIDER) ?? null;
  const trekState: TrekCardState = trek?.state ?? "absent";
  const trekLastSync = trek?.lastOkAt ? formatInstant(trek.lastOkAt, ctx) : null;
  const waiting = trek ? await pendingCount(ctx) : 0;

  const paperless = connections.find((connection) => connection.provider === PAPERLESS_PROVIDER) ?? null;
  const paperlessState: PaperlessCardState = paperless?.state ?? "absent";
  const paperlessLastSync = paperless?.lastOkAt ? formatInstant(paperless.lastOkAt, ctx) : null;

  // Investments (docs/design/investments.md §4.2): listed here with their schedule; the key, its
  // checks and the disconnection live on the service's page.
  const services = await listInvestmentAccounts(ctx);
  const invested = connections.flatMap((connection) => {
    const provider = providerOf(connection.provider);
    const service = services.find((one) => one.provider === connection.provider);
    return provider && provider.connect === "apikey" && service ? [{ connection, provider, service }] : [];
  });

  return (
    <SettingsGrid>
      <SettingsSection title={t("title")} description={t("description")} padded={false}>
        <WalletCard
          state={state}
          lastSync={lastSync}
          history={backfillDepth(job?.cursor)}
          schedule={scheduleOf(wallet)}
        />
        <div className="border-t border-border" />
        <TrekCard state={trekState} lastSync={trekLastSync} pending={waiting} schedule={scheduleOf(trek)} />
        <div className="border-t border-border" />
        <PaperlessCard state={paperlessState} lastSync={paperlessLastSync} schedule={scheduleOf(paperless)} />
      </SettingsSection>

      {invested.length > 0 && (
        <SettingsSection
          title={t("investments.title")}
          description={t("investments.description")}
          padded={false}
        >
          <ul className="flex flex-col">
            {invested.map(({ connection, provider, service }) => (
              <li
                key={connection.id}
                className="border-t border-border first:border-t-0"
                data-testid="investment-connection"
              >
                <ConnectionRow
                  name={provider.name}
                  role={t("investments.role")}
                  state={connection.state}
                  lastSync={connection.lastOkAt ? formatInstant(connection.lastOkAt, ctx) : null}
                  schedule={scheduleOf(connection)}
                  actions={
                    <>
                      <SyncNowButton accountId={service.accountId} size="sm" variant="secondary" />
                      <ButtonLink href={`/investments/${service.accountId}/connection` as Route} size="sm">
                        {t("actions.configure")}
                      </ButtonLink>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

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

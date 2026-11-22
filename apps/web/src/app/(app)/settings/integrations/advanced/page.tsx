import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import "@/app/plugin-wiring";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { NULL_DISPLAY } from "@ledgerly/format/format";
import { labelOf } from "@/platform/integrations/registry";
import { connectionReport, scheduleSummary } from "@/platform/integrations/report";
import { isPluginProvider } from "@ledgerly/domain/platform/integrations";
import {
  type Connection,
  listConnections,
  listRuns,
  recentRuns,
  SYNC_RUN_RETENTION_DAYS,
  type SyncRun,
} from "@ledgerly/domain/platform/integrations";
import { isSyncErrorCode } from "@ledgerly/domain/platform/integrations";
import { listUserPlugins } from "@ledgerly/domain/platform/plugins";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import { Badge } from "@ledgerly/ui/badge";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { Select } from "@ledgerly/ui/input";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { EmptyState } from "@ledgerly/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { RUNS_PER_CONNECTION, sourceSlugOf, statusOf } from "../connection-view";
import { formatInstant } from "@ledgerly/format/format";
import { ScheduleCell } from "../schedule-cell";
import { ReportButton } from "./report-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("connections.advanced.title")} · ${t("tabs.integrations")} · ${t("title")}` };
}

const DAY_MS = 86_400_000;
const PAGE = 50;
const MAX_ROWS = 200;
const INTEGRATIONS: Route = "/settings/integrations";

/** The counts a run may report, in the order they read best. Absent keys are simply not shown. */
const COUNT_KEYS = [
  "created",
  "updated",
  "skipped",
  "removed",
  "sent",
  "notSent",
  "categoriesAdded",
  "categoriesAdopted",
  "categoriesPushed",
  "categoriesCreated",
  "categoriesReported",
  "categoriesRetyped",
] as const;

const RUN_TONE = { running: "accent", success: "pos", failed: "neg", skipped: "neutral" } as const;

/** How long a finished run took, to the second; `null` while it is still running. */
function durationSeconds(run: SyncRun): number | null {
  if (run.finishedAt === null) return null;
  return Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000));
}

/** An instant with its seconds, in the person's zone: two runs of one pass start seconds apart. */
function withSeconds(instant: Date, ctx: Pick<Ctx, "locale" | "timeZone">): string {
  const seconds = String(instant.getUTCSeconds()).padStart(2, "0");
  return `${formatInstant(instant, ctx)}:${seconds}`;
}

/**
 * Settings › Integrations › Advanced (ux/n2-connection-status.md §8): when each connection is
 * updated by itself, and the log of every reading of the last 30 days. The technical words live
 * here and nowhere else in the normal view.
 *
 * Everything is read with the signed-in person's own scope: a `?c=` that is somebody else's
 * connection is a connection that does not exist, and the page answers 404. The page never
 * shows a credential, a key, an access or what a provider said: the old `error` column is not
 * read here at all.
 */
export default async function AdvancedPage({ searchParams }: PageProps<"/settings/integrations/advanced">) {
  const ctx = await requireSession();
  const t = await getTranslations("settings.connections");
  const old = await getTranslations("settings.integrations");
  const query = await searchParams;
  const now = new Date();
  const since = new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS);

  const wanted = Array.isArray(query.c) ? query.c[0] : query.c;
  const asked = Number(Array.isArray(query.n) ? query.n[0] : query.n);
  const limit = Number.isInteger(asked) && asked > PAGE ? Math.min(asked, MAX_ROWS) : PAGE;

  const [connections, plugins] = await Promise.all([listConnections(ctx), listUserPlugins(ctx)]);
  const selected =
    wanted === undefined || wanted === "" ? null : connections.find((one) => one.id === wanted);
  if (selected === undefined) notFound();

  if (connections.length === 0) {
    return (
      <EmptyState
        title={t("advanced.empty")}
        description={t("advanced.emptyHint")}
        actions={<ButtonLink href={INTEGRATIONS}>{t("advanced.back")}</ButtonLink>}
      />
    );
  }

  const labels = new Map(
    await Promise.all(connections.map(async (one) => [one.id, await labelOf(one, ctx.locale)] as const)),
  );
  const nameOf = (id: string) => labels.get(id)?.name ?? NULL_DISPLAY;
  const byName = [...connections].sort((a, b) =>
    nameOf(a.id).localeCompare(nameOf(b.id), ctx.locale, { sensitivity: "base" }),
  );
  /** Whether the person has the connection's provider on; a provider of the core always is. */
  const active = (connection: Connection) =>
    !isPluginProvider(connection.provider) ||
    plugins.some((plugin) => `plugin:${plugin.id}` === connection.provider && plugin.state === "active");

  const [runs, recent] = await Promise.all([
    // One more than the page: whether there are more to show.
    listRuns(ctx, { connectionId: selected?.id, since, limit: limit + 1 }),
    recentRuns(ctx, RUNS_PER_CONNECTION, since),
  ]);
  const shown = runs.slice(0, limit);

  // The investment services have no page of their own: their schedule stays here.
  const services = byName.filter((connection) => sourceSlugOf(connection.provider) === null);

  // The report of the current filter: a closed list of fields (`report.ts`).
  const report = connectionReport({
    appVersion: APP_VERSION,
    at: now,
    connections: (selected ? [selected] : byName).map((connection) => {
      const status = statusOf(
        {
          connection,
          runs: recent.filter((run) => run.connectionId === connection.id),
          providerActive: active(connection),
        },
        now,
      );
      return {
        name: nameOf(connection.id),
        provider: connection.provider,
        status: status.value,
        code: isSyncErrorCode(connection.errorCode) ? connection.errorCode : null,
        failures: connection.consecutiveFailures,
        lastOkAt: connection.lastOkAt,
        nextSyncAt: connection.nextSyncAt,
        schedule: scheduleSummary(connection.schedule),
      };
    }),
    runs: shown.map((run) => ({
      startedAt: run.startedAt,
      connection: nameOf(run.connectionId),
      kind: run.kind,
      origin: run.origin,
      state: run.state,
      seconds: durationSeconds(run),
      code: isSyncErrorCode(run.errorCode) ? run.errorCode : null,
      httpStatus: run.httpStatus,
      appVersion: run.appVersion,
    })),
  });

  const more = new URLSearchParams();
  if (selected) more.set("c", selected.id);
  more.set("n", String(Math.min(limit + PAGE, MAX_ROWS)));

  const origin = (run: SyncRun) =>
    run.origin === "auto"
      ? t("advanced.log.origin.auto")
      : run.origin === "manual"
        ? t("advanced.log.origin.manual")
        : NULL_DISPLAY;
  const counts = (run: SyncRun) => {
    const parts = COUNT_KEYS.filter((key) => run.counts?.[key] !== undefined).map((key) =>
      old(`counts.${key}`, { count: run.counts?.[key] ?? 0 }),
    );
    return parts.length === 0 ? NULL_DISPLAY : parts.join(" · ");
  };
  const result = (run: SyncRun) => {
    const seconds = durationSeconds(run);
    return (
      <span className="flex items-center gap-2">
        <Badge tone={RUN_TONE[run.state]}>{t(`advanced.log.states.${run.state}`)}</Badge>
        {seconds !== null && (
          <span className="text-sm whitespace-nowrap text-muted">
            {t("advanced.log.duration", { seconds })}
          </span>
        )}
      </span>
    );
  };
  const code = (run: SyncRun) => (isSyncErrorCode(run.errorCode) ? run.errorCode : NULL_DISPLAY);

  return (
    <SettingsGrid>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("advanced.title")}</h2>
          <ButtonLink href={INTEGRATIONS} size="sm">
            {t("advanced.back")}
          </ButtonLink>
        </div>
        <p className="text-sm text-muted">{t("advanced.intro")}</p>
      </div>

      {/* The services only: a source's schedule is on the source's page (plugin-settings.md §2.2). */}
      {services.length > 0 && (
        <SettingsSection
          title={t("advanced.schedule.title")}
          description={t("advanced.schedule.description")}
          padded={false}
        >
          <ul className="flex flex-col">
            {services.map((connection) => {
              const label = labels.get(connection.id);
              return (
                <li
                  key={connection.id}
                  className="border-t border-border first:border-t-0"
                  data-testid="schedule-row"
                >
                  <div className="flex flex-col gap-x-5 gap-y-1.5 px-4 py-3.5 md:flex-row md:items-start md:justify-between">
                    <span className="min-w-0 font-semibold break-words">{label?.name}</span>
                    <div className="min-w-0 text-sm md:text-right">
                      <ScheduleCell
                        connection={connection}
                        name={label?.name ?? ""}
                        provider={label?.provider ?? ""}
                        active={active(connection)}
                        ctx={ctx}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      )}

      {/* The filter is a navigation that lands here: the reader goes on from the log (§12). */}
      <div id="log" tabIndex={-1} className="focus:outline-none">
        <SettingsSection
          title={t("advanced.log.title")}
          description={t("advanced.log.description")}
          action={<ReportButton report={report} />}
          padded={false}
        >
          <form
            method="get"
            action="#log"
            className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3"
          >
            <label htmlFor="log-connection" className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {t("advanced.log.filter")}
              <Select
                id="log-connection"
                name="c"
                defaultValue={selected?.id ?? ""}
                className="w-auto max-w-full"
              >
                <option value="">{t("advanced.log.all")}</option>
                {byName.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {nameOf(connection.id)}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="sm">
              {t("advanced.log.apply")}
            </Button>
          </form>

          {shown.length === 0 ? (
            <p className="p-4 text-muted">
              {selected ? t("advanced.log.emptyFor", { name: nameOf(selected.id) }) : t("advanced.log.empty")}
            </p>
          ) : (
            <>
              {/* Nine columns do not fit a phone: below `md` the same readings are a list. */}
              <div className="overflow-x-auto max-md:hidden">
                <Table>
                  <caption className="sr-only">{t("advanced.log.caption")}</caption>
                  <THead>
                    <Th>{t("advanced.log.columns.started")}</Th>
                    <Th>{t("advanced.log.columns.connection")}</Th>
                    <Th>{t("advanced.log.columns.data")}</Th>
                    <Th>{t("advanced.log.columns.origin")}</Th>
                    <Th>{t("advanced.log.columns.result")}</Th>
                    <Th>{t("advanced.log.columns.code")}</Th>
                    <Th>{t("advanced.log.columns.http")}</Th>
                    <Th>{t("advanced.log.columns.counts")}</Th>
                    <Th>{t("advanced.log.columns.version")}</Th>
                  </THead>
                  <TBody>
                    {shown.map((run) => (
                      <Tr key={run.id}>
                        <Td className="whitespace-nowrap">{withSeconds(run.startedAt, ctx)}</Td>
                        <Td>{nameOf(run.connectionId)}</Td>
                        <Td>{old(`kinds.${run.kind}`)}</Td>
                        <Td muted>{origin(run)}</Td>
                        <Td>{result(run)}</Td>
                        <Td className="font-mono text-sm">{code(run)}</Td>
                        <Td muted>{run.httpStatus ?? NULL_DISPLAY}</Td>
                        <Td muted>{counts(run)}</Td>
                        <Td muted className="whitespace-nowrap">
                          {run.appVersion ?? NULL_DISPLAY}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="flex flex-col md:hidden" aria-label={t("advanced.log.caption")}>
                {shown.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-col gap-1 border-b border-border px-4 py-3 text-sm last:border-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{withSeconds(run.startedAt, ctx)}</span>
                      {result(run)}
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-muted">
                      <dt>{t("advanced.log.columns.connection")}:</dt>
                      <dd className="break-words text-fg">{nameOf(run.connectionId)}</dd>
                      <dt>{t("advanced.log.columns.data")}:</dt>
                      <dd className="text-fg">{old(`kinds.${run.kind}`)}</dd>
                      <dt>{t("advanced.log.columns.origin")}:</dt>
                      <dd>{origin(run)}</dd>
                      <dt>{t("advanced.log.columns.code")}:</dt>
                      <dd className="font-mono break-all">{code(run)}</dd>
                      <dt>{t("advanced.log.columns.http")}:</dt>
                      <dd>{run.httpStatus ?? NULL_DISPLAY}</dd>
                      <dt>{t("advanced.log.columns.counts")}:</dt>
                      <dd className="break-words">{counts(run)}</dd>
                      <dt>{t("advanced.log.columns.version")}:</dt>
                      <dd>{run.appVersion ?? NULL_DISPLAY}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
              {runs.length > limit && limit < MAX_ROWS && (
                <div className="flex justify-center border-t border-border px-4 py-3">
                  <ButtonLink href={`/settings/integrations/advanced?${more.toString()}` as Route} size="sm">
                    {t("advanced.log.more")}
                  </ButtonLink>
                </div>
              )}
            </>
          )}
        </SettingsSection>
      </div>
    </SettingsGrid>
  );
}

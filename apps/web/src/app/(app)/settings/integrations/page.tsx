import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate } from "@ledgerly/domain/platform/format";
import { labelOf, passFor } from "@/platform/integrations/registry";
import { TREK_PROVIDER, WALLET_PROVIDER } from "@ledgerly/domain/platform/integrations";
import {
  type Connection,
  listConnections,
  readSyncJob,
  recentRuns,
  deletedSourceAccounts,
  sourceSkippedIds,
  SYNC_RUN_RETENTION_DAYS,
} from "@ledgerly/domain/platform/integrations";
import { credentialsStatus, listUserPlugins } from "@ledgerly/domain/platform/plugins";
import { connectionSummary, keepManifestsFresh, returnAddress } from "@ledgerly/plugin-host";
import { pluginProvider } from "@ledgerly/domain/platform/integrations";
import { listAccounts } from "@ledgerly/domain/accounts";
import { interestsView } from "@ledgerly/domain/interests";
import { providerOf } from "@ledgerly/domain/investments";
import { listInvestmentAccounts } from "@ledgerly/domain/investments";
import { pendingCount } from "@ledgerly/domain/timeoff";
import { pendingSends } from "@ledgerly/domain/transactions";
import { ButtonLink } from "@ledgerly/ui/button";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { sourceCategoryRows } from "../categories/source";
import { bankWait, ibanConflictNames } from "./connection-list";
import {
  keepSourceCategoryAction,
  setSourceCategoryAction,
  undoSourceCategoryAction,
} from "../categories/source-actions";
import { SourceCategories, type SourceCategoryCommands } from "../categories/source-categories";
import { HistoryDepth } from "./advanced/history-depth";
import { BanksCard } from "./banks-card";
import { ConnectionRow, type ConnectionRowProps, type RowStatusValue, SourceLinkRow } from "./connection-row";
import {
  accountsLeft,
  advancedHref,
  type Capabilities,
  connectionRows,
  OWN_DIALOGS,
  RUNS_PER_CONNECTION,
} from "./connection-view";
import { DeactivateZone } from "./deactivate-zone";
import { DeletedAccounts } from "./deleted-accounts";
import { PluginRow } from "./plugin-row";
import { ScheduleCell } from "./schedule-cell";
import { TrekCard } from "./trek-card";
import { WalletAccounts, WalletCard } from "./wallet-card";

/** The writes of "Categories of {source}", handed to the component: actions of the application. */
const SOURCE_COMMANDS: SourceCategoryCommands = {
  set: setSourceCategoryAction,
  undo: undoSourceCategoryAction,
  keep: keepSourceCategoryAction,
};

/** Both routes: the list (`/settings/integrations`) and a source's page (`…/[source]`). */
interface IntegrationsProps {
  params: Promise<{ source?: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: IntegrationsProps): Promise<Metadata> {
  const t = await getTranslations("settings");
  const { source } = await params;
  const base = `${t("tabs.integrations")} · ${t("title")}`;
  if (source === undefined) return { title: base };
  const ctx = await requireSession();
  const plugin = (await listUserPlugins(ctx)).find((one) => one.id === source);
  const name = plugin?.name ?? (await labelOf({ provider: source, instanceKey: "" }, ctx.locale)).provider;
  return { title: `${name} · ${base}` };
}

const DAY_MS = 86_400_000;
const INTEGRATIONS = "/settings/integrations";
/** The sources of the core with a page of their own (plugin-settings.md §2.1). */
const CORE_SOURCES = [WALLET_PROVIDER, TREK_PROVIDER] as const;
/** The state a list row shows for a source with several connections: the one that needs most. */
const WORST: readonly RowStatusValue[] = ["action", "late", "running", "paused", "ok", "absent"];

/**
 * Settings › Integrations (ux/n2-connection-status.md, plugin-settings.md §2): the list has one
 * row per source, and each source has a page with every setting of its own — its connections, its
 * accounts, its categories, its schedule, its history, what Ledgerly writes to it, its log. The
 * investment services keep their rows here: their settings are on the service's page.
 *
 * The same component draws both routes: the source's page is `[source]/page.tsx`, which re-exports
 * this one, so the providers of the core are named in this file only (rule M12).
 *
 * A connection is read through `listConnections`, which cannot carry credentials — the sealed
 * column is only ever opened by `readCredentials`, and only on the server. Nothing on this page
 * knows a token, so nothing on this page can send one to the browser.
 */
export default async function SettingsIntegrationsPage({ params, searchParams }: IntegrationsProps) {
  const ctx = await requireSession();
  const { source } = await params;
  const t = await getTranslations("settings.integrations");
  const text = await getTranslations("settings.connections");
  const plugin = await getTranslations("settings.plugin");
  const day = (instant: Date) => formatDate(civilDateIn(instant, ctx.timeZone), "long", ctx.locale);
  const now = new Date();

  // The plugins of the instance (rewrite plan N1, decision H25): each person sees them, and turns
  // on their own. The manifests are read in the background: the page never waits for a plugin.
  keepManifestsFresh();
  const [userPlugins, connections, runs, services] = await Promise.all([
    listUserPlugins(ctx),
    listConnections(ctx),
    recentRuns(ctx, RUNS_PER_CONNECTION, new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS)),
    listInvestmentAccounts(ctx),
  ]);

  // A source's page: a source of the core, or a plugin the person has on. A plugin that is not on
  // has no page: the list, with its row in sight (§2.1).
  const sourcePlugin = source === undefined ? undefined : userPlugins.find((one) => one.id === source);
  if (source !== undefined) {
    if (sourcePlugin !== undefined && sourcePlugin.state !== "active")
      redirect(`${INTEGRATIONS}#source-${source}`);
    if (sourcePlugin === undefined && !(CORE_SOURCES as readonly string[]).includes(source)) notFound();
  }

  const rows = await connectionRows(ctx, now);
  const accounts = await listAccounts(ctx);
  // The names of the accounts a source could not add an account beside (rewrite plan N4, case 5).
  // Read only when a connection has one: no query more for the page otherwise (G9).
  const ibanConflicts = await ibanConflictNames(ctx, connections);
  const runsOf = (connection: Connection) => runs.filter((run) => run.connectionId === connection.id);
  const hrefOf = (slug: string) => `${INTEGRATIONS}/${slug}`;

  /** The row of a provider with one connection, or "Not connected" while it has none. */
  async function single(provider: string, name: string, role: string, capabilities = OWN_DIALOGS) {
    const connection = connections.find((one) => one.provider === provider) ?? null;
    if (connection === null) return { connection, row: rows.absent(provider, name, role) };
    return {
      connection,
      row: rows.row({
        connection,
        label: await labelOf(connection, ctx.locale),
        detail: role,
        runs: runsOf(connection),
        capabilities,
        ibanConflicts: ibanConflicts(connection),
      }),
    };
  }
  const wallet = await single(WALLET_PROVIDER, t("providers.wallet.name"), t("providers.wallet.role"));
  const trek = await single(TREK_PROVIDER, t("providers.trek.name"), t("providers.trek.role"));

  /** What "Disconnect" of a bank leaves, by connection: filled by `pluginRows`. */
  const leave: Record<string, { accounts: number; excluded: number }> = {};

  /** The rows of the connections of one plugin: one per bank, by name. */
  async function pluginRows(pluginId: string, active: boolean, keyRefused: boolean) {
    const provider = pluginProvider(pluginId);
    const built = await Promise.all(
      connections
        .filter((connection) => connection.provider === provider)
        .map(async (connection) => {
          const summary = await connectionSummary(ctx, connection.id);
          // The wait a bank asked for after "no more calls for now": the next attempt is its end.
          const wait = await bankWait(ctx, connection.id, now);
          const detail = text("detail.accounts", { count: summary.accounts });
          const capabilities: Capabilities = active
            ? {
                update: true,
                renewHref: `/banks/connect?renew=${connection.id}`,
                replaceKey: "own",
                // `all`: the accounts left out are offered again too, so one can be chosen later.
                chooseAccountsHref: `/banks/connect?step=accounts&c=${connection.id}&all=1`,
                disconnect: true,
              }
            : { update: false };
          // The accounts here that the access reads: an account deleted here is not one (N7.1 review).
          leave[connection.id] = {
            accounts: summary.chosen ? accountsLeft(accounts, provider, new Set(summary.accountIds)) : 0,
            excluded: summary.skipped,
          };
          return {
            connection,
            row: rows.row({
              connection,
              label: await labelOf(connection, ctx.locale),
              detail:
                connection.expiresAt === null || connection.expiresAt.getTime() <= now.getTime()
                  ? detail
                  : `${detail} · ${text("detail.validUntil", { date: day(connection.expiresAt) })}`,
              runs: runsOf(connection),
              capabilities,
              providerActive: active,
              accountsChosen: summary.chosen,
              keyRefused,
              nextAttempt: wait,
            }),
          };
        }),
    );
    // By name, whatever the state: a row does not move when its state changes (§7).
    return built.sort((a, b) => a.row.name.localeCompare(b.row.name, ctx.locale, { sensitivity: "base" }));
  }

  if (source !== undefined) {
    // ---- The page of one source (plugin-settings.md §2.2): its sections, in a fixed order. ----
    const name = sourcePlugin?.name ?? (source === WALLET_PROVIDER ? wallet.row.name : trek.row.name);
    const provider = sourcePlugin ? pluginProvider(sourcePlugin.id) : source;
    const deactivateHref = `${hrefOf(source)}#deactivate`;

    let connection: ReactNode = null;
    let own: { connection: Connection; row: ConnectionRowProps }[] = [];
    let accountsSection: ReactNode = null;
    let writes: ReactNode = null;
    let status: RowStatusValue = "absent";

    if (source === WALLET_PROVIDER) {
      // What "Disconnect" of Wallet leaves: its accounts here and the ones left out (H55, point 4).
      const walletLeave = wallet.connection
        ? {
            accounts: accounts.filter((account) => account.provider === WALLET_PROVIDER).length,
            excluded: (await sourceSkippedIds(ctx, WALLET_PROVIDER)).size,
          }
        : { accounts: 0, excluded: 0 };
      connection = (
        <WalletCard
          row={wallet.row}
          connected={wallet.connection !== null}
          leave={walletLeave}
          deactivateHref={deactivateHref}
        />
      );
      own = wallet.connection ? [{ connection: wallet.connection, row: wallet.row }] : [];
      status = wallet.row.status.value;
      if (wallet.connection) {
        accountsSection = (
          <>
            <WalletAccounts />
            <DeletedAccounts slug={source} rows={await deletedSourceAccounts(ctx, WALLET_PROVIDER)} />
          </>
        );
        // What Ledgerly writes to Wallet: the interest rules that publish, the movements waiting.
        const sourceAccounts = accounts.filter((account) => account.provider === WALLET_PROVIDER);
        const ids = new Set(sourceAccounts.map((account) => account.id));
        const [rules, waiting] = await Promise.all([
          interestsView(ctx, now),
          pendingSends(ctx, [...ids], 1000),
        ]);
        const publishing = rules.filter(
          (rule) => rule.rule.mode === "post_to_provider" && ids.has(rule.rule.accountId),
        );
        const waitingAccounts = [...new Set(waiting.map((one) => one.accountId))];
        writes = (
          <ul className="flex flex-col text-sm" data-testid="source-writes">
            {publishing.length === 0 && waiting.length === 0 && (
              <li className="px-4 py-3.5 text-muted">{plugin("writes.none")}</li>
            )}
            {publishing.map((rule) => (
              <li key={rule.rule.id} className="border-t border-border px-4 py-3 first:border-t-0">
                <Link
                  href={`/interests/${rule.rule.id}` as Route}
                  className="focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2"
                >
                  {plugin("writes.rule", { account: rule.accountName })}
                </Link>
              </li>
            ))}
            {waiting.length > 0 && (
              <li className="border-t border-border px-4 py-3 first:border-t-0">
                <Link
                  href={`/expenses?acc=${waitingAccounts.join(",")}` as Route}
                  className="focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2"
                >
                  {plugin("writes.unsent", { count: waiting.length })}
                </Link>
              </li>
            )}
          </ul>
        );
      }
    } else if (source === TREK_PROVIDER) {
      const pending = trek.connection ? await pendingCount(ctx) : 0;
      connection = (
        <TrekCard
          row={trek.row}
          connected={trek.connection !== null}
          pending={pending}
          deactivateHref={deactivateHref}
        />
      );
      own = trek.connection ? [{ connection: trek.connection, row: trek.row }] : [];
      status = trek.row.status.value;
      if (trek.connection) {
        writes = (
          <p className="px-4 py-3.5 text-sm text-muted" data-testid="source-writes">
            {pending > 0 ? plugin("writes.pendingDays", { count: pending }) : plugin("writes.none")}
          </p>
        );
      }
    } else if (sourcePlugin) {
      const credentials = await credentialsStatus(ctx, sourcePlugin.id);
      const banks = await pluginRows(sourcePlugin.id, true, credentials.invalid);
      own = banks;
      status = worst(banks.map((bank) => bank.row.status.value));
      connection = (
        <>
          <div>
            <BanksCard
              pluginId={sourcePlugin.id}
              credentials={{
                saved: credentials.saved,
                savedAt: credentials.savedAt ? day(credentials.savedAt) : null,
                invalid: credentials.invalid,
              }}
              returnAddress={returnAddress(sourcePlugin.id)}
              banks={banks.map((bank) => bank.row)}
              openReplace={(await searchParams).replace === "1"}
              leave={leave}
              provider={{ name: sourcePlugin.name, href: deactivateHref }}
            />
          </div>
        </>
      );
      if (banks.length > 0) {
        accountsSection = (
          <>
            <ul className="flex flex-col">
              {banks.map((bank) => (
                <li
                  key={bank.connection.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3.5 first:border-t-0"
                >
                  <span className="min-w-0 font-semibold break-words">{bank.row.name}</span>
                  <ButtonLink
                    href={`/banks/connect?step=accounts&c=${bank.connection.id}&all=1` as Route}
                    size="sm"
                    aria-label={plugin("accounts.chooseFor", { name: bank.row.name })}
                  >
                    {plugin("accounts.choose")}
                  </ButtonLink>
                </li>
              ))}
            </ul>
            <DeletedAccounts slug={source} rows={await deletedSourceAccounts(ctx, provider)} />
          </>
        );
      }
    }

    const categories = await sourceCategoryRows(ctx, provider);
    const histories = await Promise.all(
      own.map(async ({ connection: one }) => {
        const history = passFor(one.provider)?.history;
        if (!history) return null;
        const job = await readSyncJob(ctx, one.id, "transactions");
        return { id: one.id, months: history.depthOf(job?.cursor), choices: history.choices };
      }),
    );
    const depths = histories.filter((one) => one !== null);
    const labels = new Map(
      await Promise.all(
        own.map(async ({ connection: one }) => [one.id, await labelOf(one, ctx.locale)] as const),
      ),
    );

    return (
      <SettingsGrid>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold" data-testid="source-title" data-status={status}>
              {name}
            </h2>
            <ButtonLink href={INTEGRATIONS as Route} size="sm">
              ← {plugin("page.back")}
            </ButtonLink>
          </div>
        </div>

        <SettingsSection
          title={plugin("sections.connection")}
          description={plugin("sections.connectionHint", { provider: name })}
          padded={false}
        >
          {connection}
        </SettingsSection>

        {accountsSection !== null && (
          <SettingsSection
            title={plugin("sections.accounts")}
            description={plugin("sections.accountsHint", { provider: name })}
            padded={false}
          >
            {accountsSection}
          </SettingsSection>
        )}

        {categories !== null && (
          <SettingsSection
            title={plugin("sections.categories", { provider: name })}
            description={plugin("sections.categoriesHint", { provider: name })}
            padded={false}
          >
            <SourceCategories source={categories.name} rows={categories.rows} commands={SOURCE_COMMANDS} />
          </SettingsSection>
        )}

        {own.length > 0 && (
          <SettingsSection
            title={plugin("sections.schedule")}
            description={plugin("sections.scheduleHint")}
            padded={false}
          >
            <ul className="flex flex-col">
              {own.map(({ connection: one }) => (
                <li
                  key={one.id}
                  className="border-t border-border first:border-t-0"
                  data-testid="schedule-row"
                >
                  <div className="flex flex-col gap-x-5 gap-y-1.5 px-4 py-3.5 md:flex-row md:items-start md:justify-between">
                    <span className="min-w-0 font-semibold break-words">{labels.get(one.id)?.name}</span>
                    <div className="min-w-0 text-sm md:text-right">
                      <ScheduleCell
                        connection={one}
                        name={labels.get(one.id)?.name ?? ""}
                        provider={labels.get(one.id)?.provider ?? ""}
                        active
                        ctx={ctx}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SettingsSection>
        )}

        {depths.length > 0 && (
          <SettingsSection
            title={plugin("sections.history")}
            description={plugin("sections.historyHint", { provider: name })}
            padded={false}
          >
            {depths.map((depth) => (
              <HistoryDepth
                key={depth.id}
                connectionId={depth.id}
                months={depth.months}
                choices={depth.choices}
              />
            ))}
          </SettingsSection>
        )}

        {writes !== null && (
          <SettingsSection
            title={plugin("sections.writes", { provider: name })}
            description={plugin("sections.writesHint", { provider: name })}
            padded={false}
          >
            {writes}
          </SettingsSection>
        )}

        {own.length > 0 && (
          <SettingsSection
            title={plugin("sections.advanced")}
            description={plugin("sections.advancedHint")}
            padded={false}
          >
            <ul className="flex flex-col">
              {own.map(({ connection: one }) => (
                <li key={one.id} className="border-t border-border px-4 py-3 first:border-t-0">
                  <Link
                    href={`${advancedHref(one.id)}#log` as Route}
                    className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent underline underline-offset-2"
                  >
                    {plugin("advanced.log", { name: labels.get(one.id)?.name ?? name })}
                  </Link>
                </li>
              ))}
            </ul>
          </SettingsSection>
        )}

        <div id="deactivate" className="scroll-mt-4">
          <SettingsSection
            title={plugin("sections.deactivate", { provider: name })}
            description={plugin("sections.deactivateHint", { provider: name })}
            padded={false}
          >
            <DeactivateZone slug={source} provider={name} />
          </SettingsSection>
        </div>
      </SettingsGrid>
    );
  }

  // ---- The list (plugin-settings.md §2.1): one row per source, the services, "Advanced". ----
  const pausedRows = new Map(
    await Promise.all(
      userPlugins
        .filter((one) => one.state === "paused")
        .map(
          async (one) => [one.id, (await pluginRows(one.id, false, false)).map((bank) => bank.row)] as const,
        ),
    ),
  );
  const activeStatus = new Map(
    await Promise.all(
      userPlugins
        .filter((one) => one.state === "active")
        .map(async (one) => {
          const banks = await pluginRows(one.id, true, false);
          return [one.id, worst(banks.map((bank) => bank.row.status.value))] as const;
        }),
    ),
  );

  // Investments (docs/design/investments.md §4.2): the key, its checks and the disconnection
  // live on the service's page.
  const invested = await Promise.all(
    connections.flatMap((connection) => {
      const provider = providerOf(connection.provider);
      const service = services.find((one) => one.provider === connection.provider);
      if (!provider || provider.connect !== "apikey" || !service) return [];
      const href = `/investments/${service.accountId}/connection`;
      return [
        labelOf(connection, ctx.locale).then((label) =>
          rows.row({
            connection,
            label,
            detail: text("detail.readOnlyKey"),
            runs: runsOf(connection),
            capabilities: { update: true, replaceKey: href, settingsHref: href },
          }),
        ),
      ];
    }),
  );

  return (
    <SettingsGrid>
      <SettingsSection title={t("title")} description={t("description")} padded={false}>
        <ul className="flex flex-col">
          {[
            { slug: WALLET_PROVIDER, row: wallet.row },
            { slug: TREK_PROVIDER, row: trek.row },
          ].map(({ slug, row }) => (
            <li key={slug} className="border-t border-border first:border-t-0">
              <SourceLinkRow
                slug={slug}
                name={row.name}
                status={row.status.value}
                summary={row.detail}
                href={hrefOf(slug)}
              />
            </li>
          ))}
          {userPlugins.map((one) => (
            <li
              key={one.id}
              id={`source-${one.id}`}
              className="scroll-mt-4 border-t border-border target:bg-hover"
            >
              {one.state === "active" ? (
                <SourceLinkRow
                  slug={one.id}
                  name={one.name}
                  status={activeStatus.get(one.id) ?? "absent"}
                  summary={one.description}
                  href={hrefOf(one.id)}
                />
              ) : (
                <>
                  <PluginRow
                    id={one.id}
                    name={one.name}
                    description={one.description}
                    state={one.state}
                    pausedSince={one.pausedSince ? day(one.pausedSince) : null}
                    hasCredentials={one.hasCredentials}
                    connections={one.connections}
                  />
                  {(pausedRows.get(one.id) ?? []).length > 0 && (
                    <ul className="flex flex-col">
                      {(pausedRows.get(one.id) ?? []).map((row) => (
                        <li key={row.id} className="border-t border-border">
                          <ConnectionRow {...row} />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>

      {invested.length > 0 && (
        <SettingsSection
          title={t("investments.title")}
          description={t("investments.description")}
          padded={false}
        >
          <ul className="flex flex-col">
            {invested.map((row) => (
              <li
                key={row.id}
                className="border-t border-border first:border-t-0"
                data-testid="investment-connection"
              >
                <ConnectionRow {...row} />
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      <p className="flex justify-end">
        <Link
          href={"/settings/integrations/advanced" as Route}
          className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline"
        >
          {text("actions.advanced")} →
        </Link>
      </p>
    </SettingsGrid>
  );
}

/** The state that needs the person most, of a source with several connections. */
function worst(values: readonly RowStatusValue[]): RowStatusValue {
  if (values.length === 0) return "absent";
  return WORST.find((value) => values.includes(value)) ?? "ok";
}

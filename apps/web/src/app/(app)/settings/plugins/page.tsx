import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import {
  categories as categoryRoutes,
  connections as connectionRoutes,
  labels as labelRoutes,
  sources,
} from "@ledgerly/api-contract/settings";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Dot, StatusWord } from "@ledgerly/ui/connection-row";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { apiRead } from "@/platform/api-read";
import { requireSession } from "@/platform/auth/session";
import { SourceCategories } from "../finance/source-categories";
import { HistoryDepth } from "./advanced/history-depth";
import { BanksCard } from "./banks-card";
import {
  ConnectionRow,
  type ConnectionRowProps,
  type RowStatusValue,
  SourceLinkRow,
  SourceReads,
} from "./connection-row";
import { connectionRows, OWN_DIALOGS, RUNS_PER_CONNECTION, type WireConnection } from "./connection-view";
import { DeactivateZone } from "./deactivate-zone";
import { DeletedAccounts } from "./deleted-accounts";
import { PluginRow } from "./plugin-row";
import { ScheduleCell } from "./schedule-cell";
import { bankRows, worst } from "./source-rows";
import { sourceCategoryRowsOf } from "./source-category-rows";
import { engineSections } from "./engine-sections";

/** Both routes: the list (`/settings/plugins`) and a source's page (`…/[source]`). */
interface IntegrationsProps {
  params: Promise<{ source?: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The plugins of the person, read once for the title and the page (`cache`). */
const pluginsOf = cache(() => apiRead(sources.listPlugins, {}));

export async function generateMetadata({ params }: IntegrationsProps): Promise<Metadata> {
  const t = await getTranslations("settings");
  const { source } = await params;
  const base = `${t("tabs.plugins")} · ${t("title")}`;
  if (source === undefined) return { title: base };
  const plugin = (await pluginsOf())?.plugins.find((one) => one.id === source);
  return { title: `${plugin?.name ?? source} · ${base}` };
}

const INTEGRATIONS = "/settings/plugins";

type Plugin = NonNullable<Awaited<ReturnType<typeof pluginsOf>>>["plugins"][number];

/**
 * Settings › Integrations (ux/n2-connection-status.md, plugin-settings.md §2): the list has one
 * row per source, and each source has a page with every setting of its own — its connections, its
 * accounts, its categories, its schedule, its history, what Ledgerly writes to it, its log. The
 * investment services keep their rows here: their settings are on the service's page.
 *
 * The same component draws both routes: the source's page is `[source]/page.tsx`, which re-exports
 * this one. No provider is named: a plugin read by an engine of the core (a source read with a token,
 * a leave calendar) says what it is in `GET /plugins` (`kind`), and its card asks for the fields of
 * its manifest (rule M12, rewrite plan R5c).
 *
 * Everything is read from `/api/v1` (`apiRead`): the plugins, the connections with their state and
 * their last runs, the page of a source. None of them carries a credential, so nothing on this page
 * can send one to the browser.
 */
export default async function SettingsIntegrationsPage({ params, searchParams }: IntegrationsProps) {
  const ctx = await requireSession();
  const { source } = await params;
  const t = await getTranslations("settings.integrations");
  /** What a plugin reads, from its manifest (`GET /plugins` `kinds`), in the words of the runs. */
  const readsOf = (one: Plugin) => one.kinds.map((kind) => t(`kinds.${kind}`));
  const text = await getTranslations("settings.connections");
  const plugin = await getTranslations("settings.plugin");
  const day = (instant: string) =>
    formatDate(civilDateIn(new Date(instant), ctx.timeZone), "long", ctx.locale);
  const now = new Date();

  // The plugins of the instance (rewrite plan N1, decision H25): each person sees them, and turns
  // on their own. `GET /plugins` reads the manifests in the background: the page never waits.
  const [pluginsRead, connectionsRead] = await Promise.all([
    pluginsOf(),
    apiRead(connectionRoutes.listConnections, { query: { runs: RUNS_PER_CONNECTION } }),
  ]);
  // A plugin read by an engine of the core has its row and its page whether it is on or not.
  const enginePlugins = (pluginsRead?.plugins ?? []).filter((one) => one.kind !== "bank");
  const userPlugins = (pluginsRead?.plugins ?? []).filter((one) => one.kind === "bank");
  const connections = connectionsRead?.connections ?? [];

  // A source's page: a source of the core, or a plugin the person has on. A plugin that is not on
  // has no page: the list, with its row in sight (§2.1).
  const sourcePlugin = source === undefined ? undefined : userPlugins.find((one) => one.id === source);
  const enginePlugin = source === undefined ? undefined : enginePlugins.find((one) => one.id === source);
  if (source !== undefined) {
    if (sourcePlugin !== undefined && sourcePlugin.state !== "active")
      redirect(`${INTEGRATIONS}#source-${source}`);
    if (sourcePlugin === undefined && enginePlugin === undefined) notFound();
  }

  const rows = await connectionRows(ctx, now);
  const hrefOf = (slug: string) => `${INTEGRATIONS}/${slug}`;

  /** The row of a provider with one connection, or "Not connected" while it has none. */
  function single(provider: string, name: string, role: string, capabilities = OWN_DIALOGS) {
    const connection = connections.find((one) => one.provider === provider) ?? null;
    if (connection === null) return { connection, row: rows.absent(provider, name, role) };
    return { connection, row: rows.row({ connection, detail: role, capabilities }) };
  }
  const engines = enginePlugins.map((one) => ({
    plugin: one,
    single: single(`plugin:${one.id}`, one.name, one.description),
  }));

  const bankInput = { connections, rows, text, day, locale: ctx.locale, now };
  const pluginRows = (pluginId: string, active: boolean) => bankRows(bankInput, pluginId, active);

  if (source !== undefined) {
    // ---- The page of one source (plugin-settings.md §2.2): its sections, in a fixed order. ----
    const name = sourcePlugin?.name ?? enginePlugin?.name ?? source;
    const provider = `plugin:${source}`;
    const deactivateHref = `${hrefOf(source)}#deactivate`;
    // What waits to be written to the source, what «Disconnect» leaves, the accounts deleted here.
    const page = await apiRead(sources.getSource, { params: { slug: source } });
    const leaveOf = (id: string) =>
      page?.connections.find((one) => one.id === id)?.leave ?? { accounts: 0, excluded: 0 };

    let connection: ReactNode = null;
    let own: { connection: WireConnection; row: ConnectionRowProps }[] = [];
    let accountsSection: ReactNode = null;
    let writes: ReactNode = null;
    let status: RowStatusValue = "absent";

    const engine = engines.find((one) => one.plugin.id === source);
    if (engine) {
      const built = await engineSections({ ...engine, page, deactivateHref });
      ({ connection, own, status, writes } = built);
      accountsSection = built.accounts;
    } else if (sourcePlugin) {
      const { credentials } = sourcePlugin;
      const banks = pluginRows(sourcePlugin.id, true);
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
              returnAddress={sourcePlugin.returnAddress}
              banks={banks.map((bank) => bank.row)}
              openReplace={(await searchParams).replace === "1"}
              leave={Object.fromEntries(
                banks.map((bank) => [bank.connection.id, leaveOf(bank.connection.id)]),
              )}
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
            <DeletedAccounts slug={source} rows={page?.deletedAccounts ?? []} />
          </>
        );
      }
    }

    const [sourceRows, allCategories] = await Promise.all([
      apiRead(labelRoutes.listSourceCategories, {}),
      apiRead(categoryRoutes.listCategories, { query: { archived: "true" } }),
    ]);
    const categories = sourceCategoryRowsOf(
      provider,
      sourceRows?.sourceCategories ?? [],
      allCategories?.categories ?? [],
    );
    // "Download the history again": the depth read today, for a provider that reads a chosen depth.
    const depths = own.flatMap(({ connection: one }) =>
      one.historyDepth === null
        ? []
        : [{ id: one.id, months: one.historyDepth, choices: one.capabilities.historyMonths }],
    );
    // Nothing to turn off without a connection, a credential or the plugin on (UX review, point 8).
    const facts = sourcePlugin ?? enginePlugin;
    const deactivable =
      facts !== undefined &&
      (facts.state === "active" || facts.connections > 0 || facts.credentials.saved || own.length > 0);
    const labels = new Map(
      own.map(({ connection: one }) => [one.id, { name: one.name, provider: one.providerName }]),
    );

    return (
      <SettingsGrid>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* The state of the source beside its name (UX review, point 10): the word of its rows. */}
            <div className="flex flex-wrap items-center gap-x-2" data-testid="source-heading">
              <Dot value={status} />
              <h2 className="text-lg font-semibold" data-testid="source-title" data-status={status}>
                {name}
              </h2>
              <StatusWord value={status} />
            </div>
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
            <SourceCategories source={categories.name} rows={categories.rows} />
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

        {/* The log of the readings is under each connection's «History» and in its «…» menu
            (UX review, point 12): no card for a link alone. */}
        {deactivable && (
          <div id="deactivate" className="scroll-mt-4">
            <SettingsSection
              title={plugin("sections.deactivate", { provider: name })}
              description={plugin("sections.deactivateHint", { provider: name })}
              padded={false}
            >
              <DeactivateZone slug={source} provider={name} calendar={enginePlugin?.kind === "calendar"} />
            </SettingsSection>
          </div>
        )}
      </SettingsGrid>
    );
  }

  // ---- The list (plugin-settings.md §2.1): one row per source, the services, "Advanced". ----
  const pausedRows = new Map(
    userPlugins
      .filter((one) => one.state === "paused")
      .map((one) => [one.id, pluginRows(one.id, false).map((bank) => bank.row)] as const),
  );
  const activeStatus = new Map(
    userPlugins
      .filter((one) => one.state === "active")
      .map((one) => [one.id, worst(pluginRows(one.id, true).map((bank) => bank.row.status.value))] as const),
  );

  return (
    <SettingsGrid>
      <SettingsSection title={t("title")} description={t("description")} padded={false}>
        <ul className="flex flex-col">
          {engines.map(({ plugin: one, single: { row } }) => (
            <li key={one.id} className="border-t border-border first:border-t-0">
              <SourceLinkRow
                slug={one.id}
                name={row.name}
                status={row.status.value}
                summary={row.detail}
                href={hrefOf(one.id)}
                reads={readsOf(one)}
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
                  reads={readsOf(one)}
                />
              ) : (
                <>
                  <PluginRow
                    id={one.id}
                    name={one.name}
                    description={one.description}
                    state={one.state}
                    pausedSince={one.pausedSince ? day(one.pausedSince) : null}
                    hasCredentials={one.credentials.saved}
                    connections={one.connections}
                    reads={<SourceReads reads={readsOf(one)} />}
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

      <p className="flex justify-end">
        <Link
          href={"/settings/plugins/advanced" as Route}
          className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline"
        >
          {text("actions.advanced")} →
        </Link>
      </p>
    </SettingsGrid>
  );
}

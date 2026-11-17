import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { labelOf } from "@/platform/integrations/registry";
import { TREK_PROVIDER, WALLET_PROVIDER } from "@/platform/integrations/rules";
import {
  type Connection,
  listConnections,
  readSyncJob,
  recentRuns,
  SYNC_RUN_RETENTION_DAYS,
} from "@/platform/integrations/service";
import { credentialsStatus, listUserPlugins } from "@/platform/plugins/queries";
import { connectionSummary, keepManifestsFresh, returnAddress } from "@/platform/plugins/service";
import { pluginProvider } from "@/platform/integrations/rules";
import { listAccounts } from "@/modules/accounts/queries";
import { providerOf } from "@/modules/investments/catalog";
import { listInvestmentAccounts } from "@/modules/investments/service";
import { pendingCount } from "@/modules/timeoff/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { BANK_PLUGIN_ID } from "../../banks/plugin";
import { BanksCard } from "./banks-card";
import { ConnectionRow } from "./connection-row";
import { type Capabilities, connectionRows, OWN_DIALOGS, RUNS_PER_CONNECTION } from "./connection-view";
import { PluginRow } from "./plugin-row";
import { TrekCard } from "./trek-card";
import { WalletCard } from "./wallet-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.integrations")} · ${t("title")}` };
}

const DAY_MS = 86_400_000;

/**
 * Settings › Integrations (ux/n2-connection-status.md): every connection in the same row, with
 * one state of five and one action when something has to be done. The schedule and the log of
 * the readings are under "Advanced".
 *
 * A connection is read through `listConnections`, which cannot carry credentials — the sealed
 * column is only ever opened by `readCredentials`, and only on the server. Nothing on this page
 * knows a token, so nothing on this page can send one to the browser.
 */
export default async function SettingsIntegrationsPage({
  searchParams,
}: PageProps<"/settings/integrations">) {
  const ctx = await requireSession();
  const t = await getTranslations("settings.integrations");
  const banksText = await getTranslations("settings.banks");
  const text = await getTranslations("settings.connections");
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
  const rows = await connectionRows(ctx, now);
  // The names of the accounts a source could not add an account beside (rewrite plan N4, case 5).
  // Read only when a connection has one: no query more for the page otherwise (G9).
  const accountNames = new Map(
    connections.some((connection) => (connection.ibanConflicts ?? []).length > 0)
      ? (await listAccounts(ctx, { includeArchived: true })).map((account) => [account.id, account.name])
      : [],
  );
  const ibanConflicts = (connection: Connection) =>
    (connection.ibanConflicts ?? []).flatMap((id) => {
      const name = accountNames.get(id);
      return name === undefined ? [] : [name];
    });
  const runsOf = (connection: Connection) => runs.filter((run) => run.connectionId === connection.id);

  /** The row of a provider with one connection, or "Not connected" while it has none. */
  async function single(provider: string, name: string, role: string, capabilities = OWN_DIALOGS) {
    const connection = connections.find((one) => one.provider === provider) ?? null;
    if (connection === null) return { connected: false, row: rows.absent(provider, name, role) };
    return {
      connected: true,
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
  const wallet = await single(WALLET_PROVIDER, t("providers.wallet.name"), t("providers.wallet.role"), {
    ...OWN_DIALOGS,
    chooseAccountsHref: "own",
  });
  const trek = await single(TREK_PROVIDER, t("providers.trek.name"), t("providers.trek.role"));
  const waiting = trek.connected ? await pendingCount(ctx) : 0;

  /** The rows of the connections of one plugin: one per bank, by name. */
  async function pluginRows(pluginId: string, active: boolean, keyRefused: boolean) {
    const provider = pluginProvider(pluginId);
    const built = await Promise.all(
      connections
        .filter((connection) => connection.provider === provider)
        .map(async (connection) => {
          const summary = await connectionSummary(ctx, connection.id);
          // The wait a bank asked for after "no more calls for now": the next attempt is its end.
          const until = (await readSyncJob(ctx, connection.id, "transactions"))?.cursor?.retryAfter;
          const wait = until && new Date(until).getTime() > now.getTime() ? new Date(until) : null;
          const accounts = text("detail.accounts", { count: summary.accounts });
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
          return rows.row({
            connection,
            label: await labelOf(connection, ctx.locale),
            detail:
              connection.expiresAt === null || connection.expiresAt.getTime() <= now.getTime()
                ? accounts
                : `${accounts} · ${text("detail.validUntil", { date: day(connection.expiresAt) })}`,
            runs: runsOf(connection),
            capabilities,
            providerActive: active,
            accountsChosen: summary.chosen,
            keyRefused,
            nextAttempt: wait,
          });
        }),
    );
    // By name, whatever the state: a row does not move when its state changes (§7).
    return built.sort((a, b) => a.name.localeCompare(b.name, ctx.locale, { sensitivity: "base" }));
  }

  // The section "Banks" exists only for a person who has the plugin on; a plugin turned off keeps
  // its connections in sight, read only, under its own entry (decision H30).
  const bankPlugin = userPlugins.find((plugin) => plugin.id === BANK_PLUGIN_ID && plugin.state === "active");
  const credentials = bankPlugin ? await credentialsStatus(ctx, bankPlugin.id) : null;
  const banks =
    bankPlugin && credentials
      ? {
          credentials,
          rows: await pluginRows(bankPlugin.id, true, credentials.invalid),
          openReplace: (await searchParams).replace === "1",
        }
      : null;
  const paused = new Map(
    await Promise.all(
      userPlugins
        .filter((plugin) => plugin.state === "paused")
        .map(async (plugin) => [plugin.id, await pluginRows(plugin.id, false, false)] as const),
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
        <WalletCard row={wallet.row} connected={wallet.connected} />
        <div className="border-t border-border" />
        <TrekCard row={trek.row} connected={trek.connected} pending={waiting} />
        {userPlugins.map((plugin) => (
          <div key={plugin.id} className="border-t border-border">
            <PluginRow
              id={plugin.id}
              name={plugin.name}
              description={plugin.description}
              state={plugin.state}
              pausedSince={plugin.pausedSince ? day(plugin.pausedSince) : null}
              hasCredentials={plugin.hasCredentials}
              connections={plugin.connections}
            />
            {(paused.get(plugin.id) ?? []).length > 0 && (
              <ul className="flex flex-col">
                {(paused.get(plugin.id) ?? []).map((row) => (
                  <li key={row.id} className="border-t border-border">
                    <ConnectionRow {...row} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </SettingsSection>

      {bankPlugin && banks && (
        <SettingsSection title={banksText("title")} description={banksText("description")} padded={false}>
          <BanksCard
            pluginId={bankPlugin.id}
            credentials={{
              saved: banks.credentials.saved,
              savedAt: banks.credentials.savedAt ? day(banks.credentials.savedAt) : null,
              invalid: banks.credentials.invalid,
            }}
            returnAddress={returnAddress(bankPlugin.id)}
            banks={banks.rows}
            openReplace={banks.openReplace}
          />
        </SettingsSection>
      )}

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
          className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {text("actions.advanced")} →
        </Link>
      </p>
    </SettingsGrid>
  );
}

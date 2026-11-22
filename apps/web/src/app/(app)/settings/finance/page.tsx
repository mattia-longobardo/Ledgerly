import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connections as connectionRoutes, sources } from "@ledgerly/api-contract/settings";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate } from "@ledgerly/format/format";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { apiRead } from "@/platform/api-read";
import { requireSession } from "@/platform/auth/session";
import { ConnectionRow, type RowStatusValue, SourceLinkRow } from "../plugins/connection-row";
import { connectionRows, RUNS_PER_CONNECTION } from "../plugins/connection-view";
import { bankRows, serviceRows, worst } from "../plugins/source-rows";
import { CategoriesScreen } from "./categories-screen";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getTranslations("settings");
  return { title: `${text("tabs.finance")} · ${text("title")}` };
}

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline";

/**
 * Settings › Finance (decision D3): the banks, the investment services, the categories and labels,
 * then the way to the rules (categories-and-rules.md §11). A bank's settings stay on its plugin's
 * page (plugin-settings.md §2): here each bank plugin is one row that leads there. Everything is
 * read from `/api/v1`.
 */
export default async function SettingsFinancePage() {
  const ctx = await requireSession();
  const text = await getTranslations("settings.finance");
  const connectionText = await getTranslations("settings.connections");
  const services = await getTranslations("settings.finance.investments");
  const now = new Date();
  const [pluginsRead, connectionsRead] = await Promise.all([
    apiRead(sources.listPlugins, {}),
    apiRead(connectionRoutes.listConnections, { query: { runs: RUNS_PER_CONNECTION } }),
  ]);
  const connections = connectionsRead?.connections ?? [];
  const rows = await connectionRows(ctx, now);
  const day = (instant: string) =>
    formatDate(civilDateIn(new Date(instant), ctx.timeZone), "long", ctx.locale);
  const input = { connections, rows, text: connectionText, day, locale: ctx.locale, now };
  const banks = (pluginsRead?.plugins ?? []).filter((plugin) => plugin.state === "active");
  const statusOf = (pluginId: string) =>
    worst(bankRows(input, pluginId, true).map((bank) => bank.row.status.value));
  const invested = serviceRows(connections, rows, connectionText);

  return (
    <SettingsGrid>
      <BanksSection banks={banks.map((plugin) => ({ ...plugin, status: statusOf(plugin.id) }))} />

      {invested.length > 0 && (
        <SettingsSection title={services("title")} description={services("description")} padded={false}>
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

      <CategoriesScreen />

      <SettingsSection title={text("rules.title")} description={text("rules.description")}>
        <Link href="/settings/finance/rules" className={LINK}>
          {text("rules.open")} →
        </Link>
      </SettingsSection>
    </SettingsGrid>
  );
}

/** The bank plugins the person has on: one row each, to the plugin's page. */
async function BanksSection({
  banks,
}: {
  banks: { id: string; name: string; description: string | null; status: RowStatusValue }[];
}) {
  const text = await getTranslations("settings.finance");
  return (
    <SettingsSection title={text("banks.title")} description={text("banks.description")} padded={false}>
      {banks.length === 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 px-4 py-3.5 text-sm text-muted">
          {text("banks.empty")}
          <Link href="/settings/plugins" className={LINK}>
            {text("banks.openPlugins")} →
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col">
          {banks.map((plugin) => (
            <li key={plugin.id} className="border-t border-border first:border-t-0">
              <SourceLinkRow
                slug={plugin.id}
                name={plugin.name}
                status={plugin.status}
                summary={plugin.description}
                href={`/settings/plugins/${plugin.id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

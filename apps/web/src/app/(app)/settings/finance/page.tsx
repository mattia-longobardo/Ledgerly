import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connections as connectionRoutes } from "@ledgerly/api-contract/settings";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { apiRead } from "@/platform/api-read";
import { requireSession } from "@/platform/auth/session";
import { ConnectionRow } from "../plugins/connection-row";
import { connectionRows, RUNS_PER_CONNECTION } from "../plugins/connection-view";
import { serviceRows } from "../plugins/source-rows";
import { CategoriesScreen } from "./categories-screen";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getTranslations("settings");
  return { title: `${text("tabs.finance")} · ${text("title")}` };
}

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline";

/**
 * Settings › Finance: the investment services, the categories and labels, then the way to the rules
 * (categories-and-rules.md §11). The plugins, banks included, have one place only: Settings › Plugins
 * (D2 = A, PERS-615). Everything is read from `/api/v1`.
 */
export default async function SettingsFinancePage() {
  const ctx = await requireSession();
  const text = await getTranslations("settings.finance");
  const connectionText = await getTranslations("settings.connections");
  const services = await getTranslations("settings.finance.investments");
  const now = new Date();
  const connectionsRead = await apiRead(connectionRoutes.listConnections, {
    query: { runs: RUNS_PER_CONNECTION },
  });
  const connections = connectionsRead?.connections ?? [];
  const rows = await connectionRows(ctx, now);
  const invested = serviceRows(connections, rows, connectionText);

  return (
    <SettingsGrid>
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

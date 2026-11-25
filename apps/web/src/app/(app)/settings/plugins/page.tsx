import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { sources } from "@ledgerly/api-contract/settings";
import { apiRead } from "@/platform/api-read";
import { requireSession } from "@/platform/auth/session";
import { pluginViews } from "./plugin-facts";
import { PluginList } from "./plugin-list";
import { PluginPage } from "./plugin-page";

/** Both routes: the list (`/settings/plugins`) and a plugin's page (`…/[source]`). */
interface PluginsProps {
  params: Promise<{ source?: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The plugins of the person, read once for the title (`cache`). */
const pluginsOf = cache(() => apiRead(sources.listPlugins, {}));

export async function generateMetadata({ params }: PluginsProps): Promise<Metadata> {
  const t = await getTranslations("settings");
  const { source } = await params;
  const base = `${t("tabs.plugins")} · ${t("title")}`;
  if (source === undefined) return { title: base };
  const plugin = (await pluginsOf())?.plugins.find((one) => one.id === source);
  return { title: `${plugin?.name ?? source} · ${base}` };
}

/**
 * Settings › Plugins (H56, PERS-615): the list, one row per plugin of one model, and a page for each
 * plugin in each of its states — «Not active» included, which has its page too. The same component
 * draws both routes: the plugin's page is `[source]/page.tsx`, which re-exports this one.
 *
 * Everything is read from `/api/v1` (`apiRead`): the plugins with their state, the connections with
 * their health and their last runs, the page of a source. None of them carries a credential.
 */
export default async function SettingsPluginsPage({ params, searchParams }: PluginsProps) {
  const ctx = await requireSession();
  const { source } = await params;
  const { views, absent, day } = await pluginViews(ctx);
  if (source === undefined) return <PluginList views={views} />;
  const view = views.find((one) => one.plugin.id === source);
  if (view === undefined) notFound();
  return (
    <PluginPage
      ctx={ctx}
      view={view}
      replace={(await searchParams).replace === "1"}
      day={day}
      absent={absent}
    />
  );
}

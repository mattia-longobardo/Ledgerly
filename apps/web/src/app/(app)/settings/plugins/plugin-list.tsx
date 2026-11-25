// Settings › Plugins, the list (PERS-615 §3, §6): one row per plugin, all of the same model — its state
// in a word, the main fact, what it reads and writes, the main action and the menu «⋯». No row is a
// link as a whole. The difference with Addons is said once, with a link.
import { getTranslations } from "next-intl/server";
import { Link } from "@ledgerly/ui/router";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { canDeactivate } from "./plugin-model";
import { pageOf, type PluginView } from "./plugin-facts";
import { PluginRow } from "./plugin-row";

export async function PluginList({ views }: { views: PluginView[] }) {
  const words = await getTranslations("settings.plugins");
  return (
    <SettingsGrid>
      <SettingsSection
        title={words("title")}
        description={words("description")}
        action={
          <p className="text-muted">
            {words.rich("addons", {
              link: (chunks) => (
                <Link
                  href="/settings/addons"
                  className="focus-ring rounded-xs text-accent underline underline-offset-2"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        }
        padded={false}
      >
        <ul className="flex flex-col">
          {views.map((view) => (
            <li
              key={view.plugin.id}
              id={`source-${view.plugin.id}`}
              className="border-t border-border first:border-t-0"
            >
              <PluginRow
                slug={view.plugin.id}
                name={view.plugin.name}
                href={pageOf(view.plugin.id)}
                status={view.status}
                word={view.word}
                tone={view.tone}
                text={view.text}
                reads={view.reads}
                writes={view.writes}
                primary={view.primary}
                update={view.update}
                deactivable={canDeactivate(view.plugin)}
              />
            </li>
          ))}
        </ul>
      </SettingsSection>

      <p className="flex justify-end">
        <Link
          href="/settings/plugins/advanced"
          className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline"
        >
          {words("log")} →
        </Link>
      </p>
    </SettingsGrid>
  );
}

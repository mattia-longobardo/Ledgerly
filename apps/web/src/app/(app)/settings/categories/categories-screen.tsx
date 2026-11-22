"use client";

// Settings › Categories (categories-and-rules.md §5.7), read from `/api/v1` (rewrite plan R3): the
// proposals to merge, the default groups and the labels. The groups and categories themselves are on
// Expenses › Categories (QC6); "Categories of {source}" are on the source's page, one line each here.
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  categories as categoryRoutes,
  categoryBoard,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions/client";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { categoryColor } from "@/modules/transactions";
import { appRoute } from "@/platform/route";
import { DefaultGroupsButton } from "./default-groups";
import { LabelsCard } from "./labels-card";
import { MergeProposals } from "./merge-proposals";

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2";

function MergeSection() {
  const text = useTranslations("settings");
  const proposals = useApi(categoryBoard.getMergeProposals, {});
  if (!proposals.data || proposals.data.proposals.length === 0) return null;
  return (
    <SettingsSection
      title={text("categories.merge.title")}
      description={text("categories.merge.description")}
      padded={false}
    >
      <MergeProposals proposals={proposals.data.proposals} />
    </SettingsSection>
  );
}

function CategoriesSection() {
  const text = useTranslations("settings");
  const plugin = useTranslations("settings.plugin");
  const preferences = useApi(profile.getPreferences, {});
  const all = useApi(categoryRoutes.listCategories, { query: { archived: "true" } });
  const sources = useApi(labelRoutes.listSourceCategories, {});
  return (
    <SettingsSection
      title={text("categories.title")}
      description={text("categories.movedHint")}
      padded={false}
    >
      <p className="px-4 py-3 text-sm">
        <Link href="/expenses/categories" className={LINK}>
          {text("categories.movedLink")}
        </Link>
      </p>
      <Loaded state={sources}>
        {({ sourceCategories }) => {
          // One line for each source with a page, in the order the sources first appear.
          const moved = new Map<string, { name: string; href: string }>();
          for (const row of sourceCategories) {
            if (row.source !== null && !moved.has(row.provider))
              moved.set(row.provider, { name: row.sourceName, href: `/settings/integrations/${row.source}` });
          }
          return [...moved].map(([provider, source]) => (
            <p key={provider} className="border-t border-border px-4 py-3 text-sm text-muted">
              {plugin("categories.movedHint", { provider: source.name })}{" "}
              <Link href={appRoute(source.href)} className={LINK}>
                {plugin("settingsOf", { provider: source.name })}
              </Link>
            </p>
          ));
        }}
      </Loaded>
      <Loaded state={preferences}>
        {(prefs) => (
          <Loaded state={all}>
            {({ categories }) =>
              !categories.some((category) => category.archivedAt === null) && (
                <div className="border-t border-border px-4 py-3">
                  <DefaultGroupsButton
                    groups={DEFAULT_GROUPS.map((group, index) => ({
                      key: group.key,
                      name: group[prefs.locale],
                      examples: group.examples[prefs.locale],
                      color: categoryColor(null, index),
                    }))}
                  />
                </div>
              )
            }
          </Loaded>
        )}
      </Loaded>
    </SettingsSection>
  );
}

export function CategoriesScreen() {
  const text = useTranslations("settings");
  const rows = useApi(labelRoutes.listLabels, {});
  return (
    <SettingsGrid>
      <MergeSection />
      <CategoriesSection />
      <SettingsSection title={text("labels.title")} description={text("labels.description")} padded={false}>
        <Loaded state={rows}>{({ labels: list }) => <LabelsCard rows={list} />}</Loaded>
      </SettingsSection>
    </SettingsGrid>
  );
}

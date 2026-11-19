import type { Metadata, Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { colorOfCategory, listCategoriesWithUsage, listLabelsWithUsage } from "@ledgerly/domain/transactions";
import { createDefaultGroupsAction, dismissMergeAction } from "@/modules/transactions/categorize/actions";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions";
import { categoryColor } from "@/modules/transactions/ui/display";
import { requireSession } from "@/platform/auth/session";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { mergeCategoriesAction } from "./actions";
import { DefaultGroupsButton } from "./default-groups";
import { type LabelRow, LabelsCard } from "./labels-card";
import { mergeProposalsView } from "./merge";
import { type MergeSide, MergeProposals } from "./merge-proposals";
import { sourceCategorySections } from "./source";
import { sourceHref } from "../integrations/connection-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.categories")} · ${t("title")}` };
}

/**
 * Settings › Categories (categories-and-rules.md §5.7): the proposals to merge, the default groups
 * and the labels. The groups and categories themselves are on Expenses › Categories (QC6).
 */
export default async function SettingsCategoriesPage() {
  const ctx = await requireSession();
  const [t, plugin, categories, labels, proposals, sources] = await Promise.all([
    getTranslations("settings"),
    getTranslations("settings.plugin"),
    listCategoriesWithUsage(ctx, { includeArchived: true }),
    listLabelsWithUsage(ctx),
    mergeProposalsView(ctx),
    sourceCategorySections(ctx),
  ]);

  const byId = new Map(categories.map(({ category }) => [category.id, category]));
  const labelRows: LabelRow[] = labels.map(({ label, usage }) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    usage,
  }));

  /** One side of a proposal: a category that has sub-categories can only stay under a group. */
  const side = (category: { id: string; name: string; usage: number }, other: { id: string }): MergeSide => {
    const own = byId.get(category.id);
    const otherHasChildren = categories.some((row) => row.category.parentId === other.id);
    return {
      id: category.id,
      name: category.name,
      color: own ? colorOfCategory(own, byId) : categoryColor(null, 0),
      usage: category.usage,
      hasChildren: categories.some((row) => row.category.parentId === category.id),
      canKeepOther: !(otherHasChildren && own?.parentId !== null),
    };
  };
  const noCategories = !categories.some(({ category }) => category.archivedAt === null);

  // "Categories of {source}" are on the source's page (plugin-settings.md §2.2): one line each here.
  const moved = sources.flatMap((section) => {
    const href = sourceHref(section.provider);
    return href === null ? [] : [{ provider: section.provider, name: section.name, href }];
  });

  return (
    <SettingsGrid>
      {proposals.length > 0 && (
        <SettingsSection
          title={t("categories.merge.title")}
          description={t("categories.merge.description")}
          padded={false}
        >
          <MergeProposals
            proposals={proposals.map((proposal) => ({
              first: side(proposal.first, proposal.second),
              second: side(proposal.second, proposal.first),
              sumsBudgets: proposal.sumsBudgets,
            }))}
            merge={mergeCategoriesAction}
            dismiss={dismissMergeAction}
          />
        </SettingsSection>
      )}
      {/* The groups and categories are on Expenses › Categories (categories-and-rules.md §5.7). */}
      <SettingsSection title={t("categories.title")} description={t("categories.movedHint")} padded={false}>
        <p className="px-4 py-3 text-sm">
          <Link
            href={"/expenses/categories" as Route}
            className="focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2"
          >
            {t("categories.movedLink")}
          </Link>
        </p>
        {moved.map((source) => (
          <p key={source.provider} className="border-t border-border px-4 py-3 text-sm text-muted">
            {plugin("categories.movedHint", { provider: source.name })}{" "}
            <Link
              href={source.href as Route}
              className="focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2"
            >
              {plugin("settingsOf", { provider: source.name })}
            </Link>
          </p>
        ))}
        {noCategories && (
          <div className="border-t border-border px-4 py-3">
            <DefaultGroupsButton
              groups={DEFAULT_GROUPS.map((group, index) => ({
                key: group.key,
                name: group[ctx.locale],
                examples: group.examples[ctx.locale],
                color: categoryColor(null, index),
              }))}
              create={createDefaultGroupsAction}
            />
          </div>
        )}
      </SettingsSection>
      <SettingsSection title={t("labels.title")} description={t("labels.description")} padded={false}>
        <LabelsCard rows={labelRows} />
      </SettingsSection>
    </SettingsGrid>
  );
}

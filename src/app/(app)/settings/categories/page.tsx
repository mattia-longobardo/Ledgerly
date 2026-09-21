import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  colorOfCategory,
  listCategoriesWithUsage,
  listLabelsWithUsage,
} from "@/modules/transactions/taxonomy";
import { requireSession } from "@/platform/auth/session";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { type CategoryGroup, type CategoryNode, CategoryTree } from "./category-tree";
import { type LabelRow, LabelsCard } from "./labels-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.categories")} · ${t("title")}` };
}

/**
 * Settings › Categories (spec §7.2): the whole taxonomy in one place — the tree of groups and
 * sub-categories, and the labels, which are the same kind of thing and were a page away.
 *
 * Archived rows are fetched as well: the tree decides whether to show them. A synced category is
 * adopted by name (§9.1), so knowing that a name is taken by something put away is worth seeing.
 */
export default async function SettingsCategoriesPage() {
  const ctx = await requireSession();
  const [t, categories, labels] = await Promise.all([
    getTranslations("settings"),
    listCategoriesWithUsage(ctx, { includeArchived: true }),
    listLabelsWithUsage(ctx),
  ]);

  const byId = new Map(categories.map(({ category }) => [category.id, category]));
  const node = ({ category, usage }: (typeof categories)[number]): CategoryNode => ({
    id: category.id,
    name: category.name,
    parentId: category.parentId,
    type: category.type,
    color: colorOfCategory(category, byId),
    chosenColor: category.color,
    archived: category.archivedAt !== null,
    usage,
  });

  // `listCategoriesWithUsage` already hands them back in tree order, each group followed by its
  // own children (F2.5), so the grouping below is a fold and not a sort.
  const groups: CategoryGroup[] = [];
  for (const row of categories) {
    if (row.category.parentId === null) {
      groups.push({ group: node(row), children: [] });
      continue;
    }
    const owner = groups.find((one) => one.group.id === row.category.parentId);
    owner?.children.push(node(row));
  }

  const labelRows: LabelRow[] = labels.map(({ label, usage }) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    usage,
  }));

  return (
    <SettingsGrid>
      <SettingsSection title={t("categories.title")} description={t("categories.description")} padded={false}>
        <CategoryTree groups={groups} />
      </SettingsSection>
      <SettingsSection title={t("labels.title")} description={t("labels.description")} padded={false}>
        <LabelsCard rows={labelRows} />
      </SettingsSection>
    </SettingsGrid>
  );
}

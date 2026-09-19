import { getTranslations } from "next-intl/server";
import { listCategoriesWithUsage, listLabelsWithUsage } from "@/modules/transactions/taxonomy";
import { requireSession } from "@/platform/auth/session";
import { SettingsSection } from "@/ui/section";
import { CategoriesCard, type CategoryRow } from "./categories-card";
import { LabelsCard, type LabelRow } from "./labels-card";

/**
 * The two Settings › Data sections of spec §7.2, grafted into the page that F1's snapshot log
 * already owns. Archived categories are fetched as well: the cards decide whether to show them.
 */
export async function TaxonomyPanels() {
  const ctx = await requireSession();
  const t = await getTranslations("settings.data");
  const [categories, labels] = await Promise.all([
    listCategoriesWithUsage(ctx, { includeArchived: true }),
    listLabelsWithUsage(ctx),
  ]);

  const nameOf = new Map(categories.map(({ category }) => [category.id, category.name]));
  const parents = new Set(categories.map(({ category }) => category.parentId));
  const categoryRows: CategoryRow[] = categories.map(({ category, usage, depth }) => ({
    id: category.id,
    name: category.name,
    parentId: category.parentId,
    parentName: category.parentId === null ? null : (nameOf.get(category.parentId) ?? null),
    type: category.type,
    color: category.color,
    archived: category.archivedAt !== null,
    usage,
    depth,
    hasChildren: parents.has(category.id),
  }));
  const labelRows: LabelRow[] = labels.map(({ label, usage }) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    usage,
  }));

  return (
    <>
      <SettingsSection
        title={t("categories.title")}
        description={t("categories.description")}
        padded={false}
        wide
      >
        <CategoriesCard rows={categoryRows} />
      </SettingsSection>
      <SettingsSection title={t("labels.title")} description={t("labels.description")} padded={false}>
        <LabelsCard rows={labelRows} />
      </SettingsSection>
    </>
  );
}

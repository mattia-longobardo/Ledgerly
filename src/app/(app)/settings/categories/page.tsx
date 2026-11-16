import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  colorOfCategory,
  listCategoriesWithUsage,
  listLabelsWithUsage,
} from "@/modules/transactions/taxonomy";
import { createDefaultGroupsAction, dismissMergeAction } from "@/modules/transactions/categorize/actions";
import { DEFAULT_GROUPS } from "@/modules/transactions/categorize/tables";
import { categoryColor } from "@/modules/transactions/ui/display";
import { requireSession } from "@/platform/auth/session";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { type CategoryGroup, type CategoryNode, CategoryTree } from "./category-tree";
import { mergeCategoriesAction } from "./actions";
import { DefaultGroupsButton } from "./default-groups";
import { type LabelRow, LabelsCard } from "./labels-card";
import { mergeProposalsView } from "./merge";
import { type MergeSide, MergeProposals } from "./merge-proposals";
import { sourceCategorySections, sourceNotes } from "./source";
import {
  keepSourceCategoryAction,
  setSourceCategoryAction,
  undoSourceCategoryAction,
} from "./source-actions";
import { SourceCategories, type SourceCategoryCommands } from "./source-categories";

/** The writes of "Categories of {source}", handed to the component: actions of the application. */
const SOURCE_COMMANDS: SourceCategoryCommands = {
  set: setSourceCategoryAction,
  undo: undoSourceCategoryAction,
  keep: keepSourceCategoryAction,
};

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
  const [t, categories, labels, proposals, sources, notes] = await Promise.all([
    getTranslations("settings"),
    listCategoriesWithUsage(ctx, { includeArchived: true }),
    listLabelsWithUsage(ctx),
    mergeProposalsView(ctx),
    sourceCategorySections(ctx),
    sourceNotes(ctx),
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
    source: notes.has(category.id)
      ? { name: notes.get(category.id)?.source ?? "", names: notes.get(category.id)?.names ?? [] }
      : null,
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

  // What a source's category may be matched to: the categories in use, in tree order, by kind.
  const matchable = categories
    .filter(({ category }) => category.archivedAt === null)
    .map(({ category }) => ({
      id: category.id,
      name: category.name,
      color: colorOfCategory(category, byId),
      depth: (category.parentId === null ? 0 : 1) as 0 | 1,
      type: category.type,
    }));
  const sourceSections = sources.map((section) => ({
    provider: section.provider,
    name: section.name,
    rows: section.rows.map((row) => {
      const counted = row.categoryId === null ? undefined : byId.get(row.categoryId);
      // The kind of a source's category is the kind of the category it counts under.
      const type = counted?.type ?? "expense";
      return {
        id: row.id,
        name: row.name,
        nested: row.groupName !== null && row.groupName !== row.name,
        count: row.count,
        isNew: row.isNew,
        choice: row.choice,
        category:
          row.choice === "matched" && counted
            ? { id: counted.id, name: counted.name, color: colorOfCategory(counted, byId) }
            : null,
        options: matchable.filter((option) => option.type === type),
      };
    }),
  }));

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
      <SettingsSection title={t("categories.title")} description={t("categories.description")} padded={false}>
        <CategoryTree groups={groups} />
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
      {sourceSections.map((section) => (
        <SettingsSection
          key={section.provider}
          title={t("categories.source.title", { provider: section.name })}
          description={t("categories.source.description", { provider: section.name })}
          padded={false}
        >
          <SourceCategories source={section.name} rows={section.rows} commands={SOURCE_COMMANDS} />
        </SettingsSection>
      ))}
      <SettingsSection title={t("labels.title")} description={t("labels.description")} padded={false}>
        <LabelsCard rows={labelRows} />
      </SettingsSection>
    </SettingsGrid>
  );
}

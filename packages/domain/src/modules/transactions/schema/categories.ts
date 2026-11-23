import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { users } from "../../../platform/auth/schema";
import { CATEGORY_TYPES } from "../rules";
import type { RuleCondition } from "../categorize/user-rules";
import { inList } from "../../../platform/db/checks";

/**
 * Spending categories (spec §6), on two levels since F2.5: a group (no parent) and its
 * sub-categories. Unique on the name **among siblings**, because that is what adoption keys on
 * (spec §9.1) — "Other" under two groups is two categories — and `NULLS NOT DISTINCT` makes the
 * groups siblings of one another. An archived category keeps its name, so adoption never
 * resurrects it by accident.
 *
 * The two generated columns are how the database itself refuses a third level: a child points at
 * `(parent_id, true)`, and only a row without a parent has `is_root = true`. Giving a parent to a
 * group that has children fails too, because the key its children point at would change under
 * them. The key has no `ON DELETE` action — Postgres allows none on a key with a generated column —
 * and needs none: a category is archived, never deleted (spec §7.2), and deleting a user takes a
 * group and its children away in the same statement.
 */
export const categories = pgTable(
  "categories",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    isRoot: boolean("is_root").generatedAlwaysAs(sql`parent_id is null`),
    parentIsRoot: boolean("parent_is_root").generatedAlwaysAs(
      sql`case when parent_id is null then null else true end`,
    ),
    /**
     * The person chose this category's group — or no group — by hand (spec §7.2: local edits win).
     * The sync then never files it under the provider's group again; without it, taking a source's
     * category out of its group was undone by the next hourly pass.
     */
    parentSetLocally: boolean("parent_set_locally").notNull().default(false),
    /**
     * The fields the person changed here, exactly as `transactions.locally_edited` records them
     * (spec §7.2). Since the two-way category sync it means something more precise than "never
     * overwrite this again": a `name` in this list is what makes the local name **win**, and the
     * next pass writes it to the source (`movements/categories.ts` of plugin-host) and then clears
     * the marker, because once the source has been told the two agree and a later rename *there* is
     * free to come back here. `type` never leaves: the source has no notion of income or expense, so a
     * type chosen here is local for ever.
     */
    locallyEdited: text("locally_edited")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * The name the source published for this category the last time the two sides agreed — the
     * baseline of the three-way merge, and the only way to tell "only here changed" from "both
     * changed" (which is reported, spec §7.2). `null` for a category the source has never seen, and
     * for the rows that predate this column: those fall back to "a local edit wins, otherwise
     * the source's name is adopted", which is what the one-way sync did.
     */
    providerName: text("provider_name"),
    type: text("type", { enum: CATEGORY_TYPES }).notNull().default("expense"),
    color: text("color"),
    archivedAt: moment("archived_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("categories_id_root_uq").on(table.id, table.isRoot),
    foreignKey({
      name: "categories_parent_fk",
      columns: [table.parentId, table.parentIsRoot],
      foreignColumns: [table.id, table.isRoot],
    }),
    unique("categories_user_parent_name_uq").on(table.userId, table.parentId, table.name).nullsNotDistinct(),
    index("categories_user_name_idx").on(table.userId, table.name),
    index("categories_parent_idx").on(table.parentId),
    check("categories_type_ck", sql`${table.type} in (${sql.raw(inList(CATEGORY_TYPES))})`),
    check("categories_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
  ],
);

/** Free-form labels, matched to the provider's by name (spec §9.1). */
export const labels = pgTable(
  "labels",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("labels_user_name_uq").on(table.userId, table.name),
    check("labels_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
  ],
);

/**
 * A category of a source that gives its own (rewrite plan N3.1, 12-account-modes.md §12.3), and the
 * category it counts under here. `addedCategoryId` is the category that was added for it, with its
 * name; `categoryId` is where its movements count: the same one ("added"), or another category the
 * person chose ("matched"). Several rows may name one category, a row names one.
 *
 * `seenAt` is null for a category that arrived from the source and the person has not looked at
 * yet: the "New" mark. One person's, and it goes with them.
 */
export const sourceCategories = pgTable(
  "source_categories",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    /** What the source calls the category, and the group it files it under. */
    name: text("name").notNull(),
    groupName: text("group_name"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    addedCategoryId: uuid("added_category_id").references(() => categories.id, { onDelete: "set null" }),
    seenAt: moment("seen_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("source_categories_external_uq").on(table.userId, table.provider, table.externalId),
    index("source_categories_category_idx").on(table.userId, table.categoryId),
  ],
);

/** What "Undo" puts back after a change of a source category's match (`source-categories.ts`). */
export interface SourceCategoryUndo {
  categoryId: string | null;
  /** Whether the category added for it was put away before the change. */
  addedArchived: boolean;
  /** The limits of the budgets as they were, when the change summed them: `null` when it did not. */
  limits: {
    month: string;
    categoryIds: string[];
    rows: {
      categoryId: string;
      accountId: string | null;
      fromMonth: string;
      amountCents: string | null;
      stopped: boolean;
    }[];
  } | null;
}

/** The state before the last change of a source category's match, for "Undo": one row a change. */
export const sourceCategoryUndos = pgTable(
  "source_category_undos",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceCategoryId: uuid("source_category_id")
      .notNull()
      .references(() => sourceCategories.id, { onDelete: "cascade" }),
    before: jsonb("before").$type<SourceCategoryUndo>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [index("source_category_undos_user_idx").on(table.userId, table.createdAt)],
);

/**
 * A rule of the person's (categories-and-rules.md §4): conditions, all true, give a category, and
 * may add labels and a note. Ordered by `position`; the first active rule that matches decides
 * (QC5). A rule deleted from the interface keeps its row for a while (`deletedAt`), so "Undo"
 * finds it with every movement still tied to it.
 */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    active: boolean("active").notNull().default(true),
    // Validated by `ruleInputSchema` (`categorize/user-rules.ts`) on every write and every read.
    conditions: jsonb("conditions").$type<RuleCondition[]>().notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    labelIds: jsonb("label_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    deletedAt: moment("deleted_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("category_rules_user_idx").on(table.userId, table.position),
    index("category_rules_category_idx").on(table.categoryId),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { users } from "../../../platform/auth/schema";
import { type TransactionType } from "../rules";
import { categories } from "./categories";

/* The automatic categories (rewrite plan N3, 04-now.md §4.4). Everything below is one person's:
   it goes with them (`on delete cascade`), and none of it is in an export, the API or MCP. */

/**
 * The strict memory: the texts a person or a source put in the same category the last three
 * times. Rewritten at every training from the confirmed labels (`strictMemory`).
 */
export const categoryMemory = pgTable(
  "category_memory",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    updatedAt: moment("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "category_memory_pk", columns: [table.userId, table.key] })],
);

/**
 * A person's classifier, one row: the model as it was last trained, its two thresholds, and what it
 * was trained from — so a reading that brings no new label trains nothing again. `preparing` is
 * true while a pass of the cascade is running, for the screen that waits for it.
 */
export const categoryModels = pgTable("category_models", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  /** How many confirmed labels the model was trained from, and the newest of them. */
  examples: integer("examples").notNull().default(0),
  labelledThrough: moment("labelled_through"),
  automaticThreshold: real("automatic_threshold"),
  suggestionThreshold: real("suggestion_threshold"),
  /** PERS-634: the least confidence at which a group is suggested, when the sub-category is not. */
  groupThreshold: real("group_threshold"),
  model: jsonb("model"),
  preparing: boolean("preparing").notNull().default(false),
  trainedAt: moment("trained_at"),
  updatedAt: updatedAtColumn(),
});

/**
 * Labels with no movement (PERS-634, decision 13A): a category a person gave a text somewhere else
 * — the export of the app they kept their money in before — that the classifier and the memory learn from like a
 * confirmed movement. No movement, no balance and no total is ever made from one. A new import of
 * a source replaces its rows.
 */
export const categoryLabels = pgTable(
  "category_labels",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Where the labels came from: `export`, the only one today. */
    source: text("source").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"income" | "expense">().notNull(),
    payee: text("payee"),
    note: text("note"),
    /** Signed as a movement's: an expense is negative. */
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    occurredAt: moment("occurred_at").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("category_labels_user_idx").on(table.userId, table.source),
    check("category_labels_kind_ck", sql`${table.kind} in ('income', 'expense')`),
  ],
);

/** The category a person made from a default group: what a static table points at for them. */
export const categoryGroupMarks = pgTable(
  "category_group_marks",
  {
    categoryId: uuid("category_id")
      .primaryKey()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupKey: text("group_key").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [unique("category_group_marks_user_group_uq").on(table.userId, table.groupKey)],
);

/** Two categories a person said are not the same: the proposal to merge them does not come back. */
export const categoryMergeDismissals = pgTable(
  "category_merge_dismissals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The two ids in order, the smaller first: a pair is one row whichever way it is said. */
    firstId: uuid("first_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    secondId: uuid("second_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({
      name: "category_merge_dismissals_pk",
      columns: [table.userId, table.firstId, table.secondId],
    }),
  ],
);

/** What a movement's category was before an action on several movements, for "Undo". */
export interface CategoryUndoRow {
  id: string;
  categoryId: string | null;
  categoryOrigin: string | null;
  categoryConfidence: number | null;
  categoryModelVersion: number | null;
  suggestedCategoryId: string | null;
  categoryReason: string | null;
  categoryReasonParams: Record<string, string> | null;
  /** Absent on the rows written before the rules (N3.4). */
  categoryRuleId?: string | null;
  locallyEdited: string[];
  /** The category the action wrote: "Undo" puts back only a movement that still carries it. Absent on older rows. */
  appliedCategoryId?: string | null;
}

/**
 * The state before an action on several movements (a group of "To review", "Apply to N"): "Undo"
 * puts it back and removes the row. Kept on the server so a browser never says what a movement's
 * category was. Old rows are removed when a new one is written.
 */
export const categoryUndos = pgTable(
  "category_undos",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rows: jsonb("rows").$type<CategoryUndoRow[]>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [index("category_undos_user_idx").on(table.userId, table.createdAt)],
);

/** What a movement was before "Apply to existing transactions" of a rule (categories-and-rules.md §4.6). */
export interface RuleUndoRow extends CategoryUndoRow {
  /** The rule "Apply" wrote: "Undo" puts back only a movement that still carries it. */
  appliedRuleId: string;
  categoryKey: string | null;
  type: TransactionType;
  /** The note before, put back only when the rule wrote one. */
  note: string | null;
  wroteNote: boolean;
  /** The note the rule wrote, when it wrote one. */
  appliedNote: string | null;
  /** The labels the rule added: "Undo" takes these off and no other. */
  addedLabelIds: string[];
}

/** The state before "Apply" of a rule, for its "Undo"; old rows are removed when a new one is written. */
export const categoryRuleUndos = pgTable(
  "category_rule_undos",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rows: jsonb("rows").$type<RuleUndoRow[]>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [index("category_rule_undos_user_idx").on(table.userId, table.createdAt)],
);

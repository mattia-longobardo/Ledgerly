// The columns of time off from before the kinds became data (rewrite plan R5g, decision 2 = A).
// They stay, and stay written, so the image before R5g still reads a true year: R5f drops them
// with their checks. Nothing reads them since R5g. This file is the one known entry of rule M12
// for the module (it names the old kinds and the old calendar) until then.
import { sql } from "drizzle-orm";
import { check, numeric, pgTable, smallint, text, unique, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "../../../platform/db/columns";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";

/**
 * Where a row of `leave_days` came from: `external` since R5c; the old value of the calendar's
 * days is no longer written (R5f drops it).
 */
export const LEAVE_ORIGINS = ["manual", "trek", "external"] as const;

/** The values of the old `leave_days.kind`: a type keeps its own as data (`leave_types.legacy_kind`). */
export const LEGACY_KINDS = ["vacation", "rol", "comp", "sick", "other"] as const;
type LegacyKind = (typeof LEGACY_KINDS)[number];

/** The words the old `trek_kind` column took: any other word is written in `external_kind` only. */
const LEGACY_CALENDAR_KINDS = ["vacation", "comp"] as const;

/** The legacy kind a type writes, when it has one of the old values. */
export function legacyKind(value: string | null): LegacyKind | null {
  return LEGACY_KINDS.find((one) => one === value) ?? null;
}

/** The old observed kind of a word the calendar used, when the old column takes it. */
export function legacyObservedKind(word: string | null): (typeof LEGACY_CALENDAR_KINDS)[number] | null {
  return LEGACY_CALENDAR_KINDS.find((one) => one === word) ?? null;
}

/** The old column of the year's allowance a type with a legacy kind writes, beside its own row. */
export function legacyAllowanceField(value: string | null): "vacationDays" | "rolDays" | null {
  if (value === LEGACY_KINDS[0]) return "vacationDays";
  if (value === LEGACY_KINDS[1]) return "rolDays";
  return null;
}

/** The old columns of `leave_days`, spread into its table. */
export function legacyLeaveDayColumns() {
  return {
    /** Nullable since R5g: a type made after it has no old kind. */
    kind: text("kind", { enum: LEGACY_KINDS }),
    observedFraction: numeric("trek_fraction", { precision: 2, scale: 1 }),
    observedKind: text("trek_kind", { enum: LEGACY_CALENDAR_KINDS }),
  };
}

/** The old constraints of `leave_days`, kept as they are. */
export function legacyLeaveDayChecks(table: {
  userId: AnyPgColumn;
  on: AnyPgColumn;
  kind: AnyPgColumn;
  observedKind: AnyPgColumn;
}) {
  return [
    unique("leave_days_user_on_kind_uq").on(table.userId, table.on, table.kind),
    check("leave_days_kind_ck", sql`${table.kind} in (${sql.raw(inList(LEGACY_KINDS))})`),
    check(
      "leave_days_trek_kind_ck",
      sql`${table.observedKind} is null or ${table.observedKind} in (${sql.raw(inList(LEGACY_CALENDAR_KINDS))})`,
    ),
  ];
}

/**
 * The allowance of a year with its two fixed parts, from before the allowances by type
 * (`leave_allowances`). Written beside them for the types with a legacy kind; `total_days` is no
 * longer written.
 */
export const timeoffAllowances = pgTable(
  "timeoff_allowances",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    vacationDays: numeric("vacation_days", { precision: 5, scale: 2 }),
    rolDays: numeric("rol_days", { precision: 5, scale: 2 }),
    totalDays: numeric("total_days", { precision: 5, scale: 2 }),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("timeoff_allowances_user_year_uq").on(table.userId, table.year),
    check("timeoff_allowances_year_ck", sql`${table.year} between 1990 and 2200`),
    check(
      "timeoff_allowances_vacation_ck",
      sql`${table.vacationDays} is null or ${table.vacationDays} between 0 and 400`,
    ),
    check("timeoff_allowances_rol_ck", sql`${table.rolDays} is null or ${table.rolDays} between 0 and 400`),
    check(
      "timeoff_allowances_total_ck",
      sql`${table.totalDays} is null or ${table.totalDays} between 0 and 400`,
    ),
    check("timeoff_allowances_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
  ],
);

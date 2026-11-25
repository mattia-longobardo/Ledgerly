import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The compatibility rule of the rewrite plan (docs/design/rewrite-plan/06-data.md §6.2, rule 4):
// the schema of a release works with the image of the release before it, so a rollback of the
// image never needs the dump. A migration of the plan therefore only adds. This test reads every
// migration from the first of the plan on and fails on a statement that takes something away,
// unless a written decision of the plan allows that one statement.

const FOLDER = join(process.cwd(), "drizzle");
/** The last migration before the rewrite plan: the ones up to it are history. */
const LAST_BEFORE_PLAN = 45;

/**
 * The statements a written decision allows, by file and by the words that open them. The plan
 * names N2 (one unique key), R5f (the clean-up) and step A4 of N6 (rows of documents), and each
 * adds its line here with the commit that writes its migration.
 */
const ALLOWED: Record<string, readonly string[]> = {
  // N2, second half of the two-step change (06-data.md §6.1): the image of N1 already writes
  // with the key on (user, provider, instance).
  "0052_connection_status_cleanup.sql": [
    'ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_user_provider_uq"',
  ],
  // R5f.2, the clean-up (06-data.md §6.1; the proposal approved by Mattia, 2 = A, 3 = A, 4 = A, 5 = A):
  // what N6, R5a, R5b, R5c and R5g made useless and R5f.1 stopped reading, with the checks of it.
  "0077_r5f_cleanup.sql": [
    'DELETE FROM "job_runs" WHERE "tier" = \'quarter\'',
    'DROP TABLE "fund_deposit_rules"',
    'DROP TABLE "fund_deposits"',
    'DROP TABLE "fund_fee_tariffs"',
    'DROP TABLE "pension_rules"',
    'DROP TABLE "timeoff_allowances"',
    'ALTER TABLE "funds" DROP',
    'ALTER TABLE "fund_operations" DROP CONSTRAINT "fund_operations_document_id_documents_id_fk"',
    'ALTER TABLE "fund_operations" DROP COLUMN "document_id"',
    'ALTER TABLE "position_snapshots" DROP CONSTRAINT "position_snapshots_document_id_documents_id_fk"',
    'ALTER TABLE "position_snapshots" DROP COLUMN "document_id"',
    'ALTER TABLE "pension_competences" DROP COLUMN "payslip_type"',
    'ALTER TABLE "pension_competences" ALTER COLUMN "kind" SET NOT NULL',
    'ALTER TABLE "payslips" DROP',
    'ALTER TABLE "payslips" ALTER COLUMN "kind" SET NOT NULL',
    'ALTER TABLE "interest_rules" DROP',
    'ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_patron',
    'ALTER TABLE "user_preferences" DROP COLUMN "patron_',
    'ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_user_on_kind_uq"',
    'ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_kind_ck"',
    'ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_trek_kind_ck"',
    'ALTER TABLE "leave_days" DROP COLUMN',
    'ALTER TABLE "leave_days" ALTER COLUMN "type_id" SET NOT NULL',
    'ALTER TABLE "leave_types" DROP COLUMN "legacy_kind"',
  ],
};

const migrations = readdirSync(FOLDER)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) > LAST_BEFORE_PLAN)
  .sort();

/** The statements of a file, comments out: a `DO` block gives its own statements one by one. */
function statementsOf(file: string): string[] {
  return readFileSync(join(FOLDER, file), "utf8")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement !== "");
}

const FORBIDDEN: readonly { what: string; pattern: RegExp }[] = [
  { what: "drops a table", pattern: /\bDROP TABLE\b/i },
  { what: "drops a column", pattern: /\bDROP COLUMN\b/i },
  { what: "renames", pattern: /\bRENAME\b/i },
  { what: "changes a type", pattern: /\bALTER COLUMN "?\w+"? (SET DATA )?TYPE\b/i },
  { what: "sets NOT NULL on a column that exists", pattern: /\bSET NOT NULL\b/i },
  { what: "deletes with no WHERE", pattern: /^DELETE FROM\b(?!.*\bWHERE\b)/i },
  { what: "updates with no WHERE", pattern: /^UPDATE\b(?!.*\bWHERE\b)/i },
];

describe("the migrations of the rewrite plan (06-data.md §6.2)", () => {
  it("has migrations to read", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  // Drizzle applies a migration only when its `when` is after the last one applied: an earlier one
  // is skipped without an error (R5f.1's first deploy). The journal's times only grow.
  it("are in the journal with times that only grow", () => {
    const { entries } = JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const late = entries.filter((entry, index) => index > 0 && entry.when <= entries[index - 1].when);
    expect(late.map((entry) => entry.tag)).toEqual([]);
  });

  it.each(migrations)("%s only adds", (file) => {
    const statements = statementsOf(file);
    const allowed = ALLOWED[file] ?? [];
    const found = statements.flatMap((statement) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(statement))
        .filter(() => !allowed.some((start) => statement.startsWith(start)))
        .map(({ what }) => `${what}: ${statement.slice(0, 90)}`),
    );
    expect(found).toEqual([]);
  });

  it.each(migrations)("%s replaces a check only with one written in the same migration", (file) => {
    // A wider check takes every value the old one took (N6: `rule`, a month as a period): the old
    // image keeps working. It is allowed only when the migration writes the new check itself, in
    // its own transaction, so the column is never left unchecked.
    const allowed = ALLOWED[file] ?? [];
    const text = statementsOf(file)
      .filter((statement) => !allowed.some((start) => statement.startsWith(start)))
      .join(";\n");
    const dropped = [...text.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?"([^"]+)"/gi)].map((match) => match[1]);
    const added = new Set([...text.matchAll(/ADD CONSTRAINT "([^"]+)"/gi)].map((match) => match[1]));
    expect(dropped.filter((name) => !added.has(name))).toEqual([]);
  });
});

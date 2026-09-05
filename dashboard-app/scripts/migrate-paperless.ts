import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { payrollComponents, payrollImports, payrollRecords, payslips, userRoles, users } from "@/lib/db/schema";
import { downloadOriginal } from "@/lib/clients/paperless";
import { componentsFromExtraction, grossOf, netOf } from "@/modules/payroll/domain/components";
import { looksLikePdf, newStorageKey, sha256Hex } from "@/modules/payroll/domain/document";
import { DEFAULT_MAPPING_RULES } from "@/modules/payroll/domain/mapping";
import { isMigratable, mapLegacyPayslip, type LegacyPayslip } from "@/modules/payroll/infrastructure/paperless-import";
import { storeFromDriver } from "@/modules/payroll/infrastructure/document-store-resolver";
import { withSystemContext } from "@/platform/db/context";

/**
 * One-shot migration of the verified Paperless payslips into the payroll
 * module (spec §10.2).
 *
 * Deployment wave 1 (Ruling R4-7): this runs on the image built at this commit,
 * while `src/lib/clients/paperless.ts` and `PAPERLESS_URL`/`PAPERLESS_TOKEN`
 * still exist. Task 22 deletes them, so re-running it afterwards is impossible
 * by construction — which is why the reconciliation report it writes is the
 * artefact that outlives it.
 *
 * Idempotent: an import whose sha256 already exists for the owner is reused
 * rather than duplicated (the same `(user_id, sha256)` index the live upload
 * path relies on), and a record whose import already has one is recomputed. Run
 * it twice and the second run reports everything reused and writes the same
 * figures.
 *
 * Per payslip, the Paperless download and the document-store upload both
 * happen outside any database transaction — they are slow network round trips
 * to two different external systems, and holding a pooled Postgres connection
 * open for the length of either (let alone both, across every payslip in the
 * batch) is exactly the discipline this phase's "no I/O inside an open
 * transaction" rule exists to prevent. Each payslip instead opens two short
 * `withSystemContext` transactions: one to check whether its bytes are already
 * stored (so the upload can be skipped), and — once any upload has finished —
 * one to write that payslip's `payroll_imports`/`payroll_records`/
 * `payroll_components` rows. Neither transaction ever waits on Paperless or the
 * document store.
 *
 * Deliberately does not import `db` from `@/lib/db`: that module is a Proxy
 * whose first property access calls `env()`, which requires the whole app's
 * environment. It builds its own client from `DATABASE_URL`, exactly as
 * `scripts/migrate-teable.ts` does, so it runs with only the variables listed
 * below.
 */

const USAGE = `Usage: npm run migrate:paperless -- [--dry-run] [--out <dir>]

Downloads the original PDF of every verified payslip from Paperless, stores it
in the payroll document store, and creates the matching payroll_imports,
payroll_records and payroll_components rows.

Options:
  --dry-run   Read everything and print the plan, but write nothing.
  --out <dir> Where the reconciliation report is written. Defaults to the
              repository's docs/migration/ directory, which does not exist
              inside the container image.
  --help      Show this message.

Environment:
  DATABASE_URL                    The database to migrate (required).
  PAPERLESS_URL, PAPERLESS_TOKEN  Required: the originals are pulled from here.
  DOCUMENT_STORE_DRIVER           silo (default) or local.
  DOCUMENT_STORE_LOCAL_PATH       Required for the local driver.
  SILO_ENDPOINT, SILO_BUCKET, SILO_REGION,
  SILO_ACCESS_KEY_ID, SILO_SECRET_ACCESS_KEY
                                  Required for the silo driver. Read from the
                                  environment rather than from the integration
                                  connection, because this script runs before
                                  anybody has connected one.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const dryRun = argv.includes("--dry-run");
const outIndex = argv.indexOf("--out");
const outDir = outIndex === -1 ? join(process.cwd(), "..", "docs", "migration") : argv[outIndex + 1]!;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function resolveStore() {
  const driver = (process.env.DOCUMENT_STORE_DRIVER ?? "silo") as "silo" | "local";
  const resolution = storeFromDriver({
    driver,
    localPath: process.env.DOCUMENT_STORE_LOCAL_PATH,
    // The script is not the app; the read-only-container guard does not apply
    // to a one-off run on an operator's shell.
    nodeEnv: "development",
    credentials:
      driver === "silo"
        ? {
            endpoint: process.env.SILO_ENDPOINT ?? "",
            bucket: process.env.SILO_BUCKET ?? "",
            region: process.env.SILO_REGION ?? "us-east-1",
            accessKeyId: process.env.SILO_ACCESS_KEY_ID ?? "",
            secretAccessKey: process.env.SILO_SECRET_ACCESS_KEY ?? "",
          }
        : null,
  });
  if (!resolution) {
    console.error("No document store could be resolved. See --help for the variables it needs.");
    process.exit(1);
  }
  return resolution;
}

interface Outcome {
  payslipId: number;
  month: string;
  isThirteenth: boolean;
  result: "migrated" | "reused" | "skipped_not_verified" | "failed";
  importId?: string;
  recordId?: string;
  sha256?: string;
  net?: string | null;
  legacyNet?: string | null;
  error?: string;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const resolution = resolveStore();
  const rules = DEFAULT_MAPPING_RULES.map((r, i) => ({ ...r, id: `global-${String(i).padStart(3, "0")}`, userId: null }));

  // The single owner, the same assumption `monthly-close.ts` has held since
  // Phase 1. Phase 8 revisits it when users become plural in more than schema.
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleCode, "owner"))
    .limit(1);
  if (!owner) {
    console.error("No owner user found. Run the Phase 0/1 owner seed first.");
    process.exit(1);
  }

  const legacy = (await db.select().from(payslips).orderBy(asc(payslips.month))) as unknown as LegacyPayslip[];
  const outcomes: Outcome[] = [];

  for (const row of legacy) {
    if (!isMigratable(row)) {
      outcomes.push({ payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth, result: "skipped_not_verified" });
      continue;
    }
    const mapped = mapLegacyPayslip(row);
    try {
      // Network I/O #1: Paperless. Outside any transaction.
      const downloaded = await downloadOriginal(row.paperlessDocId);
      const bytes = new Uint8Array(downloaded.data);
      if (!looksLikePdf(bytes)) throw new Error(`document ${row.paperlessDocId} is not a PDF`);
      const sha256 = sha256Hex(bytes);

      if (dryRun) {
        outcomes.push({
          payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
          result: "migrated", sha256, legacyNet: row.net, net: row.net,
        });
        continue;
      }

      // Short transaction #1: is this sha256 already stored for the owner?
      // A plain read, opened and closed immediately — no network I/O inside it.
      const existingImport = await withSystemContext(db, async (tx) => {
        const [found] = await tx.select().from(payrollImports).where(eq(payrollImports.sha256, sha256)).limit(1);
        return found ?? null;
      });

      // Network I/O #2: the document store. Outside any transaction, and
      // skipped entirely when the bytes are already there (idempotency).
      let storageKey: string | null = null;
      if (!existingImport) {
        storageKey = newStorageKey(owner.id, new Date(`${row.month}T12:00:00Z`));
        await resolution.store.put(storageKey, bytes, "application/pdf");
      }

      // Short transaction #2: write this one payslip's rows. Both network
      // calls above have already finished by the time this opens.
      const written = await withSystemContext(db, async (tx) => {
        let importId: string;
        let reused: boolean;
        if (existingImport) {
          importId = existingImport.id;
          reused = true;
        } else {
          const [created] = await tx
            .insert(payrollImports)
            .values({
              userId: owner.id,
              status: "applied",
              fileName: mapped.fileName,
              mime: "application/pdf",
              sizeBytes: bytes.byteLength,
              sha256,
              storageProvider: resolution.driver,
              storageKey: storageKey!,
              textSource: "pdf_text",
              parserVersion: mapped.extraction.parserVersion,
              extraction: mapped.extraction,
              confidence: Object.fromEntries(Object.keys(mapped.extraction.fields).map((f) => [f, "high"])),
              // The originals predate the boundary. Recording `none` as the
              // scanner is the honest answer (Ruling R4-2): nothing scanned
              // them, and the row says so rather than implying something did.
              scanStatus: "clean",
              scanner: "none",
              scannedAt: new Date(),
              retentionUntil: new Date(`${Number(row.month.slice(0, 4)) + 10}-01-01T00:00:00Z`),
              uploadedVia: "migration",
            })
            .returning();
          importId = created!.id;
          reused = false;
        }

        const components = componentsFromExtraction(mapped.extraction, rules);
        const [existingRecord] = await tx.select().from(payrollRecords).where(eq(payrollRecords.importId, importId)).limit(1);
        let recordId: string;
        if (existingRecord) {
          recordId = existingRecord.id;
          await tx
            .update(payrollRecords)
            .set({ gross: grossOf(components), net: netOf(components), updatedAt: new Date() })
            .where(eq(payrollRecords.id, recordId));
        } else {
          const [record] = await tx
            .insert(payrollRecords)
            .values({
              userId: owner.id,
              importId,
              periodStart: mapped.periodStart,
              periodEnd: mapped.periodEnd,
              kind: mapped.kind,
              currency: "EUR",
              gross: grossOf(components),
              net: netOf(components),
              verifiedAt: mapped.verifiedAt,
              verifiedBy: owner.id,
              corrections: mapped.legacySource as unknown as Record<string, unknown>,
            })
            .returning();
          recordId = record!.id;
        }
        await tx.delete(payrollComponents).where(eq(payrollComponents.recordId, recordId));
        if (components.length > 0) {
          await tx.insert(payrollComponents).values(components.map((c) => ({ ...c, recordId })));
        }
        return { importId, recordId, reused };
      });

      outcomes.push({
        payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
        result: written.reused ? "reused" : "migrated",
        importId: written.importId, recordId: written.recordId, sha256,
        legacyNet: row.net, net: row.net,
      });
    } catch (err) {
      outcomes.push({
        payslipId: row.id, month: row.month, isThirteenth: row.isThirteenth,
        result: "failed", error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const migrated = outcomes.filter((o) => o.result === "migrated").length;
  const reused = outcomes.filter((o) => o.result === "reused").length;
  const skipped = outcomes.filter((o) => o.result === "skipped_not_verified").length;
  const failed = outcomes.filter((o) => o.result === "failed");

  mkdirSync(outDir, { recursive: true });
  const report = [
    `# Paperless migration reconciliation`,
    ``,
    `Run at ${new Date().toISOString()}${dryRun ? " (dry run — nothing was written)" : ""}.`,
    ``,
    `- Legacy payslips seen: ${outcomes.length}`,
    `- Migrated: ${migrated}`,
    `- Reused (already migrated): ${reused}`,
    `- Skipped, not verified: ${skipped}`,
    `- Failed: ${failed.length}`,
    ``,
    `| Legacy id | Month | 13th | Result | Import | Record | Legacy net | New net |`,
    `|---|---|---|---|---|---|---|---|`,
    ...outcomes.map(
      (o) =>
        `| ${o.payslipId} | ${o.month} | ${o.isThirteenth ? "yes" : "no"} | ${o.result} | ${o.importId ?? "—"} | ${o.recordId ?? "—"} | ${o.legacyNet ?? "—"} | ${o.net ?? "—"} |`,
    ),
    ``,
    ...(failed.length > 0
      ? [`## Failures`, ``, ...failed.map((f) => `- payslip ${f.payslipId} (${f.month}): ${f.error}`), ``]
      : []),
    `Run \`npm run migrate:paperless:validate\` next; it diffs every migrated record against its legacy row and exits non-zero on any mismatch.`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "paperless-reconciliation.md"), report);

  console.log(`migrated=${migrated} reused=${reused} skipped=${skipped} failed=${failed.length}`);
  console.log(`report written to ${join(outDir, "paperless-reconciliation.md")}`);
  await pool.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

void main();

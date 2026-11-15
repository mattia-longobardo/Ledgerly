// scripts/fund-documents.ts — step A4 of release N6 (docs/design/rewrite-plan/11-standardization.md
// §11.2.4, decision H24): the documents a fund's import left are copied, checked and deleted.
//
//   node … scripts/fund-documents.ts count
//   node … scripts/fund-documents.ts copy   --out <release folder>
//   node … scripts/fund-documents.ts verify --out <release folder>
//   node … scripts/fund-documents.ts delete --out <release folder> --yes <number of rows>
//
// Run through `scripts/fund-documents-on-homelab.sh`, next to the deployed app. `copy` writes every
// original under `<folder>/files/`, with the path it has in the store, and `files.sha256`: one line
// per file with its checksum, its size and its path. `verify` reads the store again and compares it
// with the copy and with the checksum each row holds. `delete` runs `verify` first and refuses to go
// on unless it passes and `--yes` is the number of rows it found: files first, then the rows.
//
// The step cannot be undone without the copy and the dump. The copy holds personal documents: it
// stays in `Ledgerly-dumps/`, mode 600, and never goes in a comment or an attachment.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  deleteRetiredDocuments,
  retiredDocuments,
  retiredOriginal,
  RETIRED_KINDS,
} from "../src/modules/imports/retired";
import { getPool } from "../src/platform/db/client";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function argument(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function outFolder(): string {
  const out = argument("--out");
  if (!out) throw new Error("usage: --out <release folder>");
  return out;
}

async function copy(): Promise<void> {
  const out = outFolder();
  const lines: string[] = [];
  for (const document of await retiredDocuments()) {
    const bytes = await retiredOriginal(document);
    if (document.storageKey === null || bytes === null) {
      throw new Error(`document ${document.id} has no original in the store: nothing to copy for it`);
    }
    const file = join(out, "files", document.storageKey);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, bytes, { mode: 0o600 });
    lines.push(`${sha256(bytes)}  ${bytes.length}  ${document.storageKey}`);
  }
  writeFileSync(join(out, "files.sha256"), `${lines.length} files\n${lines.join("\n")}\n`, { mode: 0o600 });
  console.log(`copied: ${lines.length} files`);
}

/** The copy, the store and the rows say the same: the number of files and the checksum of each. */
async function verify(): Promise<number> {
  const out = outFolder();
  const list = join(out, "files.sha256");
  if (!existsSync(list)) throw new Error("files.sha256 is missing: run `copy` first");
  const [head, ...rest] = readFileSync(list, "utf8").trim().split("\n");
  const copied = new Map(rest.map((line) => [line.split("  ")[2], line.split("  ")[0]]));
  const found = await retiredDocuments();
  const problems: string[] = [];
  if (head !== `${found.length} files` || copied.size !== found.length) {
    problems.push(`the copy lists ${copied.size} files, the database has ${found.length} rows`);
  }
  for (const document of found) {
    const key = document.storageKey ?? "";
    const stored = await retiredOriginal(document);
    const file = join(out, "files", key);
    const kept = existsSync(file) ? sha256(readFileSync(file)) : null;
    if (stored === null) problems.push(`${document.id}: no original in the store`);
    else if (sha256(stored) !== document.sha256)
      problems.push(`${document.id}: the store differs from the row`);
    if (kept === null) problems.push(`${document.id}: no copy`);
    else if (kept !== document.sha256 || copied.get(key) !== document.sha256) {
      problems.push(`${document.id}: the copy differs from the row`);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    throw new Error(`verify failed: ${problems.length} problems`);
  }
  console.log(`uguale: ${found.length} files in the store, in the copy and in the rows`);
  return found.length;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "count") {
    const found = await retiredDocuments();
    console.log(`${found.length} rows of the kinds ${RETIRED_KINDS.join(", ")}`);
  } else if (command === "copy") await copy();
  else if (command === "verify") await verify();
  else if (command === "delete") {
    const rows = await verify();
    if (argument("--yes") !== String(rows)) {
      throw new Error(`refusing to delete: pass --yes ${rows}, the number of rows found`);
    }
    const done = await deleteRetiredDocuments(rows);
    const left = (await retiredDocuments()).length;
    console.log(`deleted: ${done.files} files, ${done.rows} rows; left: ${left} rows`);
  } else throw new Error("usage: fund-documents.ts count | copy | verify | delete");
}

await main().finally(() => getPool().end());

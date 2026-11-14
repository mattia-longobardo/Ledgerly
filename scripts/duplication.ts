// scripts/duplication.ts — `npm run duplication`. The first measure of code clones (type D-a of
// docs/design/rewrite-plan/10-modularity.md §10.7): how many lines of the product code are a copy of
// other lines, per unit, written to `baselines/duplication.json`.
//
// A clone is two or more blocks that are equal for at least 50 tokens **and** 6 lines once spaces
// and comments are gone and every name and every literal is made the same — so two functions that
// differ only in what they call their variables are one clone. Tests, `import` lines, SQL
// migrations and the message catalogues do not count (§10.7.1).
//
// No package of its own (decision H11): the tokens come from the parser of `typescript`, which the
// project already has. The output is sorted and carries no date, so two runs on the same tree write
// the same bytes; `npm run duplication -- --check` fails when the file on disk is not what the tree
// measures today.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { isTestFile, sourceFiles, unitOf } from "./source-graph";

const MIN_TOKENS = 50;
const MIN_LINES = 6;
const BASELINE = "baselines/duplication.json";
type Token = { id: number; line: number };
type FileTokens = { rel: string; tokens: Token[]; lines: number };

const NAME = 1;
const LITERAL = 2;

/**
 * A file as normalised tokens: names → one id, literals → one id, everything else its own kind.
 * The tokens are the leaves of the parsed file and not the raw scanner's output: only the parser
 * knows where a template, a regular expression or a run of JSX text ends. `import` statements are
 * left out whole.
 */
export function tokensOf(rel: string, text: string): FileTokens {
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, scriptKind(rel));
  const tokens: Token[] = [];
  const seen = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const children = node.getChildren(file);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (node.getWidth(file) === 0) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    seen.add(line);
    tokens.push({ id: normalised(node.kind), line });
  };
  visit(file);
  return { rel, tokens, lines: seen.size };
}

const scriptKind = (rel: string) => (rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function normalised(kind: ts.SyntaxKind): number {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) return NAME;
  if (kind >= ts.SyntaxKind.FirstLiteralToken && kind <= ts.SyntaxKind.LastTemplateToken) return LITERAL;
  if (kind === ts.SyntaxKind.JsxText) return LITERAL;
  return kind + 10;
}

/** Two rolling hashes of every window of `MIN_TOKENS` tokens; equal windows share a key. */
function windowKeys(tokens: readonly Token[]): string[] {
  const keys: string[] = [];
  const [m1, b1, m2, b2] = [1_000_000_007, 131, 998_244_353, 137];
  let [p1, p2] = [1, 1];
  for (let index = 1; index < MIN_TOKENS; index += 1) [p1, p2] = [(p1 * b1) % m1, (p2 * b2) % m2];
  let [h1, h2] = [0, 0];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index >= MIN_TOKENS) {
      const gone = tokens[index - MIN_TOKENS].id;
      h1 = (h1 - ((gone * p1) % m1) + m1) % m1;
      h2 = (h2 - ((gone * p2) % m2) + m2) % m2;
    }
    h1 = (h1 * b1 + tokens[index].id) % m1;
    h2 = (h2 * b2 + tokens[index].id) % m2;
    if (index >= MIN_TOKENS - 1) keys.push(`${h1}:${h2}`);
  }
  return keys;
}

export type Duplication = {
  settings: { minTokens: number; minLines: number };
  total: Share;
  units: Record<string, Share>;
  files: Record<string, number>;
};
type Share = { lines: number; duplicatedLines: number; percent: number; blocks: number };

const share = (lines: number, duplicatedLines: number, blocks: number): Share => ({
  lines,
  duplicatedLines,
  percent: lines === 0 ? 0 : Math.round((duplicatedLines / lines) * 10_000) / 100,
  blocks,
});

export function measureDuplication(files: ReadonlyMap<string, string>): Duplication {
  const scanned = [...files].map(([rel, text]) => tokensOf(rel, text));
  const keysOf = scanned.map((file) => windowKeys(file.tokens));

  // Where each window occurs. A window is a copy when the same key starts somewhere else: in
  // another file, or in this one at least a window away (an overlap is one block, not two).
  const places = new Map<string, { file: number; at: number }[]>();
  keysOf.forEach((keys, file) =>
    keys.forEach((key, at) => {
      const list = places.get(key);
      if (list) list.push({ file, at });
      else places.set(key, [{ file, at }]);
    }),
  );

  const perFile = scanned.map((file, index) => {
    const copied = new Uint8Array(file.tokens.length);
    keysOf[index].forEach((key, at) => {
      const elsewhere = places
        .get(key)!
        .some((place) => place.file !== index || Math.abs(place.at - at) >= MIN_TOKENS);
      if (elsewhere) copied.fill(1, at, at + MIN_TOKENS);
    });
    // Maximal runs of copied tokens; a run is a block when it covers at least MIN_LINES lines.
    const lines = new Set<number>();
    let blocks = 0;
    for (let start = 0; start < copied.length;) {
      if (!copied[start]) {
        start += 1;
        continue;
      }
      let end = start;
      while (end < copied.length && copied[end]) end += 1;
      const run = new Set(file.tokens.slice(start, end).map((token) => token.line));
      if (run.size >= MIN_LINES) {
        blocks += 1;
        for (const line of run) lines.add(line);
      }
      start = end;
    }
    return { rel: file.rel, lines: file.lines, duplicated: lines.size, blocks };
  });

  const units = new Map<string, { lines: number; duplicated: number; blocks: number }>();
  for (const file of perFile) {
    const unit = units.get(unitOf(file.rel)) ?? { lines: 0, duplicated: 0, blocks: 0 };
    unit.lines += file.lines;
    unit.duplicated += file.duplicated;
    unit.blocks += file.blocks;
    units.set(unitOf(file.rel), unit);
  }
  const sum = (pick: (file: (typeof perFile)[number]) => number) =>
    perFile.reduce((total, file) => total + pick(file), 0);

  return {
    settings: { minTokens: MIN_TOKENS, minLines: MIN_LINES },
    total: share(
      sum((file) => file.lines),
      sum((file) => file.duplicated),
      sum((file) => file.blocks),
    ),
    units: Object.fromEntries(
      [...units]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([unit, value]) => [unit, share(value.lines, value.duplicated, value.blocks)]),
    ),
    files: Object.fromEntries(
      perFile
        .filter((file) => file.duplicated > 0)
        .sort((a, b) => a.rel.localeCompare(b.rel))
        .map((file) => [file.rel, file.duplicated]),
    ),
  };
}

export function readProductCode(src: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of sourceFiles(src)) {
    if (!isTestFile(rel)) files.set(rel, readFileSync(join(src, rel), "utf8"));
  }
  return files;
}

if (process.argv[1]?.endsWith("duplication.ts")) {
  const measured = `${JSON.stringify(measureDuplication(readProductCode(join(process.cwd(), "src"))), null, 2)}\n`;
  const path = join(process.cwd(), BASELINE);
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== measured) {
      console.error(
        `${BASELINE} is not what the tree measures: run \`npm run duplication\` and read the diff`,
      );
      process.exit(1);
    }
    console.log(`${BASELINE}: unchanged`);
  } else {
    writeFileSync(path, measured);
    const { total } = JSON.parse(measured) as Duplication;
    console.log(
      `${total.duplicatedLines} of ${total.lines} lines (${total.percent}%) in ${total.blocks} blocks`,
    );
  }
}

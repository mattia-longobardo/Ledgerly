// scripts/message-keys.ts — the keys of `messages/en.json` that no product file reads (rewrite plan R3,
// criterion 8: «0 chiavi di traduzione senza uso»). `tools/messages.test.ts` holds the catalogue to it.
// The method is the text of the files (decision H11): a key is read when a file names a namespace of
// it (`useTranslations("a.b")`, or any dotted literal) and holds the rest of the key as a literal, or
// the start of it as the head of a template (`t(`kind.${kind}`)`). It cannot tell a key that is truly
// read from one whose name is also some other string of the same file: it finds dead sections, not
// every dead leaf. A missing key is the type check's: `Messages` is `typeof en` (`global.d.ts`).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import ts from "typescript";

type Tree = { [key: string]: string | Tree };

const leaves = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [prefix + key] : leaves(value, `${prefix}${key}.`),
  );

const NAMESPACE = /^[a-zA-Z]+(\.[a-zA-Z0-9]+)*$/;

/** The literals and the template heads of one file. */
function literalsOf(path: string, text: string): { literals: string[]; heads: string[] } {
  const literals: string[] = [];
  const heads: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text);
    if (ts.isTemplateExpression(node)) heads.push(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true));
  return { literals, heads };
}

/** The product files: every source of the workspaces, tests left out. */
function productFiles(repo: string): string[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "apps/*.ts", "apps/*.tsx", "packages/*.ts", "packages/*.tsx", "plugins/*.ts"],
    { cwd: repo, encoding: "utf8" },
  );
  return listed.split("\n").filter((file) => file && !/\.(test|itest)\.tsx?$/.test(file));
}

/** The keys of the English catalogue that no product file reads. */
export function unusedMessageKeys(repo: string): string[] {
  const read = new Set<string>();
  const starts: string[] = [];
  for (const file of productFiles(repo)) {
    const { literals, heads } = literalsOf(file, readFileSync(join(repo, file), "utf8"));
    const namespaces = ["", ...literals.filter((literal) => NAMESPACE.test(literal))];
    for (const namespace of namespaces) {
      const prefix = namespace ? `${namespace}.` : "";
      for (const literal of literals) read.add(prefix + literal);
      for (const head of heads) if (prefix + head) starts.push(prefix + head);
    }
  }
  const catalogue: Tree = JSON.parse(readFileSync(join(repo, "messages/en.json"), "utf8"));
  return leaves(catalogue).filter((key) => !read.has(key) && !starts.some((start) => key.startsWith(start)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const key of unusedMessageKeys(process.cwd())) console.log(key);
}

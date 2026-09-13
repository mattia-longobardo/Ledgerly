import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const SCHEMA_IMPORT = /from\s+["']@\/modules\/([^/"']+)\/schema["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("module boundaries", () => {
  it("only a module itself (and the table barrel) imports its schema", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (rel === "platform/db/tables.ts") continue;
      for (const match of readFileSync(file, "utf8").matchAll(SCHEMA_IMPORT)) {
        if (!rel.startsWith(`modules/${match[1]}/`)) violations.push(`${rel} → modules/${match[1]}/schema`);
      }
    }
    expect(violations).toEqual([]);
  });
});

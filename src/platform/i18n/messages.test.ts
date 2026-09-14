import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import it_ from "../../../messages/it.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("message catalogues", () => {
  const english = flatten(en as Tree);
  const italian = flatten(it_ as Tree);

  it("have exactly the same keys", () => {
    expect([...italian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const [key, text] of english)
      expect(placeholders(italian.get(key) ?? ""), key).toEqual(placeholders(text));
  });

  it("never leave a translation empty", () => {
    for (const [key, text] of italian) expect(text.trim(), key).not.toBe("");
  });
});

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

const ARGUMENT = /^\{\s*(\w+)\s*[,}]/;

/**
 * The ICU arguments of a message — `{url}`, `{count, plural, …}` — and not the branch bodies of a
 * plural (`one {# account}`), which are translated text and so differ between languages. Braces
 * alternate: an argument opens at an even depth, a branch body at an odd one.
 */
function placeholders(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "}") depth -= 1;
    else if (text[i] === "{") {
      const argument = depth % 2 === 0 ? ARGUMENT.exec(text.slice(i)) : null;
      if (argument) names.push(argument[1]);
      depth += 1;
    }
  }
  return names.sort();
}

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

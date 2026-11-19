// M10, the Server Actions half (rewrite plan R3): the list of the ones left only gets shorter.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serverActions } from "../scripts/server-actions";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const known: Record<string, { closedBy: string; actions: string[] }> = JSON.parse(
  readFileSync(new URL("../baselines/server-actions.json", import.meta.url), "utf8"),
);

describe("the Server Actions (M10)", () => {
  const found = serverActions(REPO);

  it("are all on the known list: a new screen calls /api/v1", () => {
    const fresh = Object.entries(found).flatMap(([file, names]) =>
      names.filter((name) => !known[file]?.actions.includes(name)).map((name) => `${file}: ${name}`),
    );
    expect(fresh).toEqual([]);
  });

  it("list nothing that is gone: remove the entry", () => {
    const gone = Object.entries(known).flatMap(([file, entry]) =>
      entry.actions.filter((name) => !found[file]?.includes(name)).map((name) => `${file}: ${name}`),
    );
    expect(gone).toEqual([]);
  });
});

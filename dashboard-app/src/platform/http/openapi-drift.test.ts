import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../../scripts/openapi";

describe("openapi document", () => {
  it("matches the committed docs/api/openapi.json (run `npm run openapi:generate` to update)", async () => {
    const committed = JSON.parse(
      readFileSync(new URL("../../../../docs/api/openapi.json", import.meta.url), "utf8"),
    );
    expect(await buildOpenApiDocument()).toEqual(committed);
  });
});

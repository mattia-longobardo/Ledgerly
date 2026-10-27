import { describe, expect, it } from "vitest";
import { parseScopes } from "./scopes";

describe("parseScopes", () => {
  it("keeps a non-empty subset of the known scopes, in canonical order", () => {
    expect(parseScopes(["imports", "read"])).toEqual(["read", "imports"]);
    expect(parseScopes([])).toBeNull();
    expect(parseScopes(["admin"])).toBeNull();
    expect(parseScopes(["read", "admin"])).toBeNull();
  });
});

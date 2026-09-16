import { describe, expect, it } from "vitest";
import { navFor } from "./navigation";

describe("navFor", () => {
  it("hides admin-only items from users", () => {
    expect(navFor("user").map((i) => i.id)).toEqual(["overview", "accounts", "expenses", "settings"]);
    expect(navFor("admin").map((i) => i.id)).toEqual([
      "overview",
      "accounts",
      "expenses",
      "components",
      "settings",
    ]);
  });
});

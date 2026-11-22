// The browser's entry gives the client the server's colours of the categories (PERS-560): one
// implementation, no copy, and no database behind it.
import { describe, expect, it } from "vitest";
import * as client from "./client";
import { colorOfCategory } from "./index";
import { categoryColor } from "./rules";

describe("the browser's entry of transactions", () => {
  it("is the server's colour functions, name by name", () => {
    expect(client.categoryColor).toBe(categoryColor);
    expect(client.colorOfCategory).toBe(colorOfCategory);
  });

  it("draws a sub-category in its group's colour, a group in its own", () => {
    const group = { id: "g1", parentId: null, color: "#2563eb" };
    const child = { id: "c1", parentId: "g1", color: "#ff0000" };
    const groups = new Map([[group.id, group]]);
    expect(client.colorOfCategory(group, groups)).toBe("#2563eb");
    expect(client.colorOfCategory(child, groups)).toBe("#2563eb");
    expect(client.colorOfCategory({ id: "c2", parentId: "gone", color: null }, groups)).toBe(
      client.categoryColor({ id: "c2", parentId: "gone", color: null }),
    );
  });
});

import { describe, expect, it } from "vitest";
import { groupBy, searchByName } from "./collections";

describe("groupBy", () => {
  const rows = [
    { accountId: "b", on: "2026-01-02" },
    { accountId: "a", on: "2026-01-01" },
    { accountId: "b", on: "2026-01-03" },
  ];

  it("keeps the items of each key in their order, keys in first-seen order", () => {
    const groups = groupBy(rows, (row) => row.accountId);
    expect([...groups.keys()]).toEqual(["b", "a"]);
    expect(groups.get("b")).toEqual([rows[0], rows[2]]);
  });

  it("holds what valueOf gives", () => {
    expect(
      groupBy(
        rows,
        (row) => row.accountId,
        (row) => row.on,
      ).get("b"),
    ).toEqual(["2026-01-02", "2026-01-03"]);
  });

  it("has no entry for nothing", () => {
    expect(groupBy([], (row: { id: string }) => row.id).size).toBe(0);
  });
});

describe("searchByName", () => {
  const rows = [{ name: "Holiday" }, { name: "Car" }, { name: "holiday fund" }];

  it("keeps the names that contain the text, ignoring case, at most `limit`", async () => {
    expect(await searchByName(" HOLI ", async () => rows)).toEqual([rows[0], rows[2]]);
    expect(await searchByName("holi", async () => rows, 1)).toEqual([rows[0]]);
  });

  it("loads nothing for an empty text", async () => {
    let loaded = false;
    expect(
      await searchByName("  ", async () => {
        loaded = true;
        return rows;
      }),
    ).toEqual([]);
    expect(loaded).toBe(false);
  });
});

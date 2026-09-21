import { describe, expect, it } from "vitest";
import { amount, day, type Section, sectionCsv, sectionsJson } from "./sections";

const SECTION: Section = {
  name: "accounts",
  columns: ["name", "balance", "open"],
  rows: [
    { name: "ING", balance: "1234.56", open: true },
    { name: 'The "other" one', balance: null, open: false },
  ],
};

describe("amount", () => {
  it("is a canonical decimal string, and null stays null", () => {
    expect(amount(123_456n)).toBe("1234.56");
    expect(amount(-5n)).toBe("-0.05");
    expect(amount(null)).toBeNull();
    expect(amount(undefined)).toBeNull();
  });
});

describe("day", () => {
  it("is an ISO instant, and nothing is null", () => {
    expect(day(new Date("2026-09-21T10:00:00Z"))).toBe("2026-09-21T10:00:00.000Z");
    expect(day(null)).toBeNull();
  });
});

describe("sectionCsv", () => {
  it("writes the columns in order, quoting what needs it", () => {
    expect(sectionCsv(SECTION)).toBe(
      '﻿name;balance;open\r\nING;1234.56;true\r\n"The ""other"" one";;false\r\n',
    );
  });
});

describe("sectionsJson", () => {
  it("files each section under its own name, beside whatever the caller adds", () => {
    const parsed = JSON.parse(sectionsJson([SECTION], { exportedAt: "2026-09-21T10:00:00.000Z" }));
    expect(parsed.exportedAt).toBe("2026-09-21T10:00:00.000Z");
    expect(parsed.accounts).toHaveLength(2);
    expect(parsed.accounts[0]).toEqual({ name: "ING", balance: "1234.56", open: true });
    // The CSV's empty cell and the JSON's null are the same fact, said in each format's own way.
    expect(parsed.accounts[1].balance).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("takes the first and last word of a name", () => {
    expect(initialsOf("Anna Bianchi", "m@example.test")).toBe("AB");
  });

  it("takes two letters of a single word", () => {
    expect(initialsOf("Ada", "ada@example.test")).toBe("AD");
  });

  it("falls back to the address when there is no name yet", () => {
    expect(initialsOf("", "invited@example.test")).toBe("IN");
    expect(initialsOf("   ", "z@example.test")).toBe("Z");
  });
});

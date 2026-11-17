import { describe, expect, it } from "vitest";
import reference from "../../../../test/fixtures/categories/reference.json";
import { type CascadeMovement, decide, type Knowledge } from "./cascade";
import { featuresOf, memoryKey } from "./text";

// The reference file "text → features → expected category" (rewrite plan N3, "Test e gate"). The
// same file can be read by another implementation of the rules: it holds no code.

const ACCOUNT = "018f4e9a-0000-7000-8000-0000000000aa";

const knowledge: Knowledge = {
  memory: new Map(Object.entries(reference.memory)),
  model: null,
  thresholds: { automatic: null, suggestion: null },
  groupCategory: new Map(Object.entries(reference.groups)),
  categoryKind: new Map(Object.entries(reference.categories) as [string, "income" | "expense"][]),
};

describe("the reference movements", () => {
  it.each(reference.cases)("$name", (one) => {
    const movement: CascadeMovement = {
      ...one.movement,
      kind: one.movement.kind as "income" | "expense",
      amountCents: BigInt(one.movement.amountCents),
      accountId: ACCOUNT,
    };
    expect(memoryKey(movement)).toBe(one.key);
    expect(featuresOf(movement)).toEqual(expect.arrayContaining(one.features));
    expect(decide(movement, knowledge)).toMatchObject(one.expected);
  });
});

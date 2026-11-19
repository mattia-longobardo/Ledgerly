// R3 criterion 8: no key of the catalogue without a reader (`scripts/message-keys.ts`).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unusedMessageKeys } from "../scripts/message-keys";

const REPO = fileURLToPath(new URL("..", import.meta.url));

describe("the message catalogue", () => {
  it("has no key that no product file reads", () => {
    expect(unusedMessageKeys(REPO)).toEqual([]);
  }, 60_000);
});

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readCapped } from "./read-capped";

// `--import-labels -` reads stdin through this (SEC-02): an oversized input is cut at the limit.
describe("readCapped", () => {
  it("returns a stream that fits whole", async () => {
    const bytes = await readCapped(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), 4);
    expect(bytes.toString()).toBe("abcd");
  });

  it("stops one byte past the limit and reads no further chunk", async () => {
    let pulled = 0;
    async function* endless() {
      for (;;) {
        pulled += 1;
        yield Buffer.alloc(1024, 1);
      }
    }
    const bytes = await readCapped(endless(), 2500);
    expect(bytes.byteLength).toBe(2501);
    expect(pulled).toBe(3);
  });
});

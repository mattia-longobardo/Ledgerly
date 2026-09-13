import { beforeAll, describe, expect, it } from "vitest";
import { deleteObject, ensureBucket, getObject, putObject } from "./storage";

describe("S3 storage", () => {
  beforeAll(ensureBucket);

  it("stores, reads and deletes an object", async () => {
    const key = `tests/${Date.now()}.txt`;
    await putObject(key, new TextEncoder().encode("hello"), "text/plain");
    expect(new TextDecoder().decode((await getObject(key))!)).toBe("hello");
    await deleteObject(key);
    expect(await getObject(key)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readZip } from "../../../test/zip";
import { INCOMPLETE_ENTRY, type ZipEntry, zipToBytes } from "./zip";

const MTIME = new Date("2026-09-21T10:00:00Z");

async function* entries(...given: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const entry of given) yield entry;
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("zipToBytes", () => {
  it("writes an archive a reader can open, with every entry at its own path", async () => {
    const archive = await zipToBytes(
      entries(
        { path: "README.txt", bytes: bytes("hello") },
        { path: "documents/one.pdf", bytes: bytes("%PDF-1.4") },
      ),
      { mtime: MTIME },
    );
    const read = await readZip(archive);
    expect([...read.keys()].sort()).toEqual(["README.txt", "documents/one.pdf"]);
    expect(read.get("README.txt")?.toString("utf8")).toBe("hello");
  });

  it("keeps bytes that are not text exactly as they were", async () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const read = await readZip(await zipToBytes(entries({ path: "raw.bin", bytes: raw }), { mtime: MTIME }));
    expect([...(read.get("raw.bin") ?? [])]).toEqual([...raw]);
  });

  it("is a readable archive even when producing the entries failed, and says what is missing", async () => {
    async function* failing(): AsyncGenerator<ZipEntry> {
      yield { path: "first.txt", bytes: bytes("got this far") };
      throw new Error("the store refused");
    }
    const read = await readZip(await zipToBytes(failing(), { mtime: MTIME }));
    expect(read.get("first.txt")?.toString("utf8")).toBe("got this far");
    expect(read.get(INCOMPLETE_ENTRY)?.toString("utf8")).toContain("the store refused");
  });

  it("writes an empty archive rather than nothing when there is nothing to write", async () => {
    expect((await readZip(await zipToBytes(entries(), { mtime: MTIME }))).size).toBe(0);
  });
});

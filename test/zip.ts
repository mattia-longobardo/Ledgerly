// test/zip.ts — reads an archive back, for the tests of `src/platform/export`.
import yauzl from "yauzl";

/** Every entry of a ZIP as `path → bytes`. */
export function readZip(archive: Uint8Array): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(archive), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("not a zip"));
      const entries = new Map<string, Buffer>();
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("unreadable entry"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

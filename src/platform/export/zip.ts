import { Readable } from "node:stream";
import yazl from "yazl";

/**
 * A ZIP, written as it is read.
 *
 * `yazl` rather than a container format written by hand: a few hundred lines of offsets and
 * central directory to save one small dependency is the kind of economy that is paid back with
 * interest the first time somebody has to re-read it (plan F8 §3.4.13).
 *
 * The entries arrive from an async iterable and are added one at a time, so a user's originals are
 * never all in memory at once — the stream's own backpressure is what paces the reading.
 */

export interface ZipEntry {
  /** The path inside the archive, forward slashes, no leading one. */
  path: string;
  bytes: Uint8Array;
}

/**
 * Anything that goes wrong while producing the entries ends the archive after adding a note
 * naming what is missing: a truncated ZIP is unreadable, and a person who asked for their data
 * deserves to be told which part of it did not come rather than handed a file that will not open.
 */
export const INCOMPLETE_ENTRY = "INCOMPLETE.txt";

export function zipStream(
  entries: AsyncIterable<ZipEntry>,
  options: { mtime?: Date } = {},
): ReadableStream<Uint8Array> {
  const zip = new yazl.ZipFile();
  const mtime = options.mtime ?? new Date();
  const output = Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>;
  void (async () => {
    try {
      for await (const entry of entries) {
        zip.addBuffer(Buffer.from(entry.bytes), entry.path, { mtime, mode: 0o100644 });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      zip.addBuffer(Buffer.from(`This export is incomplete: ${reason}\n`, "utf8"), INCOMPLETE_ENTRY, {
        mtime,
        mode: 0o100644,
      });
    } finally {
      zip.end();
    }
  })();
  return output;
}

/** The same archive as one buffer, for a caller that has to hand it to S3 in a single call. */
export async function zipToBytes(
  entries: AsyncIterable<ZipEntry>,
  options: { mtime?: Date } = {},
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = zipStream(entries, options).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

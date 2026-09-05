import { createHash, randomBytes } from "node:crypto";
import { romeDate } from "@/lib/time";

/** Spec §7.9: uploads are rejected above 10 MB. Mirrored by `payroll_imports_size_ck`. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Spec §8.3: a declared MIME type is a claim by the client, so the bytes get
 * the last word. Only the magic at offset 0 counts — a PDF viewer will happily
 * open a file with leading junk, but so will a polyglot crafted to be read as
 * something else by a different parser.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** The identity of an upload (Ruling R4-3). Lowercase hex, 64 chars, matching `payroll_imports_sha_ck`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ruling R4-1: the object key must not be derivable from anything the client
 * sees — not the sha256, not the import id, not the filename. 16 random bytes
 * is 128 bits of unguessability, and the user/year prefix is what makes
 * `onDisconnect(purge)` and a per-user export a single prefix listing.
 *
 * The year comes from the Rome calendar (`romeDate`), the same civil calendar
 * every other date in this codebase uses; a UTC year would file a 31 December
 * evening upload under the wrong year for an Italian user.
 */
export function newStorageKey(userId: string, at: Date): string {
  const year = romeDate(at).slice(0, 4);
  return `payroll/${userId}/${year}/${randomBytes(16).toString("hex")}.pdf`;
}

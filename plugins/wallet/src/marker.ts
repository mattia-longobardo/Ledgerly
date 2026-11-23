/**
 * The marker a record created from the core carries in its note: `ledgerly-movement:<key>`. It is
 * what makes a create idempotent across a lost answer (`push.ts` looks for it first) and what lets
 * the core recognise the record when it reads it back (`sentKey`).
 */

const MARKER = "ledgerly-movement:";
const MARKED = /(?:^|\s)ledgerly-movement:([A-Za-z0-9-]{8,64})\s*$/;

export function sendMarker(key: string): string {
  return `${MARKER}${key}`;
}

/** The note a record is created with: the person's own, then the marker on a line of its own. */
export function noteWithMarker(note: string | null, key: string): string {
  const own = note?.trim() ?? "";
  return own === "" ? sendMarker(key) : `${own}\n${sendMarker(key)}`;
}

/**
 * A note read from Wallet without the marker, and the key the marker carried. A note that was only
 * the marker is no note.
 */
export function splitSendMarker(note: string | null): { note: string | null; key: string | null } {
  if (note === null) return { note: null, key: null };
  const found = MARKED.exec(note);
  if (!found) return { note, key: null };
  const rest = note.slice(0, found.index).trim();
  return { note: rest === "" ? null : rest, key: found[1] };
}

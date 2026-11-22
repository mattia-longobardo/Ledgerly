// What a credential pasted on a card may be (spec §9.4): a value an HTTP header can carry. Shared by the
// providers of the core, each in its own folder.

/** Tab, the visible ASCII range and `obs-text`: everything an HTTP header value may carry. */
function isHeaderValueCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

/**
 * Whether a token can be sent at all: not empty once trimmed, and made only of characters an HTTP
 * header value may carry.
 *
 * A token pasted out of a wrapped page keeps the line break in the *middle*, where `trim()` cannot
 * reach it, and building `Authorization` out of it throws an error that quotes the whole value —
 * which would then be stored in `sync_runs.error` and `integration_connections.last_error`, shown
 * verbatim in Settings › Integrations, and printed to the log. This predicate is the check the
 * interface makes where the token is pasted, before it is ever sealed into the connection; the
 * client makes it again before its first request.
 *
 * Deliberately stricter than `new Headers`, which accepts a C0 control or a DEL that `fetch` then
 * refuses further down ("invalid authorization header", after five pointless attempts): every
 * character outside the set above is a paste accident, never a credential.
 */
export function isUsableToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed === "") return false;
  for (const character of trimmed) {
    if (!isHeaderValueCode(character.codePointAt(0) ?? 0)) return false;
  }
  return true;
}

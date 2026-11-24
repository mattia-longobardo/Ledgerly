// What the `calls.ts` of the screens share (rewrite plan R3): a write keeps the answer of the Server
// Action it replaced (`{ ok }` or the refusal's code), and a number typed in the person's format is
// read here, on the client, and goes on the wire as a decimal string (`amountInput`).
import { profile } from "@ledgerly/api-contract/settings";
import { ApiError } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { read } from "@ledgerly/ui/data";

export type WriteResult = { ok: true } | { ok: false; error: string };

/** A typed number the client cannot read: `invalid`, as the Server Action answered. */
class Unreadable extends Error {}

/** The refusal's reason (`duplicate_name`, `not_cancelled`…) or its code; a failure of the server throws. */
export function refusal(error: unknown): { ok: false; error: string } {
  if (error instanceof Unreadable) return { ok: false, error: "invalid" };
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  throw error;
}

/** Runs a write; on success `changed` drops what it made stale, waited for when it answers a promise. */
export async function writing(
  work: () => Promise<unknown>,
  changed: () => void | Promise<void>,
): Promise<WriteResult> {
  try {
    await work();
    await changed();
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

/** A number typed in the person's format, as the decimal of the contract. */
export async function decimalOf(typed: string): Promise<string> {
  const style = numberStyle(await read(profile.getPreferences, {}));
  try {
    return centsToDecimal(parseAmount(typed, style));
  } catch {
    throw new Unreadable();
  }
}

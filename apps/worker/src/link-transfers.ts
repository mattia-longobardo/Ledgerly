/**
 * `node /app/worker.mjs --link-transfers`: once after the release of the giroconti (2026-11-25),
 * every person's giroconti paired by the new rules. It prints the counts and nothing else; run
 * again, it changes nothing. The exit code is 1 when a person failed.
 */
import { linkOwnTransfers } from "@ledgerly/domain/transactions";
import { forEachUser } from "@ledgerly/domain/users";

export async function linkAllTransfers(): Promise<number> {
  let changed = 0;
  const counts = await forEachUser("link-transfers", async (_person, ctx) => {
    changed += await linkOwnTransfers(ctx);
  });
  console.log({ ...counts, changed });
  return counts.failed === 0 ? 0 : 1;
}

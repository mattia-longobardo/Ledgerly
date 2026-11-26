/**
 * `node /app/worker.mjs --link-investment-legs`: once after the release of PERS-651, every deposit
 * and withdrawal of Investments, and every voluntary contribution of a fund, gets its leg in the
 * accounts, paired with the bank's movement by the rules of the giroconti. It prints the counts and
 * nothing else; run again, it changes nothing. The exit code is 1 when a person failed.
 */
import { linkAllFundLegs } from "@ledgerly/domain/funds";
import { linkAllCashLegs } from "@ledgerly/domain/investments";
import { forEachUser } from "@ledgerly/domain/users";

export async function linkInvestmentLegs(): Promise<number> {
  let changed = 0;
  const counts = await forEachUser("link-investment-legs", async (_person, ctx) => {
    changed += (await linkAllCashLegs(ctx)) + (await linkAllFundLegs(ctx));
  });
  console.log({ ...counts, changed });
  return counts.failed === 0 ? 0 : 1;
}

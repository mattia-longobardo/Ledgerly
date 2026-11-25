// Accounts · where each account stands with its source (decision H56), for every read that lists
// accounts: `GET /accounts`, `GET /accounts/{id}`, `GET /net-worth`.
import type { Account } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { formerSourcesOf, isPluginProvider } from "@ledgerly/domain/platform/integrations";
import { type AccountSource, accountSource, pluginActivationsOf } from "@ledgerly/domain/platform/plugins";

/**
 * Where each of these accounts stands with its source (H56). Each read runs only when an account
 * needs it (G9): the person's plugins when an account is a plugin's; the source's ids of the
 * accounts kept by hand that were read once (an account never read has never had a source).
 */
export async function sourcesOf(
  ctx: Ctx,
  rows: readonly Account[],
): Promise<(account: Account) => AccountSource> {
  const plugins = rows.some((account) => account.provider !== null && isPluginProvider(account.provider));
  const formerIds = rows
    .filter((account) => account.provider === null && account.lastSyncedAt !== null)
    .map((account) => account.id);
  const [activations, former] = await Promise.all([
    plugins ? pluginActivationsOf(ctx) : new Map<string, { active: boolean; deactivatedAt: Date | null }>(),
    formerSourcesOf(ctx, formerIds),
  ]);
  return (account) => {
    const provider = account.provider;
    const plugin =
      provider !== null && isPluginProvider(provider)
        ? (activations.get(provider.slice("plugin:".length)) ?? { active: false, deactivatedAt: null })
        : undefined;
    return accountSource(account, { plugin, former: former.get(account.id) });
  };
}

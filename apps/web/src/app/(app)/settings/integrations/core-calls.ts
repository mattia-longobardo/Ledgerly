// The cards of the providers of the core (spec §9.1, §9.2) through `/api/v1/connections` (rewrite plan
// R3): save the credential, choose the accounts, disconnect. Each keeps the answer of the Server Action
// it replaces: `ok`, or the card's code (`empty`, `rejected`, `provider`, `notConnected`…). None
// returns a credential: there is no field a token could travel in.
import { connections } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

export type IntegrationActionResult = { ok: true; back?: number } | { ok: false; error: string };

/** One account of the provider on the choice of the card: no id of an account here, only its name. */
export interface CoreAccountRow {
  externalId: string;
  name: string;
  here: string | null;
  chosen: boolean;
}

function refused(error: unknown): { ok: false; error: string } {
  if (error instanceof ApiError && error.status === 404) return { ok: false, error: "notConnected" };
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  return { ok: false, error: "failed" };
}

async function attempt(work: () => Promise<unknown>): Promise<IntegrationActionResult> {
  try {
    await work();
  } catch (error) {
    return refused(error);
  }
  invalidate(connections.listConnections);
  return { ok: true };
}

/** Saves the credential of a provider of the core, the first one or a replacement. */
export async function connectCore(
  provider: string,
  credentials: Record<string, string>,
): Promise<IntegrationActionResult> {
  try {
    const { restoredAccounts } = await call(connections.connect, { body: { provider, credentials } });
    invalidate(connections.listConnections);
    // `back`: the accounts a source turned on again tied back (plugin-settings.md §3.4).
    return restoredAccounts > 0 ? { ok: true, back: restoredAccounts } : { ok: true };
  } catch (error) {
    return refused(error);
  }
}

/** Drops the credential and the connection's own history; the accounts and movements stay. */
export const disconnectCore = (connectionId: string) =>
  attempt(() => call(connections.disconnect, { params: { id: connectionId } }));

/** "Choose the accounts": the accounts the provider has now, read when the dialog opens. */
export async function coreAccounts(
  connectionId: string,
): Promise<{ ok: true; accounts: CoreAccountRow[] } | { ok: false; error: string }> {
  try {
    const { accounts } = await call(connections.listConnectionAccounts, { params: { id: connectionId } });
    return {
      ok: true,
      accounts: accounts.map(({ providerAccountId, name, here, chosen }) => ({
        externalId: providerAccountId,
        name,
        here,
        chosen,
      })),
    };
  } catch (error) {
    return refused(error);
  }
}

/** Saves which of `all` come here: the chosen ones; the others are left out. */
export const chooseCoreAccounts = (
  connectionId: string,
  all: readonly string[],
  chosen: ReadonlySet<string>,
) =>
  attempt(() =>
    call(connections.chooseConnectionAccounts, {
      params: { id: connectionId },
      body: {
        decisions: all.map((providerAccountId) =>
          chosen.has(providerAccountId)
            ? // A provider of the core makes its own account: only the choice counts.
              {
                providerAccountId,
                target: { kind: "new" as const, name: providerAccountId, type: "checking" },
              }
            : { providerAccountId, target: { kind: "skip" as const } },
        ),
      },
    }),
  );

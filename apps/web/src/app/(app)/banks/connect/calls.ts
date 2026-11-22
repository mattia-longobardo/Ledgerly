// The steps of "Connect a bank" (ux/n1-plugin-bank.md §6) through `/api/v1` (rewrite plan R3): the banks
// of a country, the choice of the accounts with the first reading, a reading tried again and the way
// out. Each keeps the name and the answer of the Server Action it replaces: `ok`, or the plugin host's
// code; a failure of the server is `failed`.
import { banks, connections } from "@ledgerly/api-contract/settings";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

export type BankChoice = RouteOutput<typeof banks.listBanks>["banks"][number];

type Refusal = { ok: false; error: string };

function refused(error: unknown): Refusal {
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  return { ok: false, error: "failed" };
}

async function attempt(work: () => Promise<unknown>): Promise<{ ok: true } | Refusal> {
  try {
    await work();
  } catch (error) {
    return refused(error);
  }
  invalidate(connections.listConnections);
  return { ok: true };
}

export async function listBanksAction(country: string): Promise<{ ok: true; banks: BankChoice[] } | Refusal> {
  try {
    return { ok: true, banks: (await call(banks.listBanks, { query: { country } })).banks };
  } catch (error) {
    return refused(error);
  }
}

/** One account of the bank: a new account, an account here, or left out. */
type AccountDecision = {
  providerAccountId: string;
  target:
    { kind: "new"; name: string; type: string } | { kind: "existing"; accountId: string } | { kind: "skip" };
};

/**
 * Applies the choice of the accounts and reads the bank at once, in the same request (§6.6): the
 * history older than 90 days is only there in the first minutes after the access. The currency of
 * each account is the one the route reads from the bank.
 */
export const importBankAccountsAction = (connectionId: string, decisions: AccountDecision[]) =>
  attempt(() =>
    call(connections.chooseConnectionAccounts, {
      params: { id: connectionId },
      body: {
        decisions: decisions.map(({ providerAccountId, target }) => ({ providerAccountId, target })),
      },
    }),
  );

export const retryBankReadingAction = (connectionId: string) =>
  attempt(() => call(banks.readBankNow, { params: { id: connectionId } }));

export const cancelBankConnectionAction = (connectionId: string) =>
  attempt(() => call(connections.disconnect, { params: { id: connectionId } }));

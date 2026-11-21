// Wallet as the ledger interests publishes its settlements on (audit INT-1): the adapter of the port
// `LedgerPosting` of interests, wired by the application. The client is the person's, from their
// connection; a revoked or missing one is no ledger.
import type { Ctx } from "../../context";
import { WALLET_PROVIDER } from "../rules";
import { listConnections, readCredentials } from "../service";
import { createWalletClient } from "./client";

export const walletPosting = {
  provider: WALLET_PROVIDER,
  async ledgerOf(ctx: Pick<Ctx, "userId">) {
    const connection = (await listConnections(ctx)).find((one) => one.provider === WALLET_PROVIDER);
    if (!connection || connection.state === "revoked") return null;
    const { token } = await readCredentials(ctx, connection.id);
    return createWalletClient(token);
  },
};

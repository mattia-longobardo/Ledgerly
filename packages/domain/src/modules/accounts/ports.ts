// The ports of accounts (audit ACC-8, 10-modularity.md §10.3): what accounts needs of the modules
// above it, declared here and realised there, so accounts imports neither transactions nor
// investments. The application wires them once per process (`wireDomain` in `apps/api`): a port
// that is not wired fails loudly, never with a silent default that would let a balance through.
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import type { Cents } from "../../shared/money";

/** The movements of the accounts, realised by transactions. */
interface MovementsPort {
  /** Each account's net of its movements per day, in the person's zone. */
  dailyNetByAccount(
    ctx: Pick<Ctx, "userId" | "timeZone">,
    accountIds: readonly string[],
  ): Promise<Map<string, { on: CivilDate; cents: Cents }[]>>;
  /** The movements a person wrote by hand on each account. */
  manualMovementsByAccount(
    ctx: Pick<Ctx, "userId" | "timeZone">,
    accountIds: readonly string[],
  ): Promise<Map<string, { id: string; on: CivilDate; cents: Cents; writtenAt: Date }[]>>;
  /** The ids of an account's movements. */
  transactionIdsOfAccount(ctx: Pick<Ctx, "userId">, accountId: string): Promise<string[]>;
  /** Joins the giroconti the IBANs of the accounts make of the movements already stored. */
  linkOwnTransfers(ctx: Pick<Ctx, "userId">): Promise<number>;
  /** The first of `candidates` whose movements hold every movement of the account (H58), or null. */
  twinOf(
    ctx: Pick<Ctx, "userId" | "timeZone">,
    accountId: string,
    candidates: readonly string[],
  ): Promise<string | null>;
  /** Records the account as a double of `twinId` (its movements leave the months), or forgets it. */
  markDuplicate(ctx: Pick<Ctx, "userId">, accountId: string, twinId: string | null): Promise<void>;
  /** The twin of each account recorded as a double. */
  duplicatesOf(ctx: Pick<Ctx, "userId">, accountIds: readonly string[]): Promise<Map<string, string>>;
}

/** The accounts Investments manages, realised by investments. */
interface ManagedAccountsPort {
  /** The day from which Investments writes the account's value; null when it does not. */
  managedSinceOf(ctx: Pick<Ctx, "userId">, accountId: string): Promise<CivilDate | null>;
  /** The accounts among `accountIds` that are a service of Investments. */
  serviceAccountIds(ctx: Pick<Ctx, "userId">, accountIds: readonly string[]): Promise<Set<string>>;
}

interface Ports {
  movements: MovementsPort;
  managed: ManagedAccountsPort;
}

// On `globalThis`, as the pool of the database: one process may load this file in more than one
// bundle (Next.js), and the wiring of one must be seen by the others.
declare global {
  var ledgerlyAccountsPorts: Ports | undefined;
}

/** Wires the ports; the application calls it once per process, before any request or job. */
export function wireAccounts(ports: Ports): void {
  globalThis.ledgerlyAccountsPorts = ports;
}

function wired(): Ports {
  const ports = globalThis.ledgerlyAccountsPorts;
  if (!ports) throw new Error("accounts: the ports are not wired (wireDomain of @ledgerly/api)");
  return ports;
}

export const movements = (): MovementsPort => wired().movements;
export const managedAccounts = (): ManagedAccountsPort => wired().managed;

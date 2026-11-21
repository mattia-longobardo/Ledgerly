// The port of interests (audit INT-1, 10-modularity.md §10.3): the ledger a settlement is published
// on, declared here and realised by the source that writes (until R5c, the first one). The application wires
// it once per process (`wireDomain` in `apps/api`): a port that is not wired fails loudly.
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import type { Cents } from "../../shared/money";

/** The records of one person's ledger on the source: what publishing a settlement needs of it. */
export interface LedgerPosting {
  /** The records of one source account on one day whose note carries `marker`. */
  recordsWithNote(query: {
    accountId: string;
    on: CivilDate;
    marker: string;
  }): Promise<{ id: string; amountCents: Cents }[]>;
  /** One new record, one attempt; `id` is null when the answer names none (unsure, never done). */
  createRecord(input: {
    accountId: string;
    amountCents: Cents;
    on: CivilDate;
    note: string;
    /** The source's own id of the category; null files the record under none. */
    categoryId: string | null;
  }): Promise<{ id: string | null }>;
}

interface PostingPort {
  /** The source whose links a published settlement and its category keep. */
  provider: string;
  /** The person's ledger on the source, or null when no connection of it can write now. */
  ledgerOf(ctx: Pick<Ctx, "userId">): Promise<LedgerPosting | null>;
}

interface Ports {
  posting: PostingPort;
}

// On `globalThis`, as the pool of the database: one process may load this file in more than one
// bundle (Next.js), and the wiring of one must be seen by the others.
declare global {
  var ledgerlyInterestsPorts: Ports | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireInterests(ports: Ports): void {
  globalThis.ledgerlyInterestsPorts = ports;
}

export function postingPort(): PostingPort {
  const ports = globalThis.ledgerlyInterestsPorts;
  if (!ports) throw new Error("interests: the ports are not wired (wireDomain of @ledgerly/api)");
  return ports.posting;
}

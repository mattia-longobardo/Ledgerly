/**
 * What the plugin runtime needs from the domain to import a bank (rewrite plan, 04-now.md §4.1:
 * "the core validates the answer and writes with the services of the domain"). The runtime
 * states the port; the application gives it an adapter made of the modules' own services
 * (rule M8: only the application joins a port and its adapter). Nothing here imports a module.
 */
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** An account of the person that a bank's account may be tied to. */
export interface OpenAccount {
  id: string;
  name: string;
  currency: string;
}

/** What the person chose for one account the bank exposes. */
export interface AccountChoice {
  /** The provider's id of the account that stays the same across accesses. */
  providerAccountId: string;
  currency: string;
  target: { kind: "new"; name: string; type: string } | { kind: "existing"; accountId: string };
}

/** One booked movement of a bank, ready for the domain: its identity is already decided. */
export interface ReadingMovement {
  /** Unique for the person and the provider, and the same at every reading. */
  externalId: string;
  day: CivilDate;
  /** Never negative: `direction` says which way the money went. */
  amount: string;
  direction: "credit" | "debit";
  currency: string;
  payee: string | null;
  note: string | null;
  raw: {
    text: string | null;
    counterparty: string | null;
    merchantCategoryCode: string | null;
    bankTransactionCode: string | null;
  };
}

export interface MovementsWritten {
  created: number;
  updated: number;
  skipped: number;
}

/** Thrown by an adapter for a choice the domain refuses (an account that is not the person's, a wrong currency). */
export class SinkRefusal extends Error {
  constructor() {
    super("refused");
    this.name = "SinkRefusal";
  }
}

export interface BankSink {
  /** The person's accounts a bank's account may be tied to. */
  openAccounts(ctx: Who): Promise<OpenAccount[]>;
  /** Ties the accounts as chosen; returns the local account of each provider id. Throws {@link SinkRefusal}. */
  linkAccounts(
    ctx: Who,
    provider: string,
    choices: readonly AccountChoice[],
    now: Date,
  ): Promise<Map<string, string>>;
  /** The accounts tied to a provider, by provider id. */
  linkedAccounts(ctx: Who, provider: string): Promise<Map<string, { id: string; name: string }>>;
  /** Gives the provider's accounts back to the person, as accounts kept by hand. */
  releaseAccounts(ctx: Who, provider: string): Promise<void>;
  writeBalance(
    ctx: Who,
    accountId: string,
    reading: { on: CivilDate; amount: string },
    now: Date,
  ): Promise<void>;
  writeMovements(
    ctx: Who,
    target: { accountId: string; provider: string },
    movements: readonly ReadingMovement[],
    now: Date,
  ): Promise<MovementsWritten>;
  /** Once per reading, after the writes: what the domain derives from the movements. */
  afterReading(ctx: Who, accountIds: readonly string[]): Promise<void>;
}

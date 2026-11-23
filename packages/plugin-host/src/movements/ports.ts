/**
 * What the engine of a source read with a token needs from the domain (rewrite plan R5c, step P3b):
 * the services of accounts and transactions, by the names they have there. The engine states the
 * port; the application gives it an adapter made of the modules' own functions (rule M8: only the
 * application joins a port and its adapter, `apps/api`). Nothing here imports a module: the shapes
 * are the ones the engine reads and writes, and the adapter is checked against the modules' own.
 */
import type { SourceAccountsResponse } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import type { Cents } from "@ledgerly/domain/shared/money";

import { sinkOf } from "../sinks";

type Who = Pick<Ctx, "userId">;
type WhoWhere = Pick<Ctx, "userId" | "timeZone">;
type Kind = "income" | "expense" | "transfer";

/** An account of the source as the accounts module's lifecycle rules receive it. */
export interface RemoteAccount {
  provider: string;
  providerAccountId: string;
  name: string;
  type: SourceAccountsResponse["accounts"][number]["type"];
  currency: string;
  iban?: string | null;
}

/** One movement of the source as the transactions module receives it. */
export interface IncomingMovement {
  externalId: string;
  counterpartExternalId: string | null;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: Kind;
  state: "cleared" | "pending";
  payee: string | null;
  note: string | null;
  categoryExternalId: string | null;
  categoryName: string | null;
  categoryGroupExternalId: string | null;
  categoryGroupName: string | null;
  labels: readonly string[];
  sentKey?: string | null;
}

/** One local category with the source's ids attached, as the two-way category sync reads it. */
export interface ProviderCategory extends Record<
  "parentId" | "providerName" | "externalId" | "groupExternalId",
  string | null
> {
  id: string;
  name: string;
  type: Kind;
  archived: boolean;
  locallyEdited: readonly string[];
}

/** A manual movement that waits to be created at the source. */
interface PendingSend {
  id: string;
  accountId: string;
  key: string;
  state: "to_send" | "not_sent";
  on: CivilDate;
  askedOn: CivilDate | null;
  amountCents: Cents;
  payee: string | null;
  note: string | null;
  categoryId: string | null;
}

interface UpsertOutcome {
  created: number;
  updated: number;
  skipped: number;
  removed: number;
}

/** The accounts of the person: what the engine reads of each. */
interface LocalAccount {
  id: string;
  name: string;
  provider: string | null;
  providerAccountId: string | null;
}

/** The fields of a movement a saved edit hands back to the source. */
type PushedField = "amountCents" | "type" | "payee" | "note";

/** The services of accounts the engine calls. */
interface AccountsSink {
  listAccounts: (ctx: Who, options: { includeArchived?: boolean }) => Promise<LocalAccount[]>;
  applyProviderAccounts: (
    ctx: Who,
    provider: string,
    remote: readonly RemoteAccount[],
    now: Date,
  ) => Promise<{ ibanConflicts: string[] }>;
  saveProviderBalance: (
    ctx: Who,
    accountId: string,
    input: { on: CivilDate; cents: Cents; availableCents?: Cents | null },
    now: Date,
  ) => Promise<unknown>;
  rebuildDerivedBalances: (ctx: WhoWhere) => Promise<unknown>;
}

/** The services of transactions the engine calls for the movements. */
interface MovementsWrites {
  transactionsInWindow: (
    ctx: WhoWhere,
    accountId: string,
    window: { from: CivilDate; to: CivilDate },
  ) => Promise<{ removedUpstreamAt: Date | null }[]>;
  upsertFromProvider: (
    ctx: WhoWhere,
    accountId: string,
    incoming: IncomingMovement[],
    options: { provider: string; now?: Date; window?: { from: CivilDate; to: CivilDate } },
  ) => Promise<UpsertOutcome>;
  purgeRemovedUpstream: (ctx: Who, source: { provider: string }) => Promise<number>;
  alignCategoryTypesToMovements: (ctx: Who, createdSince: Date) => Promise<number>;
  getTransaction: (ctx: Who, id: string) => Promise<{ id: string; accountId: string } | null>;
  releaseLocalEdits: (ctx: Who, id: string, fields: readonly PushedField[]) => Promise<void>;
}

/** The services of transactions the engine calls for the manual movements it sends. */
interface SendsSink {
  pendingSends: (ctx: WhoWhere, accountIds: readonly string[]) => Promise<PendingSend[]>;
  markNotSent: (ctx: Who, id: string, askedOn?: CivilDate) => Promise<void>;
  settleSent: (
    ctx: Who,
    id: string,
    sent: { provider: string; externalId: string; sourceCategoryId: string | null; payeeSent: boolean },
  ) => Promise<boolean>;
  sourceCategoryFor: (
    ctx: Who,
    provider: string,
    categoryId: string | null,
  ) => Promise<{ id: string; externalId: string } | null>;
}

/** The services of transactions the engine calls for the categories. */
interface CategoriesSink {
  /** What `categories.name` holds here. */
  categoryNameMax: number;
  recordSourceCategories: (
    ctx: Who,
    provider: string,
    remote: readonly { externalId: string; name: string; groupName: string | null }[],
  ) => Promise<number>;
  listProviderCategories: (ctx: Who, provider: string) => Promise<ProviderCategory[]>;
  adoptProviderCategory: (
    ctx: Who,
    provider: string,
    remote: { externalId: string; name: string; groupExternalId: string | null; groupName: string | null },
  ) => Promise<"linked" | "refused">;
  followProviderCategoryName: (
    ctx: Who,
    id: string,
    name: string,
  ) => Promise<"renamed" | "duplicate" | "not_found">;
  linkProviderCategory: (
    ctx: Who,
    provider: string,
    link: { id: string; externalId: string; providerName: string },
  ) => Promise<"linked" | "conflict">;
  settleProviderCategoryName: (ctx: Who, id: string, providerName: string) => Promise<void>;
}

export type MovementsSink = AccountsSink & MovementsWrites & SendsSink & CategoriesSink;

/** The wired port. */
export const movementsSink = (): MovementsSink => sinkOf("movements");

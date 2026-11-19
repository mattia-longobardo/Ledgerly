// Transactions · what the web process lends the routes until R4, and the refusal of the module as the
// contract names it. The manual movement joins accounts (its balance) from the web (`manual.ts`); the
// source of a movement is a provider of the core, which the web names until R5c (rule M12); the
// queue of the categorisation is the web's.
import { TransactionError } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { Cents } from "@ledgerly/domain/shared/money";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { ApiRefusal } from "../serve";

type Kind = "expense" | "income";
type MovementType = "income" | "expense" | "transfer";

/** A manual movement as the use cases of the web take it: the size in cents, `kind` gives the sign. */
export interface ManualMovement {
  kind: Kind;
  amountCents: Cents;
  on: CivilDate;
  accountId: string;
  categoryId: string | null;
  payee: string;
  note: string;
}

export type EditOutcome =
  { state: "saved" | "unchanged" | "not_linked" } | { state: "refused" | "failed"; reason: string };

type Effect =
  | { kind: "none" }
  | { kind: "unchanged"; readingOn: CivilDate }
  | { kind: "change"; before: Cents; after: Cents };

export interface TransactionCases {
  /** Of these movements, the ones their source lets change. */
  editableAtSource(ctx: Ctx, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** The name of the source each account sends its manual movements to. */
  sendSources(ctx: Ctx, accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  editAtSource(
    ctx: Ctx,
    id: string,
    edit: { type: MovementType; amountCents: Cents; payee: string; note: string },
  ): Promise<EditOutcome>;
  manualAccounts(ctx: Ctx): Promise<
    {
      id: string;
      name: string;
      currency: string;
      mode: "manual" | "two_way" | "read_only";
      source?: { name: string; waiting: boolean };
    }[]
  >;
  previewManual(
    ctx: Ctx,
    input: { kind: Kind; amountCents: Cents; on: CivilDate; accountId: string; editingId?: string },
  ): Promise<{ account: string; effect: Effect } | null>;
  createManual(ctx: Ctx, movement: ManualMovement, key: string): Promise<{ id: string; created: boolean }>;
  updateManual(ctx: Ctx, id: string, movement: ManualMovement): Promise<{ id: string }>;
  deleteManual(ctx: Ctx, id: string): Promise<void>;
  retrySend(ctx: Ctx, id: string): Promise<{ sent: boolean }>;
  /** Hide, restore or delete with the balance of the manual movements' accounts rebuilt. */
  changeVisibility(ctx: Ctx, ids: readonly string[], change: "hide" | "restore" | "delete"): Promise<number>;
  /** A pass of the categorisation after new labels; `train` when the default groups were just made. */
  learn(ctx: Ctx, train: boolean): Promise<void>;
}

const INVALID = new Set(["invalid", "invalid_reference", "future_date"]);

/** A `TransactionError` as the contract answers it: the code in `reason`. */
function transactionRefusal(error: unknown): unknown {
  if (!(error instanceof TransactionError)) return error;
  if (error.code === "not_found") return new ApiRefusal("not_found");
  return new ApiRefusal(INVALID.has(error.code) ? "invalid" : "conflict", error.code);
}

/** Runs a use case of the module and turns its refusal into the contract's. */
export async function refusing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw transactionRefusal(error);
  }
}

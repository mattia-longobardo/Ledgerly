// The accounts of a provider against the person's (spec §7.1, N4): the steps of a reading, the
// rule «one IBAN, one account», the mode of an account. Part of `rules`; pure.
import { nameKey } from "../../../shared/inputs";
import type { AccountOrigin, AccountState, AccountType } from "./index";

export interface LocalAccount {
  id: string;
  name: string;
  origin: AccountOrigin;
  state: AccountState;
  provider: string | null;
  providerAccountId: string | null;
  renamedLocally: boolean;
  type: AccountType;
  retypedLocally: boolean;
  /** Left out by a caller that has none to compare: no IBAN step is planned then. */
  iban?: string | null;
}

export interface RemoteAccount {
  provider: string;
  providerAccountId: string;
  name: string;
  type: AccountType;
  currency: string;
  /** The account's IBAN as the source gives it, already checked (`normalizeIban`); `null` when none. */
  iban?: string | null;
}

type ReconcileStep =
  | { action: "create"; remote: RemoteAccount }
  | { action: "iban"; id: string; iban: string }
  /** A new account of the source whose IBAN an account here already has: not created (H39). */
  | { action: "ibanExists"; remote: RemoteAccount; accountId: string }
  | { action: "adopt"; id: string; remote: RemoteAccount }
  | { action: "rename"; id: string; name: string }
  | { action: "retype"; id: string; type: AccountType }
  | { action: "reappear"; id: string }
  | { action: "unavailable"; id: string };

/**
 * The lifecycle of a provider's accounts (spec §7.1), as a list of steps the service applies.
 *
 * A manual account with the same name is adopted once, comparing names without spaces or case; a
 * provider's rename — and its type — is followed only while the local one has not been changed by
 * hand; an account
 * archived locally stays archived; and an account the provider stopped sending becomes
 * `unavailable`, never deleted.
 */
export function reconcileProviderAccounts(
  local: readonly LocalAccount[],
  remote: readonly RemoteAccount[],
  provider: string,
): ReconcileStep[] {
  const mine = local.filter((account) => account.provider === null || account.provider === provider);
  const linked = new Map(
    mine.flatMap((account) =>
      account.providerAccountId === null ? [] : [[account.providerAccountId, account] as const],
    ),
  );
  const adoptable = adoptableByName(mine);
  const steps: ReconcileStep[] = [];
  const seen = new Set<string>();
  for (const incoming of remote) {
    if (incoming.provider !== provider) continue;
    seen.add(incoming.providerAccountId);
    const known = linked.get(incoming.providerAccountId);
    steps.push(...(known ? knownSteps(known, incoming) : [newStep(incoming, adoptable, local)]));
  }
  for (const [externalId, account] of linked) {
    if (!seen.has(externalId) && account.state === "active") {
      steps.push({ action: "unavailable", id: account.id });
    }
  }
  return steps;
}

/** The manual accounts a provider's account may adopt, by name. */
function adoptableByName(mine: readonly LocalAccount[]): Map<string, LocalAccount> {
  const adoptable = new Map<string, LocalAccount>();
  for (const account of mine) {
    if (account.origin !== "manual" || account.state === "archived") continue;
    // Two manual accounts can share a name: the first in the user's own order is adopted, so the
    // same input always produces the same outcome.
    const key = nameKey(account.name);
    if (!adoptable.has(key)) adoptable.set(key, account);
  }
  return adoptable;
}

/** What changes on an account already tied to the provider's. */
function knownSteps(known: LocalAccount, incoming: RemoteAccount): ReconcileStep[] {
  const steps: ReconcileStep[] = [];
  if (known.state === "unavailable") steps.push({ action: "reappear", id: known.id });
  if (!known.renamedLocally && known.name !== incoming.name) {
    steps.push({ action: "rename", id: known.id, name: incoming.name });
  }
  if (!known.retypedLocally && known.type !== incoming.type) {
    steps.push({ action: "retype", id: known.id, type: incoming.type });
  }
  // The source writes the IBAN it gives, even one another account has (04-now.md §4.6.1, point 6).
  const iban = incoming.iban ?? null;
  if (iban !== null && known.iban !== undefined && known.iban !== iban && hasIbanField(known.type)) {
    steps.push({ action: "iban", id: known.id, iban });
  }
  return steps;
}

/** A provider's account not tied yet: adopted by a manual one of its name, refused, or created. */
function newStep(
  incoming: RemoteAccount,
  adoptable: Map<string, LocalAccount>,
  local: readonly LocalAccount[],
): ReconcileStep {
  const candidate = adoptable.get(nameKey(incoming.name));
  if (candidate) {
    adoptable.delete(nameKey(incoming.name));
    return { action: "adopt", id: candidate.id, remote: incoming };
  }
  const iban = incoming.iban ?? null;
  const holder = iban === null ? null : ibanConflict(iban, local.flatMap(asHolder));
  if (holder !== null && holder.kind === "exists") {
    return { action: "ibanExists", remote: incoming, accountId: holder.accountId };
  }
  return { action: "create", remote: incoming };
}

/* Account modes and manual movements (rewrite plan, 12-account-modes.md) */

/**
 * How an account with movements is kept (§12.1): by hand, by a source that reads and is written
 * to, or by a source that only reads. Derived, never stored, and never from a provider's name.
 */
export type AccountMode = "manual" | "two_way" | "read_only";

/** The types whose value is a portfolio's, not a list of movements: they have no mode. */
const TYPES_WITHOUT_MODE: readonly AccountType[] = ["investment", "pension", "crypto"];

/** Whether an account of this type has the IBAN field: the accounts with a mode (H47). */
export function hasIbanField(type: AccountType): boolean {
  return !TYPES_WITHOUT_MODE.includes(type);
}

/** One of the person's accounts as the rule "one IBAN, one account" reads it. */
export interface IbanHolder {
  id: string;
  name: string;
  iban: string | null;
  state: AccountState;
}

/** A local account as a holder of an IBAN, when its caller gave one. */
function asHolder(account: LocalAccount): IbanHolder[] {
  return account.iban === undefined ? [] : [{ ...account, iban: account.iban }];
}

/** Why an IBAN cannot be written on an account, and which account already has it. */
type IbanConflict = { kind: "exists" | "archived"; accountId: string; name: string };

/**
 * The rule "one IBAN, one account" (H39), with no provider in it: the account of the person that
 * already has this IBAN, if any, leaving out `self`. An account that is not archived wins over an
 * archived one, so the warning names the account the person sees. Accounts in the person's own
 * order: the same input always names the same account.
 */
export function ibanConflict(
  iban: string,
  holders: readonly IbanHolder[],
  self: string | null = null,
): IbanConflict | null {
  const same = holders.filter((holder) => holder.id !== self && holder.iban === iban);
  const open = same.find((holder) => holder.state !== "archived");
  if (open) return { kind: "exists", accountId: open.id, name: open.name };
  const archived = same[0];
  return archived ? { kind: "archived", accountId: archived.id, name: archived.name } : null;
}

/**
 * The mode of an account, `null` for one that has none. `source` is what the account's source
 * says it can do, `null` when the account has no source.
 */
export function accountMode(
  account: { type: AccountType; origin: AccountOrigin },
  source: { createsRecords: boolean } | null,
): AccountMode | null {
  if (TYPES_WITHOUT_MODE.includes(account.type)) return null;
  if (account.origin === "manual" || source === null) return "manual";
  return source.createsRecords ? "two_way" : "read_only";
}

// The calls of the accounts' forms to `/api/v1` (rewrite plan R3): each keeps the name and the answer of
// the Server Action it replaces — `{ ok }` or the use case's code — so a form reads one shape whatever
// sent it. An amount is typed in the person's number format and travels as a plain decimal.
import { accounts, accountSwitch, balances, links, summary, views } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { ACCOUNT_TYPES, REMINDERS, TRENDS } from "@ledgerly/domain/accounts/client";
import { invalidate, read } from "@ledgerly/ui/data";

export type ActionResult = { ok: true } | { ok: false; error: string; other?: string };

/** The use case's code: the route names it as the refusal's reason, or as the refusal itself. */
const codeOf = (error: unknown): string | null =>
  error instanceof ApiError && error.status < 500 ? (error.reason ?? error.code) : null;

/**
 * A refusal the form names, with the account that already has the IBAN when that is the refusal
 * (never the IBAN); anything else is thrown, and the form says the save failed.
 */
function refused(error: unknown): { ok: false; error: string; other?: string } {
  const code = codeOf(error);
  if (code === null) throw error;
  return error instanceof ApiError && error.other !== null
    ? { ok: false, error: code, other: error.other }
    : { ok: false, error: code };
}

/** A value of a closed list, or the refusal the server would give it. */
function oneOf<T extends string>(list: readonly T[], value: string): T {
  const found = list.find((one) => one === value);
  if (found === undefined) throw new RangeError(`not one of the list: ${value}`);
  return found;
}

/** Text the form left empty is no value. */
const textOrNull = (value: string) => (value.trim() === "" ? null : value);

async function writing(work: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

/** Typed text in the person's own number format, as the decimal the contract takes. */
async function decimal(text: string): Promise<string> {
  const preferences = await read(profile.getPreferences, {});
  return centsToDecimal(parseAmount(text, numberStyle(preferences)));
}

/** What the balance-entry form sends, for both the new entry and the correction of one. */
export interface BalanceEntryFormInput {
  on: string;
  amount: string;
  /** What was spendable that day, blank when unknown. */
  available: string;
  note: string;
}

async function entryBody(input: BalanceEntryFormInput) {
  return {
    on: input.on,
    balance: await decimal(input.amount),
    available: input.available.trim() === "" ? null : await decimal(input.available),
    note: input.note,
  };
}

/** An amount the person's format cannot read is the form's `invalid`, as on the server. */
async function entryWrite(
  input: BalanceEntryFormInput,
  send: (body: Awaited<ReturnType<typeof entryBody>>) => Promise<unknown>,
) {
  let body: Awaited<ReturnType<typeof entryBody>>;
  try {
    body = await entryBody(input);
  } catch (error) {
    if (error instanceof RangeError) return { ok: false as const, error: "invalid" };
    throw error;
  }
  return writing(() => send(body));
}

export function saveBalanceEntryAction(accountId: string, input: BalanceEntryFormInput) {
  return entryWrite(input, (body) =>
    call(balances.recordAccountBalance, { params: { id: accountId }, body }),
  );
}

export function updateBalanceEntryAction(accountId: string, entryId: string, input: BalanceEntryFormInput) {
  return entryWrite(input, (body) =>
    call(balances.updateBalanceEntry, { params: { id: accountId, entryId }, body }),
  );
}

/**
 * «Move the opening» (PERS-678): the opening balance as the person recorded it, dated `moveTo` — the
 * day before the first movement it left out — so the balance counts those movements.
 */
export function moveOpeningAction(
  accountId: string,
  opening: { id: string; balance: string; available: string | null; note: string | null },
  moveTo: string,
) {
  // A balance written on that day since the banner was read stays: the server refuses (`balance_exists`).
  const body = {
    on: moveTo,
    balance: opening.balance,
    available: opening.available,
    note: opening.note,
    replace: false,
  };
  return writing(async () => {
    await call(balances.updateBalanceEntry, { params: { id: accountId, entryId: opening.id }, body });
    await invalidate(
      balances.getAccountBalances,
      views.getNetWorth,
      views.getAccountDailyBalances,
      views.getAccountContext,
      accounts.getAccount,
    );
  });
}

export function deleteBalanceEntryAction(accountId: string, entryId: string) {
  return writing(() => call(balances.deleteBalanceEntry, { params: { id: accountId, entryId } }));
}

export function archiveAccountAction(id: string) {
  return writing(() => call(accounts.archiveAccount, { params: { id } }));
}

export function restoreAccountAction(id: string) {
  return writing(() => call(accounts.restoreAccount, { params: { id } }));
}

/** «Take snapshot now» (spec §10.3): the month before today's, as the monthly job takes. */
export async function runSnapshotNowAction() {
  const result = await writing(() => call(summary.runSnapshot, { body: {} }));
  if (result.ok) invalidate(summary.listSnapshots);
  return result;
}

interface LinkInput {
  channel: "iban" | "card";
  name: string;
  note?: string | null;
}

export function addConnectionAction(accountId: string, input: LinkInput) {
  return writing(() => call(links.addAccountLink, { params: { id: accountId }, body: input }));
}

export function updateConnectionAction(accountId: string, linkId: string, input: LinkInput) {
  return writing(() => call(links.updateAccountLink, { params: { id: accountId, linkId }, body: input }));
}

export function removeConnectionAction(accountId: string, linkId: string) {
  return writing(() => call(links.removeAccountLink, { params: { id: accountId, linkId } }));
}

// ——— «Move the account to the bank» (ux/n4-account-switch.md) ———————————————————————————————————

type SwitchRefusal = { ok: false; error: string; retryAt: string | null };

function refusal(error: unknown): SwitchRefusal {
  if (!(error instanceof ApiError) || error.status >= 500)
    return { ok: false, error: "failed", retryAt: null };
  if (error.code === "rate_limited") return { ok: false, error: "rate_limited", retryAt: error.reason };
  return { ok: false, error: error.reason ?? error.code, retryAt: null };
}

/** The dry run (§6): nothing is written but the normal update of the source of before. */
export async function checkSwitchAction(
  accountId: string,
  target: { connectionId: string; bankAccountId: string },
) {
  try {
    const report = await call(accountSwitch.checkAccountSwitch, { params: { id: accountId }, body: target });
    return { ok: true as const, report };
  } catch (error) {
    return refusal(error);
  }
}

/** "Apply" (§8): only with the print of the report the person read. */
export async function applySwitchAction(
  accountId: string,
  target: { connectionId: string; bankAccountId: string; fingerprint: string },
) {
  try {
    const outcome = await call(accountSwitch.applyAccountSwitch, { params: { id: accountId }, body: target });
    return { ok: true as const, ...outcome };
  } catch (error) {
    return refusal(error);
  }
}

/** "Undo switch" (§10). */
export async function undoSwitchAction(accountId: string) {
  try {
    await call(accountSwitch.undoAccountSwitch, { params: { id: accountId } });
    return { ok: true as const };
  } catch (error) {
    return refusal(error);
  }
}

// ——— The account itself ————————————————————————————————————————————————————————————————————————

interface NewAccountInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
  iban: string;
  purpose: string;
  openedOn: string | null;
  notes: string;
  openingBalance: { on: string; amount: string } | null;
}

/** Creates a manual account, with its opening balance when given; answers its id. */
export async function createAccountAction(
  input: NewAccountInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string; other?: string }> {
  try {
    const body = {
      name: input.name,
      type: oneOf(ACCOUNT_TYPES, input.type),
      currency: input.currency,
      color: input.color,
      reference: textOrNull(input.reference),
      iban: textOrNull(input.iban),
      purpose: textOrNull(input.purpose),
      openedOn: input.openedOn,
      notes: textOrNull(input.notes),
      openingBalance: input.openingBalance
        ? { on: input.openingBalance.on, amount: await decimal(input.openingBalance.amount) }
        : null,
    };
    const account = await call(accounts.createAccount, { body });
    return { ok: true, id: account.id };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: "invalid" };
    return refused(error);
  }
}

interface AccountSettingsFormInput {
  name: string;
  type: string;
  currency: string;
  color: string | null;
  reference: string;
  iban: string;
  purpose: string;
  openedOn: string | null;
  notes: string;
  inNetWorth: boolean;
  inSnapshot: boolean;
  countsAsLiquid: boolean;
  lowBalance: string | null;
  staleAfterHours: number;
  reminder: string;
  betweenEntries: string;
}

/** Saves the account's settings: every field of the form. */
export async function saveAccountSettingsAction(
  id: string,
  input: AccountSettingsFormInput,
): Promise<ActionResult> {
  try {
    const body = {
      ...input,
      type: oneOf(ACCOUNT_TYPES, input.type),
      reminder: oneOf(REMINDERS, input.reminder),
      betweenEntries: oneOf(TRENDS, input.betweenEntries),
      reference: textOrNull(input.reference),
      iban: textOrNull(input.iban),
      purpose: textOrNull(input.purpose),
      notes: textOrNull(input.notes),
      lowBalance: input.lowBalance ? await decimal(input.lowBalance) : null,
    };
    await call(accounts.updateAccount, { params: { id }, body });
    return { ok: true };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: "invalid" };
    return refused(error);
  }
}

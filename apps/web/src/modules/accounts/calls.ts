// The calls of the accounts' forms to `/api/v1` (rewrite plan R3): each keeps the name and the answer of
// the Server Action it replaces — `{ ok }` or the use case's code — so a form reads one shape whatever
// sent it. An amount is typed in the person's number format and travels as a plain decimal.
import { ACCOUNTS, SETTINGS } from "@ledgerly/api-contract";
import { ApiError, call } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { read } from "@ledgerly/ui/data";

// Creating an account and saving its settings stay Server Actions until a refusal of `/api/v1` names
// the account that already has the IBAN (`baselines/server-actions.json`): the forms read them here.
export { createAccountAction, saveAccountSettingsAction } from "./actions";

export type ActionResult = { ok: true } | { ok: false; error: string; other?: string };

const { balances, links, accounts, summary } = ACCOUNTS;

/** The use case's code: the route names it as the refusal's reason, or as the refusal itself. */
const codeOf = (error: unknown): string | null =>
  error instanceof ApiError && error.status < 500 ? (error.reason ?? error.code) : null;

/** A refusal the form names; anything else is thrown, and the form says the save failed. */
function refused(error: unknown): { ok: false; error: string } {
  const code = codeOf(error);
  if (code === null) throw error;
  return { ok: false, error: code };
}

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
  const preferences = await read(SETTINGS.profile.getPreferences, {});
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
export function runSnapshotNowAction() {
  return writing(() => call(summary.runSnapshot, { body: {} }));
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

const routes = ACCOUNTS.switch;

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
    const report = await call(routes.checkAccountSwitch, { params: { id: accountId }, body: target });
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
    const outcome = await call(routes.applyAccountSwitch, { params: { id: accountId }, body: target });
    return { ok: true as const, ...outcome };
  } catch (error) {
    return refusal(error);
  }
}

/** "Undo switch" (§10). */
export async function undoSwitchAction(accountId: string) {
  try {
    await call(routes.undoAccountSwitch, { params: { id: accountId } });
    return { ok: true as const };
  } catch (error) {
    return refusal(error);
  }
}

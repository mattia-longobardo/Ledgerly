// The manual movement's calls to `/api/v1` (rewrite plan R3): the `ManualCommands` the dialog is
// handed, with the answers of the Server Actions they replace. The amount is typed in the person's
// number format and travels as the decimal of its size; the dialog gets dates and money formatted.
import { manual, movements, review, spending } from "@ledgerly/api-contract/transactions";
import { views } from "@ledgerly/api-contract/accounts";
import { categoryBoard, profile } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { centsToDecimal, parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, numberStyle, parseAmount } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";
import type { ManualCommands, ManualForm, ManualSaveResult } from "./ui/manual-types";

type Refusal = Extract<ManualSaveResult, { ok: false }>;

/** What a manual write changes: the movements, the balances of its accounts (a giroconto's other one too) and Overview. */
function changed(): void {
  invalidate(
    movements.getTransactionsView,
    movements.listTransactions,
    movements.getTransaction,
    spending.getSpending,
    spending.getSpendingBreakdown,
    spending.getSpendingSeries,
    review.getReview,
    views.getNetWorth,
    views.getAccountContext,
    views.getAccountDailyBalances,
    categoryBoard.getCategoriesBoard,
  );
}

/** The use case's code: the reason of a refusal, or the refusal itself; a failure of the server throws. */
function codeOf(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) return error.reason ?? error.code;
  throw error;
}

/** The dialog's words for a refusal of the use case (`expenses.manual.errors`). */
function refusal(error: unknown): Refusal {
  switch (codeOf(error)) {
    case "amount":
      return { ok: false, error: "amount" };
    case "future_date":
      return { ok: false, error: "date" };
    case "account_unavailable":
      return { ok: false, error: "account" };
    case "not_found":
    case "not_manual":
      return { ok: false, error: "notFound" };
    default:
      return { ok: false, error: "failed" };
  }
}

async function preferences() {
  return read(profile.getPreferences, {});
}

/** The size of the typed amount as a decimal, or `null` for what is not an amount above zero. */
function sizeOf(amount: string, prefs: Awaited<ReturnType<typeof preferences>>): string | null {
  try {
    const cents = parseAmount(amount, numberStyle(prefs));
    return cents > 0n ? centsToDecimal(cents) : null;
  } catch {
    return null;
  }
}

async function write(
  input: ManualForm,
  save: (movement: ManualForm & { amount: string }) => Promise<{ id: string; created: boolean }>,
): Promise<ManualSaveResult> {
  const prefs = await preferences();
  const amount = sizeOf(input.amount, prefs);
  if (amount === null) return { ok: false, error: "amount" };
  try {
    const saved = await save({ ...input, amount });
    changed();
    return {
      ok: true,
      ...saved,
      on: input.on,
      date: formatDate(input.on, "long", prefs.locale),
      accountId: input.accountId,
    };
  } catch (error) {
    return refusal(error);
  }
}

const fields = (movement: ManualForm) => ({
  kind: movement.kind,
  amount: movement.amount,
  on: movement.on,
  accountId: movement.accountId,
  categoryId: movement.categoryId,
  payee: movement.payee,
  note: movement.note,
  transferAccountId: movement.transferAccountId,
});

export const MANUAL_CALLS: Required<ManualCommands> = {
  form: () => call(manual.getManualForm, {}),

  async preview(input) {
    const prefs = await preferences();
    const amount = sizeOf(input.amount, prefs);
    if (amount === null) return null;
    const { preview } = await call(manual.previewManualMovement, {
      body: {
        kind: input.kind,
        amount,
        on: input.on,
        accountId: input.accountId,
        editingId: input.editingId,
      },
    });
    if (preview === null) return null;
    if (preview.kind === "unchanged") {
      return {
        kind: "unchanged",
        account: preview.account,
        date: formatDate(preview.readingOn, "long", prefs.locale),
        opening: preview.opening,
      };
    }
    const style = numberStyle(prefs);
    return {
      kind: "change",
      account: preview.account,
      before: formatMoney(parseCents(preview.before), style),
      after: formatMoney(parseCents(preview.after), style),
    };
  },

  async suggest(input) {
    const amount = sizeOf(input.amount, await preferences());
    if (amount === null) return null;
    try {
      return await call(manual.suggestManualCategory, { body: { ...input, amount } });
    } catch {
      // A suggestion is a help, never an error.
      return null;
    }
  },

  create: (input, key) =>
    write(input, (movement) => call(manual.createManualMovement, { body: { ...fields(movement), key } })),

  update: (id, input) =>
    write(input, (movement) => call(manual.updateManualMovement, { params: { id }, body: fields(movement) })),

  async remove(id) {
    try {
      await call(manual.deleteManualMovement, { params: { id } });
      changed();
      return { ok: true, count: 1 };
    } catch (error) {
      return { ok: false, error: refusal(error).error };
    }
  },

  async retrySend(id) {
    try {
      const { sent } = await call(manual.retryManualSend, { params: { id } });
      changed();
      return { ok: true, sent };
    } catch (error) {
      codeOf(error);
      return { ok: false };
    }
  },
};

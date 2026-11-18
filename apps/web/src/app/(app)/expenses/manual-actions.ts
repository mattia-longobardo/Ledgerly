// src/app/(app)/expenses/manual-actions.ts — the Server Actions of the manual movement and of the
// visibility of the Expenses rows: validate → use case (`manual.ts`) → revalidate, nothing else.
// They are here and not in a module because each joins two modules (`manual.ts` says why).
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { suggestFor } from "@ledgerly/domain/transactions";
import { MANUAL_KINDS } from "@ledgerly/domain/transactions";
import { TransactionError } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import { coreConnectionAction } from "../settings/integrations/actions";
import {
  changeVisibility,
  createManual,
  deleteManual,
  type ManualAccount,
  manualAccounts,
  previewManual,
  retrySend,
  updateManual,
} from "./manual";
import { civilDate } from "@ledgerly/api-contract";

/** What the dialog sends: the amount as the person typed it, in their own number format. */
const formSchema = z.object({
  kind: z.enum(MANUAL_KINDS),
  amount: z.string().max(40),
  on: civilDate(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  payee: z.string().max(255),
  note: z.string().max(2000),
});
type ManualFormInput = z.input<typeof formSchema>;

/** `error` is a key under `expenses.manual.errors`. */
type ManualResult =
  | { ok: true; created: boolean; id: string; on: CivilDate; date: string; accountId: string }
  | { ok: false; error: "amount" | "date" | "account" | "notFound" | "failed" };
type ManualCount = { ok: true; count: number } | { ok: false; error: string };

type Refusal = Extract<ManualResult, { ok: false }>;

function refusal(error: unknown): Refusal {
  if (error instanceof z.ZodError) return { ok: false, error: "failed" };
  if (!(error instanceof TransactionError)) throw error;
  switch (error.code) {
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

/** The size of the amount, greater than zero, or `null` for what is not one. */
function sizeOf(amount: string, format: Parameters<typeof parseAmount>[1]): Cents | null {
  try {
    const cents = parseAmount(amount, format);
    return cents > 0n ? cents : null;
  } catch {
    return null;
  }
}

function revalidate(): void {
  revalidatePath("/expenses");
  revalidatePath("/accounts");
  revalidatePath("/");
}

async function write(
  input: ManualFormInput,
  save: (
    ctx: Awaited<ReturnType<typeof requireSession>>,
    movement: unknown,
  ) => Promise<{ id: string; created: boolean }>,
): Promise<ManualResult> {
  const ctx = await requireSession();
  const form = formSchema.safeParse(input);
  if (!form.success) return { ok: false, error: "failed" };
  const amountCents = sizeOf(form.data.amount, ctx.numberFormat);
  if (amountCents === null) return { ok: false, error: "amount" };
  try {
    const saved = await save(ctx, { ...form.data, amount: undefined, amountCents });
    revalidate();
    return {
      ok: true,
      ...saved,
      on: form.data.on,
      // The day as the toast says it: a component never formats a date.
      date: formatDate(form.data.on, "long", ctx.locale),
      accountId: form.data.accountId,
    };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * Writes a manual movement. `key` is the dialog's own, made when it opened: a second request with
 * it — a double click, a retry after a lost answer — answers with the row already written.
 */
export async function createManualAction(input: ManualFormInput, key: string): Promise<ManualResult> {
  if (!z.uuid().safeParse(key).success) return { ok: false, error: "failed" };
  return write(input, async (ctx, movement) => {
    const { transaction, created } = await createManual(ctx, movement, key);
    return { id: transaction.id, created };
  });
}

export async function updateManualAction(id: string, input: ManualFormInput): Promise<ManualResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "notFound" };
  return write(input, async (ctx, movement) => {
    const transaction = await updateManual(ctx, id, movement);
    return { id: transaction.id, created: false };
  });
}

export async function deleteManualAction(id: string): Promise<ManualCount> {
  const ctx = await requireSession();
  try {
    await deleteManual(ctx, id);
    revalidate();
    return { ok: true, count: 1 };
  } catch (error) {
    return { ok: false, error: refusal(error).error };
  }
}

/**
 * "Retry sending" on a movement its source did not take: the source is updated now. The answer
 * says only whether the movement went; why it did not is the connection's state, in Settings.
 */
export async function retrySendAction(id: string): Promise<{ ok: true; sent: boolean } | { ok: false }> {
  const ctx = await requireSession();
  try {
    const { sent } = await retrySend(ctx, id, (provider) => coreConnectionAction(provider, "update"));
    revalidate();
    return { ok: true, sent };
  } catch (error) {
    if (error instanceof TransactionError) return { ok: false };
    throw error;
  }
}

const idsSchema = z.array(z.uuid()).min(1).max(500);

/** Hide, restore and delete over a selection, with the balance of a manual movement kept right. */
export async function changeVisibilityAction(
  ids: string[],
  change: "hide" | "restore" | "delete",
): Promise<ManualCount> {
  const ctx = await requireSession();
  const wanted = idsSchema.safeParse(ids);
  if (!wanted.success || !["hide", "restore", "delete"].includes(change))
    return { ok: false, error: "invalid" };
  try {
    const count = await changeVisibility(ctx, wanted.data, change);
    revalidate();
    return { ok: true, count };
  } catch (error) {
    if (error instanceof TransactionError) return { ok: false, error: error.code };
    throw error;
  }
}

/** What the dialog reads when it opens: the accounts it may offer, and today where the person is. */
export async function manualFormAction(): Promise<{ accounts: ManualAccount[]; today: CivilDate }> {
  const ctx = await requireSession();
  return { accounts: await manualAccounts(ctx), today: today(ctx.timeZone) };
}

/** The line under the dialog's account: every number already formatted, none worked out there. */
type ManualPreview =
  | { kind: "change"; account: string; before: string; after: string }
  | { kind: "unchanged"; account: string; date: string }
  | null;

const previewSchema = formSchema
  .pick({ kind: true, amount: true, on: true, accountId: true })
  .extend({ editingId: z.uuid().optional() });

/** A read, like the payee search: it revalidates nothing and answers `null` for what it cannot say. */
export async function previewManualAction(input: z.input<typeof previewSchema>): Promise<ManualPreview> {
  const ctx = await requireSession();
  const form = previewSchema.safeParse(input);
  if (!form.success) return null;
  const amountCents = sizeOf(form.data.amount, ctx.numberFormat);
  if (amountCents === null) return null;
  const { kind, on, accountId, editingId } = form.data;
  const preview = await previewManual(ctx, { kind, on, accountId, editingId, amountCents });
  if (preview === null || preview.effect.kind === "none") return null;
  if (preview.effect.kind === "unchanged") {
    return {
      kind: "unchanged",
      account: preview.account,
      date: formatDate(preview.effect.readingOn, "long", ctx.locale),
    };
  }
  return {
    kind: "change",
    account: preview.account,
    before: formatMoney(preview.effect.before, ctx.numberFormat),
    after: formatMoney(preview.effect.after, ctx.numberFormat),
  };
}

const suggestSchema = formSchema.pick({ kind: true, amount: true, accountId: true, payee: true, note: true });

/**
 * The category the cascade would give the manual movement being written, from what is already
 * known about the person: nothing is learnt and nothing is written. `null` for none and for
 * anything the action cannot read — a suggestion is a help, never an error.
 */
export async function suggestManualAction(
  input: z.input<typeof suggestSchema>,
): Promise<{ categoryId: string } | null> {
  const ctx = await requireSession();
  const form = suggestSchema.safeParse(input);
  if (!form.success) return null;
  const size = sizeOf(form.data.amount, ctx.numberFormat);
  if (size === null) return null;
  const answer = await suggestFor(ctx, {
    payee: form.data.payee,
    counterparty: null,
    rawText: null,
    note: form.data.note,
    accountId: form.data.accountId,
    amountCents: form.data.kind === "expense" ? -size : size,
    kind: form.data.kind,
    merchantCategoryCode: null,
    bankTransactionCode: null,
  });
  return answer === null ? null : { categoryId: answer.categoryId };
}

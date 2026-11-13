// src/modules/investments/actions.ts — the Investments Server Actions: validate → service →
// revalidate. Amounts, quantities and prices arrive as typed text in the user's number format and
// become cents and fixed-point decimals here.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { AccountError } from "@/modules/accounts/service";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import { numberSeparators, type NumberFormat } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { parseDecimal, plainDecimal, PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import {
  confirmZeroReading,
  createManualService,
  deleteOperation,
  InvestmentError,
  linkTransfer,
  type ManualServiceInput,
  type OperationInput,
  recordOperation,
  reconcileHolding,
  unlinkTransfer,
  updateServiceUrl,
  updateServiceValue,
} from "./service";
import {
  type ConnectTarget,
  confirmKeyRevoked,
  connectInvestmentProvider,
  disconnectProvider,
  replaceKey,
  SyncError,
  syncNow,
  verifyKey,
} from "./sync";

export type ActionResult = { ok: true } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof InvestmentError) return { ok: false, error: error.code };
  if (error instanceof SyncError) return { ok: false, error: error.code };
  if (error instanceof AccountError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(accountId?: string): void {
  revalidatePath("/investments");
  revalidatePath("/investments/catalog");
  // The service's tabs share its layout (header, tabs, period): every one of them is redrawn.
  if (accountId) revalidatePath(`/investments/${accountId}`, "layout");
  revalidatePath("/accounts");
  revalidatePath("/");
}

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

function money(value: string | null | undefined, format: NumberFormat): Cents | null {
  return blank(value) ? null : parseAmount(value as string, format);
}

function number(value: string | null | undefined, format: NumberFormat, scale: number): bigint | null {
  return blank(value) ? null : parseDecimal(plainDecimal(value as string, numberSeparators(format)), scale);
}

export async function createManualServiceAction(
  input: ManualServiceInput,
): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { accountId } = await createManualService(ctx, input);
    revalidate(accountId);
    return { ok: true, accountId };
  } catch (error) {
    return failed(error);
  }
}

export async function updateServiceUrlAction(accountId: string, url: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateServiceUrl(ctx, accountId, url);
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/**
 * "Update value" of a manual service (PERS-342): the value read at the broker, written as the
 * account's manual balance in Accounts.
 */
export async function updateServiceValueAction(
  accountId: string,
  input: { on: string; amount: string },
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const cents = money(input.amount, ctx.numberFormat);
    if (cents === null) return { ok: false, error: "invalid" };
    await updateServiceValue(ctx, accountId, { on: input.on, cents });
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface OperationFormInput {
  kind:
    "deposit" | "withdrawal" | "account_valuation" | "valuation" | "sell" | "close" | "income" | "adjustment";
  on: string;
  amount: string;
  holdingId?: string | null;
  quantity?: string;
  unitPrice?: string;
  fee?: string;
  validUntil?: string | null;
  /** A correction's class (§4.9 of the UX design): `data`, `capital` or `result`. */
  adjustmentClass?: string;
  transactionId?: string | null;
  note: string;
}

/** The typed form as the service's input: the same parsing for a new operation and for an edit. */
function operationOf(input: OperationFormInput, format: NumberFormat): OperationInput {
  const amount = money(input.amount, format);
  switch (input.kind) {
    case "deposit":
    case "withdrawal":
      return {
        kind: input.kind,
        on: input.on,
        amountCents: amount ?? 0n,
        transactionId: input.transactionId || null,
        note: input.note,
      };
    case "account_valuation":
      return { kind: input.kind, on: input.on, amountCents: amount ?? 0n, note: input.note };
    case "valuation": {
      const unitPrice = number(input.unitPrice, format, PRICE_SCALE);
      return {
        kind: input.kind,
        holdingId: input.holdingId ?? "",
        on: input.on,
        unitPrice,
        amountCents: unitPrice === null ? amount : null,
        note: input.note,
      };
    }
    case "sell":
    case "close": {
      const quantity = number(input.quantity, format, QUANTITY_SCALE);
      const unitPrice = number(input.unitPrice, format, PRICE_SCALE);
      return {
        kind: input.kind,
        holdingId: input.holdingId ?? "",
        on: input.on,
        quantity,
        unitPrice: quantity === null ? null : unitPrice,
        amountCents: quantity === null || unitPrice === null ? amount : null,
        feeCents: money(input.fee, format) ?? 0n,
        note: input.note,
      };
    }
    case "income":
      return {
        kind: input.kind,
        holdingId: input.holdingId || null,
        on: input.on,
        amountCents: amount ?? 0n,
        note: input.note,
      };
    case "adjustment":
      return {
        kind: input.kind,
        on: input.on,
        amountCents: amount ?? 0n,
        validUntil: input.validUntil || null,
        adjustmentClass: (input.adjustmentClass || "data") as "data",
        note: input.note,
      };
  }
}

/**
 * What the person may no longer type (PERS-342): money in and out and the value come from Accounts
 * on a manual service, and from the provider on a synced one.
 */
const VALUE_KINDS: ReadonlySet<OperationFormInput["kind"]> = new Set([
  "deposit",
  "withdrawal",
  "account_valuation",
  "adjustment",
]);

export async function recordOperationAction(
  accountId: string,
  input: OperationFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  if (VALUE_KINDS.has(input.kind)) return { ok: false, error: "not_editable" };
  try {
    await recordOperation(ctx, accountId, operationOf(input, ctx.numberFormat));
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteOperationAction(accountId: string, eventId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteOperation(ctx, eventId);
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface ReconcileFormInput {
  holdingId: string;
  kind: "covered_by_provider" | "partial" | "outside_scope" | "reopened";
  effectiveOn: string;
  quantity: string;
  product: string;
  readingId: string | null;
}

export async function reconcileAction(accountId: string, input: ReconcileFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await reconcileHolding(ctx, {
      holdingId: input.holdingId,
      kind: input.kind,
      effectiveOn: input.effectiveOn,
      quantity: input.kind === "partial" ? number(input.quantity, ctx.numberFormat, QUANTITY_SCALE) : null,
      product: input.kind === "outside_scope" ? input.product : null,
      readingId: input.readingId,
    });
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function confirmZeroAction(accountId: string, readingId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await confirmZeroReading(ctx, readingId);
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** A withdrawal and a deposit of two services linked as one transfer (§2.4): both pages change. */
export async function linkTransferAction(
  accountId: string,
  withdrawalId: string,
  depositId: string,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await linkTransfer(ctx, { withdrawalId, depositId });
    revalidate(accountId);
    revalidatePath("/investments/[accountId]", "layout");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function unlinkTransferAction(accountId: string, eventId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await unlinkTransfer(ctx, eventId);
    revalidate(accountId);
    revalidatePath("/investments/[accountId]", "layout");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

// ——— Connected services (docs/design/investments.md §4.2, §4.3, §5) ——————————————————————————
// The key fields are write only: they arrive here, go to `connectInvestmentProvider` or
// `replaceKey`, and are never sent back nor named in a result.

export async function connectProviderAction(
  provider: string,
  credentials: Record<string, string>,
  target: ConnectTarget,
): Promise<{ ok: true; accountId: string; ipRestricted: boolean | null } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    // The first flows run after the answer: 24 months of an exchange take minutes (§3.2).
    const { accountId, ipRestricted } = await connectInvestmentProvider(
      ctx,
      provider,
      credentials,
      target,
      new Date(),
      (work) => after(work),
    );
    revalidate(accountId);
    revalidatePath("/settings/integrations");
    return { ok: true, accountId, ipRestricted };
  } catch (error) {
    return failed(error);
  }
}

export async function syncNowAction(accountId: string): Promise<ActionResult & { outcome?: string }> {
  const ctx = await requireSession();
  try {
    const outcome = await syncNow(ctx, accountId, new Date(), (work) => after(work));
    revalidate(accountId);
    return outcome === "answered" ? { ok: true, outcome } : { ok: false, error: `sync_${outcome}` };
  } catch (error) {
    return failed(error);
  }
}

export async function verifyKeyAction(accountId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const result = await verifyKey(ctx, accountId);
    revalidate(accountId);
    return result === "read-only" ? { ok: true } : { ok: false, error: "not_read_only" };
  } catch (error) {
    return failed(error);
  }
}

export async function replaceKeyAction(
  accountId: string,
  credentials: Record<string, string>,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await replaceKey(ctx, accountId, credentials);
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function disconnectProviderAction(accountId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await disconnectProvider(ctx, accountId);
    revalidate(accountId);
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function confirmKeyRevokedAction(accountId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await confirmKeyRevoked(ctx, accountId);
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

// src/modules/investments/actions.ts — the Investments Server Actions: validate → service →
// revalidate. Amounts, quantities and prices arrive as typed text in the user's number format and
// become cents and fixed-point decimals here.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccountError } from "@/modules/accounts/service";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import { numberSeparators, type NumberFormat } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { parseDecimal, plainDecimal, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE } from "./rules";
import {
  addAsset,
  type AssetInput,
  confirmZeroReading,
  convertMode,
  createManualService,
  deleteOperation,
  InvestmentError,
  type ManualServiceInput,
  type OperationInput,
  recordOperation,
  reconcileHolding,
  updateOperation,
  updateServiceUrl,
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
  if (accountId) revalidatePath(`/investments/${accountId}`);
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

export interface AssetFormInput {
  asset: { id: string } | { create: AssetInput };
  product: string;
  on: string;
  quantity: string;
  unitPrice: string;
  total: string;
  fee: string;
  fxRate: string;
  note: string;
}

export async function addAssetAction(accountId: string, input: AssetFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const format = ctx.numberFormat;
    const quantity = number(input.quantity, format, QUANTITY_SCALE);
    await addAsset(ctx, accountId, {
      asset: input.asset,
      product: input.product,
      on: input.on,
      quantity,
      unitPrice: quantity === null ? null : number(input.unitPrice, format, PRICE_SCALE),
      totalCents: quantity === null ? money(input.total, format) : null,
      feeCents: money(input.fee, format) ?? 0n,
      fxRate: number(input.fxRate, format, RATE_SCALE),
      note: input.note,
    });
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
        note: input.note,
      };
  }
}

export async function recordOperationAction(
  accountId: string,
  input: OperationFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await recordOperation(ctx, accountId, operationOf(input, ctx.numberFormat));
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function updateOperationAction(
  accountId: string,
  eventId: string,
  input: OperationFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateOperation(ctx, eventId, operationOf(input, ctx.numberFormat));
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

export interface ConversionFormInput {
  to: "assets" | "total";
  positions: {
    asset: { id: string } | { create: AssetInput };
    product: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }[];
  acceptNegativeCash: boolean;
}

export async function convertModeAction(
  accountId: string,
  input: ConversionFormInput,
): Promise<{ ok: true; openingCashCents: string | null } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const format = ctx.numberFormat;
    const result = await convertMode(
      ctx,
      accountId,
      input.to === "total"
        ? { to: "total" }
        : {
            to: "assets",
            acceptNegativeCash: input.acceptNegativeCash,
            positions: input.positions.map((position) => {
              const quantity = number(position.quantity, format, QUANTITY_SCALE);
              return {
                asset: position.asset,
                product: position.product,
                quantity,
                unitPrice: quantity === null ? null : number(position.unitPrice, format, PRICE_SCALE),
                totalCents: quantity === null ? money(position.total, format) : null,
              };
            }),
          },
    );
    revalidate(accountId);
    return { ok: true, openingCashCents: result.openingCashCents?.toString() ?? null };
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

// ——— Connected services (docs/design/investments.md §4.2, §4.3, §5) ——————————————————————————
// The key fields are write only: they arrive here, go to `connectInvestmentProvider` or
// `replaceKey`, and are never sent back nor named in a result.

export async function connectProviderAction(
  provider: string,
  credentials: Record<string, string>,
  target: ConnectTarget,
): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { accountId } = await connectInvestmentProvider(ctx, provider, credentials, target);
    revalidate(accountId);
    revalidatePath("/settings/integrations");
    return { ok: true, accountId };
  } catch (error) {
    return failed(error);
  }
}

export async function syncNowAction(accountId: string): Promise<ActionResult & { outcome?: string }> {
  const ctx = await requireSession();
  try {
    const outcome = await syncNow(ctx, accountId);
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

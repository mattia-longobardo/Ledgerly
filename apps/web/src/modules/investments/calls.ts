// The writes of Investments to `/api/v1` (rewrite plan R3): each keeps the answer of the Server Action
// it replaces, so the dialogs read one shape. What a person typed is read here, in their number
// format, and goes on the wire as the contract's decimals: an amount with two decimals
// (`amountInput`), a quantity or a price with every decimal typed. A key goes to the session's routes
// only, and never comes back.
import { connection, investments, register } from "@ledgerly/api-contract/investments";
import { profile } from "@ledgerly/api-contract/settings";
import { call } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { type NumberFormat, numberStyle, parseAmount, plainDecimalOf } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";
import { refusal, type WriteResult } from "@/platform/writes";

export type ActionResult = WriteResult;
export type Failure = Extract<ActionResult, { ok: false }>;

/** The refusal of a call in the dialogs' words: `invalid` for a field the client cannot read. */
export function failure(error: unknown): Failure {
  // A field the client cannot read: `invalid`, as the Server Action answered.
  if (error instanceof RangeError) return { ok: false, error: "invalid" };
  return refusal(error);
}

/** What a write of a service changes: every read of the section, and the pages that show its value. */
function changed(): void {
  invalidate(...Object.values(investments));
}

/** Runs a write: its answer (`{ accountId }`…) beside `ok`, or the refusal; a success drops what is stale. */
export async function attempt<T extends object>(
  work: () => Promise<T>,
): Promise<({ ok: true } & T) | Failure> {
  try {
    const answer = await work();
    changed();
    return { ...answer, ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** A write whose route answers nothing (`204`, `202`). */
export async function done(pending: Promise<unknown>): Promise<object> {
  await pending;
  return {};
}

/** The person's number format, as the forms are typed in. */
export async function formatOf(): Promise<NumberFormat> {
  return numberStyle(await read(profile.getPreferences, {}));
}

/** An amount as typed, or null when the field is empty. */
export function amountOf(typed: string | null | undefined, format: NumberFormat): string | null {
  const field = typed ?? "";
  return field.trim() === "" ? null : centsToDecimal(parseAmount(field, format));
}

/** A quantity or a price as typed, or null when the field is empty. */
export function decimalOf(typed: string | null | undefined, format: NumberFormat): string | null {
  const field = typed ?? "";
  return field.trim() === "" ? null : plainDecimalOf(field, format);
}

export function createManualService(input: {
  accountId: string;
  category: "accounts" | "broker" | "crypto";
  url: string;
}): Promise<{ ok: true; accountId: string } | Failure> {
  return attempt(() =>
    call(register.createManualService, {
      body: { accountId: input.accountId, category: input.category, url: input.url },
    }),
  );
}

/** «Account with value only» on a new account: the account and its service in one write (R5b). */
export async function createValueAccount(input: {
  name: string;
  category: "accounts" | "broker" | "crypto";
  currency: string;
  /** As typed, in the person's number format. */
  value: string;
  url: string;
}): Promise<{ ok: true; accountId: string } | Failure> {
  return attempt(async () => {
    const value = amountOf(input.value, await formatOf());
    if (value === null) throw new RangeError("value");
    return call(register.createManualService, {
      body: { name: input.name, category: input.category, currency: input.currency, value, url: input.url },
    });
  });
}

/** A manual portfolio (R5d): on an account of Accounts, or on a new one from its name and currency. */
export function createPortfolio(
  input: { accountId: string; url: string } | { name: string; currency: string; url: string },
): Promise<{ ok: true; accountId: string } | Failure> {
  // An empty address is no address: the portfolio's route takes null, not "".
  const url = input.url.trim() === "" ? null : input.url;
  return attempt(() => call(register.createManualService, { body: { kind: "portfolio", ...input, url } }));
}

export function updateServiceUrl(accountId: string, url: string): Promise<ActionResult> {
  return attempt(() => done(call(register.updateServiceUrl, { params: { accountId }, body: { url } })));
}

/** «Update value» of a manual service: the value read at the broker, as its account's balance. */
export function updateServiceValue(
  accountId: string,
  input: { on: string; amount: string },
): Promise<ActionResult> {
  return attempt(async () => {
    const amount = amountOf(input.amount, await formatOf());
    if (amount === null) throw new RangeError("Empty amount");
    return done(call(register.updateServiceValue, { params: { accountId }, body: { on: input.on, amount } }));
  });
}

/** An operation a person writes on a holding: a valuation, a sale, a close or an income. */
export interface OperationForm {
  kind: "valuation" | "sell" | "close" | "income";
  on: string;
  amount: string;
  holdingId?: string | null;
  quantity?: string;
  unitPrice?: string;
  fee?: string;
  note: string;
}

/** A valuation: a price wins over an amount, as the Server Action read it. */
function valuationBody(input: OperationForm, format: NumberFormat) {
  const unitPrice = decimalOf(input.unitPrice, format);
  return {
    kind: "valuation" as const,
    holdingId: input.holdingId ?? "",
    on: input.on,
    unitPrice,
    amount: unitPrice === null ? amountOf(input.amount, format) : null,
    note: input.note,
  };
}

/** A sale or a close: by quantity and price, or by the amount received without either. */
function saleBody(input: OperationForm & { kind: "sell" | "close" }, format: NumberFormat) {
  const quantity = decimalOf(input.quantity, format);
  const unitPrice = decimalOf(input.unitPrice, format);
  return {
    kind: input.kind,
    holdingId: input.holdingId ?? "",
    on: input.on,
    quantity,
    unitPrice: quantity === null ? null : unitPrice,
    amount: quantity === null || unitPrice === null ? amountOf(input.amount, format) : null,
    fee: amountOf(input.fee, format) ?? "0.00",
    note: input.note,
  };
}

async function operationBody(input: OperationForm) {
  const format = await formatOf();
  if (input.kind === "valuation") return valuationBody(input, format);
  if (input.kind === "income")
    return {
      kind: input.kind,
      holdingId: input.holdingId || null,
      on: input.on,
      amount: amountOf(input.amount, format) ?? "0.00",
      note: input.note,
    };
  return saleBody({ ...input, kind: input.kind }, format);
}

export function recordOperation(accountId: string, input: OperationForm): Promise<ActionResult> {
  return attempt(async () =>
    done(call(register.recordOperation, { params: { accountId }, body: await operationBody(input) })),
  );
}

/** What «Record operation» of a manual portfolio writes besides a sale and an income (R5d). */
export type PortfolioOperationForm =
  | {
      kind: "buy";
      instrumentId: string;
      mic: string | null;
      on: string;
      quantity: string;
      /** By price: a quantity at a unit price; by amount: the total only, in the instrument's currency. */
      how: "price" | "amount";
      unitPrice: string;
      amount: string;
      fee: string;
      fxRate: string;
      note: string;
    }
  | {
      kind: "deposit" | "withdrawal";
      on: string;
      amount: string;
      note: string;
      /** The «From account»/«To account» choice as the select holds it (`counterpartOf`). */
      counterpart: string;
    };

/** The empty choice: the server pairs the leg by its own rule (PERS-651). */
export const AUTOMATIC = "";

/**
 * The other side of a deposit's or a withdrawal's leg, from the select's value: `tx:<id>` a bank
 * movement, `acc:<id>` one of the person's accounts, `outside`, `none` (an income or a spending), or
 * the automatic rule (`""`): neither field is sent.
 */
export function counterpartOf(choice: string) {
  if (choice.startsWith("tx:")) return { transactionId: choice.slice(3) };
  if (choice.startsWith("acc:"))
    return { counterpart: { kind: "account" as const, accountId: choice.slice(4) } };
  if (choice === "outside") return { counterpart: { kind: "outside" as const } };
  if (choice === "none") return { counterpart: { kind: "none" as const } };
  return {};
}

async function portfolioBody(input: PortfolioOperationForm) {
  const format = await formatOf();
  const note = input.note.trim() === "" ? null : input.note;
  if (input.kind !== "buy") {
    const amount = amountOf(input.amount, format);
    if (amount === null) throw new RangeError("amount");
    return { kind: input.kind, on: input.on, amount, note, ...counterpartOf(input.counterpart) };
  }
  const byPrice = input.how === "price";
  return {
    kind: "buy" as const,
    instrumentId: input.instrumentId,
    mic: input.mic,
    on: input.on,
    // By amount the position is kept by value: no quantity, as a sale by amount.
    quantity: byPrice ? decimalOf(input.quantity, format) : null,
    unitPrice: byPrice ? decimalOf(input.unitPrice, format) : null,
    amount: byPrice ? null : amountOf(input.amount, format),
    fee: amountOf(input.fee, format),
    fxRate: decimalOf(input.fxRate, format),
    note,
  };
}

export function recordPortfolioOperation(
  accountId: string,
  input: PortfolioOperationForm,
): Promise<ActionResult> {
  return attempt(async () =>
    done(call(register.recordOperation, { params: { accountId }, body: await portfolioBody(input) })),
  );
}

/** Where a holding's price comes from: the market's daily close, or the person (R5d). */
export function setPriceMode(
  accountId: string,
  holdingId: string,
  mode: "auto" | "manual",
): Promise<ActionResult> {
  return attempt(() =>
    done(call(register.setPriceMode, { params: { accountId, holdingId }, body: { mode } })),
  );
}

/** A position of «Switch to positions», as typed. */
export interface ConversionPosition {
  instrumentId: string;
  mic: string | null;
  quantity: string;
  unitPrice: string;
  fxRate: string;
}

/** «Switch to positions» (D4): the service kept by value becomes a manual portfolio from `on`. */
export function convertToPortfolio(
  accountId: string,
  input: { on: string; positions: readonly ConversionPosition[]; note: string },
): Promise<ActionResult> {
  return attempt(async () => {
    const format = await formatOf();
    const required = (typed: string) => {
      const value = decimalOf(typed, format);
      if (value === null) throw new RangeError("Empty field");
      return value;
    };
    const positions = input.positions.map((one) => ({
      instrumentId: one.instrumentId,
      mic: one.mic,
      quantity: required(one.quantity),
      unitPrice: required(one.unitPrice),
      fxRate: decimalOf(one.fxRate, format),
    }));
    const note = input.note.trim() === "" ? null : input.note;
    return done(
      call(register.convertToPortfolio, { params: { accountId }, body: { on: input.on, positions, note } }),
    );
  });
}

export function deleteOperation(accountId: string, eventId: string): Promise<ActionResult> {
  return attempt(() => done(call(register.deleteOperation, { params: { accountId, eventId } })));
}

export interface ReconcileForm {
  holdingId: string;
  kind: "covered_by_provider" | "partial" | "outside_scope" | "reopened";
  effectiveOn: string;
  quantity: string;
  product: string;
  readingId: string | null;
}

export function reconcile(accountId: string, input: ReconcileForm): Promise<ActionResult> {
  return attempt(async () => {
    const quantity = input.kind === "partial" ? decimalOf(input.quantity, await formatOf()) : null;
    return done(
      call(register.reconcileHolding, {
        params: { accountId, holdingId: input.holdingId },
        body: {
          kind: input.kind,
          effectiveOn: input.effectiveOn,
          quantity,
          product: input.kind === "outside_scope" ? input.product : null,
          readingId: input.readingId,
        },
      }),
    );
  });
}

export function confirmZero(accountId: string, readingId: string): Promise<ActionResult> {
  return attempt(() => done(call(register.confirmZero, { params: { accountId, readingId } })));
}

/** A withdrawal and a deposit of two services linked as one transfer: both services change. */
export function linkTransfer(
  accountId: string,
  withdrawalId: string,
  depositId: string,
): Promise<ActionResult> {
  return attempt(() =>
    done(call(register.linkTransfer, { params: { accountId }, body: { withdrawalId, depositId } })),
  );
}

export function unlinkTransfer(accountId: string, eventId: string): Promise<ActionResult> {
  return attempt(() => done(call(register.unlinkTransfer, { params: { accountId, eventId } })));
}

/** Connects a provider's key to an account; the first flows run after the answer. */
export function connectProvider(
  provider: string,
  credentials: Record<string, string>,
  accountId: string,
): Promise<{ ok: true; accountId: string; ipRestricted: boolean | null } | Failure> {
  return attempt(() =>
    call(connection.connectProvider, {
      body: { provider, credentials, target: { kind: "existing", accountId } },
    }),
  );
}

/** «Sync now»: queued by the server, which answers before the provider does. */
export function syncNow(accountId: string): Promise<ActionResult> {
  return attempt(() => done(call(connection.syncNow, { params: { accountId } })));
}

export function verifyKey(accountId: string): Promise<ActionResult> {
  return attempt(() => done(call(connection.checkKey, { params: { accountId } })));
}

export function replaceKey(accountId: string, credentials: Record<string, string>): Promise<ActionResult> {
  return attempt(() => done(call(connection.replaceKey, { params: { accountId }, body: { credentials } })));
}

export function disconnectProvider(accountId: string): Promise<ActionResult> {
  return attempt(() => done(call(connection.disconnectProvider, { params: { accountId } })));
}

export function confirmKeyRevoked(accountId: string): Promise<ActionResult> {
  return attempt(() => done(call(connection.confirmKeyRevoked, { params: { accountId } })));
}

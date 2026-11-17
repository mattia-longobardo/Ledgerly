/**
 * The calls of contract v1, one function each. A function reads the body through the contract's
 * schema, speaks to the provider with the credentials of that body, and answers with the
 * contract's shape. Nothing is kept between two calls.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  authCompleteRequestSchema,
  type AuthCompleteResponse,
  authRevokeRequestSchema,
  authStartRequestSchema,
  type AuthStartResponse,
  institutionsRequestSchema,
  type InstitutionsResponse,
  type PluginTransaction,
  syncRequestSchema,
  type SyncResponse,
  verifyRequestSchema,
  type VerifyResponse,
} from "../../../src/platform/plugins/contract/calls";
import { PluginFailure } from "./failure";
import { parsePrivateKey } from "./jwt";
import {
  createProvider,
  type Fetch,
  type Presence,
  type Provider,
  type transactionsSchema,
} from "./provider";

const SECONDS_PER_DAY = 86_400;
/** The pages of movements one call reads before it hands back a cursor. */
const PAGES_PER_CALL = 60;
/**
 * The time one call may spend before it hands back a cursor. The core waits 60 seconds, and one
 * more page — started just inside the budget — can take the provider's own 30.
 */
const BUDGET_MS = 25_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Deps {
  fetchFn?: Fetch;
  now?: () => Date;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PluginFailure("invalid_request");
  return parsed.data;
}

/** The provider client of one call, from the credentials of its body. */
function providerOf(credentials: Record<string, string>, deps: Deps): Provider {
  const applicationId = credentials.applicationId?.trim();
  const pem = credentials.privateKey;
  if (!applicationId || !pem) throw new PluginFailure("invalid_request");
  const key = parsePrivateKey(pem);
  if (key === null) throw new PluginFailure("key_format");
  return createProvider(applicationId, key, deps.fetchFn);
}

export async function verify(body: unknown, deps: Deps = {}): Promise<VerifyResponse> {
  const request = parse(verifyRequestSchema, body);
  const application = await providerOf(request.credentials, deps).application();
  if (!application.active) throw new PluginFailure("auth");
  const services = application.services;
  if (!services) return { access: "unverifiable" };
  return { access: services.every((service) => service === "AIS") ? "read-only" : "write" };
}

export async function institutions(body: unknown, deps: Deps = {}): Promise<InstitutionsResponse> {
  const request = parse(institutionsRequestSchema, body);
  const { aspsps } = await providerOf(request.credentials, deps).aspsps(request.country);
  return {
    institutions: aspsps
      .filter((aspsp) => !aspsp.psu_types || aspsp.psu_types.includes("personal"))
      .map((aspsp) => ({
        name: aspsp.name,
        country: aspsp.country,
        maxAccessDays:
          typeof aspsp.maximum_consent_validity === "number" &&
          aspsp.maximum_consent_validity >= SECONDS_PER_DAY
            ? Math.floor(aspsp.maximum_consent_validity / SECONDS_PER_DAY)
            : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

export async function authStart(body: unknown, deps: Deps = {}): Promise<AuthStartResponse> {
  const request = parse(authStartRequestSchema, body);
  const provider = providerOf(request.credentials, deps);
  const { aspsps } = await provider.aspsps(request.institution.country);
  const aspsp = aspsps.find((one) => one.name === request.institution.name);
  if (!aspsp) throw new PluginFailure("institution_unavailable");
  const now = (deps.now ?? (() => new Date()))();
  // One minute less than the longest access the institution allows: a request at the limit to
  // the second is refused when the two clocks differ.
  const seconds = Math.max(SECONDS_PER_DAY, (aspsp.maximum_consent_validity ?? 90 * SECONDS_PER_DAY) - 60);
  const started = await provider.startAuth({
    access: {
      valid_until: new Date(now.getTime() + seconds * 1000).toISOString(),
      balances: true,
      transactions: true,
    },
    aspsp: { name: aspsp.name, country: aspsp.country },
    state: request.state,
    redirect_url: request.redirectUrl,
    psu_type: "personal",
  });
  if (!URL.canParse(started.url)) throw new PluginFailure("invalid_data");
  return { url: started.url };
}

/**
 * A text of the provider as the contract carries it: `null` when it is absent or empty, cut when
 * it is longer than the contract allows. A bank fills these fields as it likes — a real bank gave
 * accounts with an empty hash — and an answer must not fail for a field that is only missing.
 */
export function textOrNull(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text.slice(0, max);
}

/**
 * The id of an account that stays the same across accesses. A value longer than the contract
 * allows is not cut — two long values could then look the same — but replaced by its digest.
 */
export function stableIdOf(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return null;
  return text.length <= 200 ? text : `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function instantOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** The longest `details` taken as a name: a longer text describes the account, it does not name it. */
const DETAILS_NAME_MAX = 60;

/**
 * The bank's own name of an account, in this order:
 * 1. `product`, the bank's name of the product («Conto Arancio»);
 * 2. `details`, when it is one short line: Revolut leaves `product` empty and puts there the name
 *    the person gave a pocket («Holidays»). A longer text describes the account and is not used.
 * The API's `name` is the holder's, the same on every account of a person, and is never used.
 * `null` when no field gives one: the core then names the account «{bank} {kind}».
 */
export function accountNameOf(account: { product?: string | null; details?: string | null }): string | null {
  const product = textOrNull(account.product, 200);
  if (product !== null) return product;
  const details = textOrNull(account.details, DETAILS_NAME_MAX + 1);
  return details !== null && details.length <= DETAILS_NAME_MAX && !/[\r\n]/.test(details) ? details : null;
}

export async function authComplete(body: unknown, deps: Deps = {}): Promise<AuthCompleteResponse> {
  const request = parse(authCompleteRequestSchema, body);
  const session = await providerOf(request.credentials, deps).createSession(request.code);
  return {
    session: { id: session.session_id, expiresAt: instantOrNull(session.access?.valid_until) },
    institution: { name: session.aspsp.name, country: session.aspsp.country },
    // An account with no `uid` cannot be read in this access: it is not offered. Its name: see
    // `accountNameOf`.
    accounts: session.accounts.flatMap((account) =>
      account.uid
        ? [
            {
              externalId: account.uid,
              stableId: stableIdOf(account.identification_hash),
              name: accountNameOf(account),
              identifier: textOrNull(account.account_id?.iban, 64),
              currency: account.currency,
              kind: textOrNull(account.cash_account_type, 40),
            },
          ]
        : [],
    ),
  };
}

export async function authRevoke(body: unknown, deps: Deps = {}): Promise<{ revoked: boolean }> {
  const request = parse(authRevokeRequestSchema, body);
  try {
    await providerOf(request.credentials, deps).deleteSession(request.session.id);
  } catch (error) {
    // An access that has already ended is closed: that is what was asked for.
    if (error instanceof PluginFailure && error.code === "consent_expired") return { revoked: true };
    throw error;
  }
  return { revoked: true };
}

type ProviderTransaction = z.infer<typeof transactionsSchema>["transactions"][number];

function dateOrNull(value: string | null | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

/** One movement in the contract's shape; `null` for a state the contract does not carry. */
export function toTransaction(account: string, row: ProviderTransaction): PluginTransaction | null {
  const status = row.status === "BOOK" ? "booked" : row.status === "PDNG" ? "pending" : null;
  if (status === null) return null;
  const direction = row.credit_debit_indicator === "CRDT" ? "credit" : "debit";
  const code = row.bank_transaction_code;
  const bankCode = code ? [code.code, code.sub_code, code.description].filter(Boolean).join(" · ") : "";
  return {
    accountExternalId: account,
    externalId: textOrNull(row.entry_reference, 200),
    status,
    bookingDate: dateOrNull(row.booking_date),
    valueDate: dateOrNull(row.value_date) ?? dateOrNull(row.transaction_date),
    amount: row.transaction_amount.amount.replace(/^[-+]/, ""),
    direction,
    currency: row.transaction_amount.currency,
    text: (row.remittance_information ?? []).map((line) => line.slice(0, 2000)).slice(0, 40),
    counterparty: textOrNull(direction === "debit" ? row.creditor?.name : row.debtor?.name, 400),
    merchantCategoryCode: textOrNull(row.merchant_category_code, 10),
    bankTransactionCode: textOrNull(bankCode, 120),
  };
}

interface Cursor {
  account: string;
  key: string;
}

function readCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      const { account, key } = parsed as Record<string, unknown>;
      if (typeof account === "string" && typeof key === "string") return { account, key };
    }
  } catch {
    // Falls through: a cursor this plugin did not write is a wrong request.
  }
  throw new PluginFailure("invalid_request");
}

type AccountError = NonNullable<SyncResponse["accounts"][number]["error"]>;

/** A failure of one account, as the answer names it. A failure of the credentials stops the call. */
function accountError(error: unknown): AccountError {
  if (!(error instanceof PluginFailure)) return "failed";
  if (error.code === "auth" || error.code === "unauthorized" || error.code === "invalid_request") throw error;
  if (error.code === "consent_expired" || error.code === "rate_limited") return error.code;
  if (error.code === "provider_down" || error.code === "invalid_data") return error.code;
  return "failed";
}

export async function sync(body: unknown, deps: Deps = {}): Promise<SyncResponse> {
  const request = parse(syncRequestSchema, body);
  const provider = providerOf(request.credentials, deps);
  const presence: Presence | null = request.userPresent;
  const resume = readCursor(request.cursor);
  const started = Date.now();
  const answer: SyncResponse = {
    accounts: [],
    transactions: [],
    cursor: null,
    coverage: { from: null, to: null },
  };

  const first = resume === null ? 0 : request.accounts.indexOf(resume.account);
  if (first < 0) throw new PluginFailure("invalid_request");
  let pages = 0;

  for (const account of request.accounts.slice(first)) {
    let key = resume !== null && resume.account === account ? resume.key : null;
    try {
      // The balances are read once per account: a call that resumes inside an account has them.
      if (key === null) {
        const { balances } = await provider.balances(account, presence);
        answer.accounts.push({
          externalId: account,
          balances: balances.map((balance) => ({
            type: textOrNull(balance.balance_type, 40) ?? "OTHR",
            amount: balance.balance_amount.amount,
            currency: balance.balance_amount.currency,
            date: dateOrNull(balance.reference_date),
          })),
          error: null,
        });
      }
      do {
        if (pages >= PAGES_PER_CALL || Date.now() - started > BUDGET_MS) {
          if (key !== null) answer.cursor = JSON.stringify({ account, key } satisfies Cursor);
          break;
        }
        const page = await provider.transactions(
          account,
          { dateFrom: request.from, continuationKey: key },
          presence,
        );
        pages += 1;
        for (const row of page.transactions) {
          const transaction = toTransaction(account, row);
          if (transaction !== null) answer.transactions.push(transaction);
        }
        key = page.continuation_key ?? null;
      } while (key !== null);
    } catch (error) {
      const code = accountError(error);
      const entry = answer.accounts.find((one) => one.externalId === account);
      if (entry) entry.error = code;
      else answer.accounts.push({ externalId: account, balances: [], error: code });
    }
    if (answer.cursor !== null) break;
  }

  const days = answer.transactions
    .flatMap((one) => (one.bookingDate === null ? [] : [one.bookingDate]))
    .sort();
  answer.coverage = { from: days[0] ?? null, to: days.at(-1) ?? null };
  return answer;
}

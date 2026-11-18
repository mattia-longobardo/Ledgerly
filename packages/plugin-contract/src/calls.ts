/**
 * The calls of contract v1 (docs/design/rewrite-plan/04-now.md §4.1). Only the core calls; every
 * call is a `POST` with a JSON body, except `GET /manifest` and `GET /health`. The credentials of
 * the person travel in the body of each call and the plugin keeps nothing between two calls.
 *
 * `POST /institutions` and `POST /auth/revoke` are not in the plan's table: the first is what the
 * step "choose your bank" reads (ux/n1-plugin-bank.md §13.1), the second is what "Disconnect"
 * needs to close the access at the provider (§5.4).
 */
import { z } from "zod";

export const PLUGIN_PATHS = {
  health: "/health",
  manifest: "/manifest",
  verify: "/verify",
  institutions: "/institutions",
  authStart: "/auth/start",
  authComplete: "/auth/complete",
  authRevoke: "/auth/revoke",
  sync: "/sync",
} as const;

/** The header that carries the secret the core and one plugin share. */
export const SECRET_HEADER = "x-plugin-secret";

/** A flat bag of strings: the same shape the core seals (`sealJson`). */
const credentialsSchema = z.record(z.string().min(1).max(40), z.string().min(1).max(8192));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.iso.datetime({ offset: true });
const country = z.string().regex(/^[A-Z]{2}$/);
/** A decimal amount as a string, never a float: `"12.30"`, `"-0.05"`. */
const decimal = z.string().regex(/^-?\d{1,15}(\.\d{1,8})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

const institutionRef = z.object({ name: z.string().min(1).max(200), country });

/* verify */

export const verifyRequestSchema = z.object({ credentials: credentialsSchema });
/**
 * What the credentials can do: `read-only`, `write` (they can also move money or change data) or
 * `unverifiable` (the provider does not say).
 */
export const verifyResponseSchema = z.object({ access: z.enum(["read-only", "write", "unverifiable"]) });
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;

/* institutions */

export const institutionsRequestSchema = z.object({ credentials: credentialsSchema, country });
export const institutionsResponseSchema = z.object({
  institutions: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        country,
        /** How long an access can last, in days; `null` when the provider does not say. */
        maxAccessDays: z.number().int().min(1).max(3660).nullable(),
      }),
    )
    .max(5000),
});
export type InstitutionsResponse = z.infer<typeof institutionsResponseSchema>;

/* auth */

export const authStartRequestSchema = z.object({
  credentials: credentialsSchema,
  institution: institutionRef,
  /** Opaque to the plugin: the core binds it to the person's session and checks it on return. */
  state: z.string().min(16).max(200),
  redirectUrl: z.url(),
});
export const authStartResponseSchema = z.object({ url: z.url() });
export type AuthStartResponse = z.infer<typeof authStartResponseSchema>;

export const accountSchema = z.object({
  /** The provider's id of the account inside this access. It can change when the access is renewed. */
  externalId: z.string().min(1).max(200),
  /** An id that stays the same across accesses, when the provider has one. */
  stableId: z.string().min(1).max(200).nullable(),
  name: z.string().max(200).nullable(),
  /** IBAN or another number the person recognises; the core masks it before showing it. */
  identifier: z.string().max(64).nullable(),
  currency,
  /** The provider's own word for the kind of account (e.g. `CACC`, `SVGS`); `null` when absent. */
  kind: z.string().max(40).nullable(),
});
export type PluginAccount = z.infer<typeof accountSchema>;

export const authCompleteRequestSchema = z.object({
  credentials: credentialsSchema,
  /** The `code` the provider put on the return address. */
  code: z.string().min(1).max(2000),
});
export const authCompleteResponseSchema = z.object({
  session: z.object({ id: z.string().min(1).max(200), expiresAt: isoInstant.nullable() }),
  institution: institutionRef,
  accounts: z.array(accountSchema).max(200),
});
export type AuthCompleteResponse = z.infer<typeof authCompleteResponseSchema>;

export const authRevokeRequestSchema = z.object({
  credentials: credentialsSchema,
  session: z.object({ id: z.string().min(1).max(200) }),
});
export const authRevokeResponseSchema = z.object({ revoked: z.boolean() });

/* sync */

export const syncRequestSchema = z.object({
  credentials: credentialsSchema,
  session: z.object({ id: z.string().min(1).max(200) }),
  /** The accounts to read, by `externalId`. */
  accounts: z.array(z.string().min(1).max(200)).min(1).max(200),
  /** The first day to read; `null` asks for everything the provider gives. */
  from: isoDate.nullable(),
  /** What the last answer returned, to carry on a reading that did not fit one call. */
  cursor: z.string().max(4000).nullable(),
  /** Present when the person asked for this reading themselves: their address and browser. */
  userPresent: z
    .object({ ip: z.string().max(64).nullable(), userAgent: z.string().max(400).nullable() })
    .nullable(),
});

const balanceSchema = z.object({
  /** The provider's own code of the balance (e.g. `CLBD`, `ITAV`). */
  type: z.string().min(1).max(40),
  amount: decimal,
  currency,
  date: isoDate.nullable(),
});

const transactionSchema = z.object({
  accountExternalId: z.string().min(1).max(200),
  /** The provider's id of the movement; `null` when it gives none. */
  externalId: z.string().min(1).max(200).nullable(),
  status: z.enum(["booked", "pending"]),
  bookingDate: isoDate.nullable(),
  valueDate: isoDate.nullable(),
  /** Never negative: `direction` says which way the money went. */
  amount: decimal,
  direction: z.enum(["credit", "debit"]),
  currency,
  /** The free text of the movement, line by line, as the institution wrote it. */
  text: z.array(z.string().max(2000)).max(40),
  /** The other party: the creditor of a debit, the debtor of a credit. */
  counterparty: z.string().max(400).nullable(),
  merchantCategoryCode: z.string().max(10).nullable(),
  bankTransactionCode: z.string().max(120).nullable(),
});
export type PluginTransaction = z.infer<typeof transactionSchema>;

export const syncResponseSchema = z.object({
  accounts: z
    .array(
      z.object({
        externalId: z.string().min(1).max(200),
        balances: z.array(balanceSchema).max(40),
        /** `null` when the account was read; otherwise why it was not. */
        error: z
          .enum(["consent_expired", "rate_limited", "provider_down", "invalid_data", "failed"])
          .nullable(),
      }),
    )
    .max(200),
  transactions: z.array(transactionSchema).max(20_000),
  /** `null` when the reading is complete; otherwise what to send back to carry on. */
  cursor: z.string().max(4000).nullable(),
  /** The first and the last booking day the answer covers. */
  coverage: z.object({ from: isoDate.nullable(), to: isoDate.nullable() }),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

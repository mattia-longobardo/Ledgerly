import { z } from "zod";
import { UpstreamError } from "@/lib/contracts";
import { env, walletToken } from "@/lib/env";
import { HttpError, requestJson, withRetry, type SleepFn } from "./http";
import {
  REVOLUT_COMPONENT_KEYS,
  WALLET_ACCOUNTS,
  WALLET_EXPECTED_CURRENCY,
  type WalletAccountConfig,
} from "./wallet-accounts";

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  currencyCode: z.string(),
  archived: z.boolean().default(false),
  accountType: z.string().optional(),
  isInvestmentAccount: z.boolean().optional(),
  updatedAt: z.string().optional(),
  balance: z.object({
    currentBalance: z.number(),
  }),
});

const accountsSchema = z.object({
  accounts: z.array(accountSchema),
});

export type WalletAccount = z.infer<typeof accountSchema>;

export type RevolutComponentKey = (typeof REVOLUT_COMPONENT_KEYS)[number];

export interface WalletBalances {
  ing: number;
  revolut: number;
  breakdown: Record<WalletAccountConfig["key"], number>;
}

export interface WalletCallOptions {
  /** Injectable so tests don't sit through the backoff. */
  sleep?: SleepFn;
  jitter?: () => number;
  attempts?: number;
  signal?: AbortSignal;
}

const INIT_SYNC_FLOOR_MS = 30_000;
const RATE_LIMIT_DEFAULT_MS = 60_000;

function baseUrl(): string {
  return env().WALLET_API_URL.replace(/\/+$/, "");
}

function headers(): Record<string, string> {
  // Re-read per request: the token file is hot-swapped without a restart.
  return { authorization: `Bearer ${walletToken()}` };
}

function isInitSync(err: HttpError): boolean {
  if (err.status !== 409) return false;
  return JSON.stringify(err.detail ?? "").toLowerCase().includes("init_sync");
}

/**
 * The API has been answering 401 for a token that is not expired — a
 * server-side rejection. Surface it as its own message so a job failure is not
 * mistaken for "rotate the token and move on".
 */
function translate(err: unknown): unknown {
  if (!(err instanceof HttpError)) return err;
  if (err.status === 401 || err.status === 403) {
    return new UpstreamError(
      "wallet",
      `authentication rejected by the Wallet API (HTTP ${err.status}) — the token is not expired, the server is refusing it; check the BudgetBakers portal before rotating`,
      err.detail,
      false,
    );
  }
  return err;
}

function retryPolicy(opts: WalletCallOptions) {
  return {
    attempts: opts.attempts ?? 5,
    sleep: opts.sleep,
    jitter: opts.jitter,
    minDelayFor: (err: unknown): number | null => {
      if (!(err instanceof HttpError)) return null;
      if (isInitSync(err)) return INIT_SYNC_FLOOR_MS;
      if (err.status === 429) return err.retryAfterMs ?? RATE_LIMIT_DEFAULT_MS;
      return null;
    },
  };
}

export async function getAccounts(opts: WalletCallOptions = {}): Promise<WalletAccount[]> {
  try {
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/accounts?limit=200`, accountsSchema, {
          headers: headers(),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.accounts;
  } catch (err) {
    throw translate(err);
  }
}

function findAccount(accounts: readonly WalletAccount[], name: string): WalletAccount | undefined {
  const wanted = name.trim().toLowerCase();
  return accounts.find((a) => a.name.trim().toLowerCase() === wanted);
}

/**
 * All-or-nothing by design (§5 phase 1): a partial read must never become a
 * snapshot row, so a single missing account fails the whole call.
 */
export function reduceBalances(accounts: readonly WalletAccount[]): WalletBalances {
  const breakdown = {} as Record<WalletAccountConfig["key"], number>;
  const missing: string[] = [];
  const wrongCurrency: string[] = [];

  for (const cfg of WALLET_ACCOUNTS) {
    const account = findAccount(accounts, cfg.accountName);
    if (!account) {
      if (cfg.required) missing.push(cfg.accountName);
      continue;
    }
    if (account.currencyCode.toUpperCase() !== WALLET_EXPECTED_CURRENCY) {
      wrongCurrency.push(`${account.name}=${account.currencyCode}`);
      continue;
    }
    breakdown[cfg.key] = account.balance.currentBalance;
  }

  if (missing.length > 0) {
    throw new UpstreamError(
      "wallet",
      `required account(s) not found: ${missing.join(", ")} — refusing to report a partial balance`,
      { known: accounts.map((a) => a.name) },
      false,
    );
  }
  if (wrongCurrency.length > 0) {
    throw new UpstreamError(
      "wallet",
      `account(s) not in ${WALLET_EXPECTED_CURRENCY}: ${wrongCurrency.join(", ")}`,
      { known: accounts.map((a) => a.name) },
      false,
    );
  }

  const ing = breakdown.ing;
  const revolut = REVOLUT_COMPONENT_KEYS.reduce((sum, key) => sum + breakdown[key], 0);
  return { ing, revolut, breakdown };
}

export async function getBalances(opts: WalletCallOptions = {}): Promise<WalletBalances> {
  return reduceBalances(await getAccounts(opts));
}

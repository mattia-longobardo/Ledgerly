import type { Ctx } from "../../../platform/context";
import { takeSlot } from "../../../platform/limits/service";
import { BINANCE_PROVIDER } from "../../../platform/integrations/ccxt/binance";
import { binanceSource } from "../../../platform/integrations/ccxt/source";
import { etoroSource } from "../../../platform/integrations/etoro/source";
import { type InvestmentSource, SourceError } from "../../../platform/integrations/investments/source";

/**
 * The sync of the connected services (docs/design/investments.md §3.1, §5): the one place a key is
 * saved (`connectInvestmentProvider`, SEC-05), the pass the dispatcher makes, the key's checks,
 * replacement and revocation (§5.2, §5.3), and the conversion back to manual on disconnection
 * (§2.5). Network first, then short transactions (V6): no provider call inside a transaction.
 */

export type SyncErrorCode =
  | "unknown_provider"
  | "invalid_credentials"
  | "not_read_only"
  | "provider_auth"
  | "provider_unavailable"
  | "rate_limited"
  | "unsupported_currency"
  | "already_connected"
  | "not_connected"
  | "not_eligible"
  | "cooldown"
  | "different_account";

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode) {
    super(code);
    this.name = "SyncError";
  }
}

// ——— Sources ———————————————————————————————————————————————————————————————————————————————

const SOURCES: Record<string, () => InvestmentSource> = {
  etoro: () => etoroSource(),
  [BINANCE_PROVIDER]: () => binanceSource(),
};
let sourceOverride: ((provider: string) => InvestmentSource | null) | null = null;

/** The tests' way in: a fake source per provider, `null` to restore the real ones. */
export function setSourcesForTests(override: ((provider: string) => InvestmentSource | null) | null): void {
  sourceOverride = override;
}

export function sourceOf(provider: string): InvestmentSource {
  const source = sourceOverride?.(provider) ?? SOURCES[provider]?.() ?? null;
  if (!source) throw new SyncError("unknown_provider");
  return source;
}

/** "Sync now" and "Verify" wait this long between two calls of one connection (SEC-09). */
export const COOLDOWN_MS = 60_000;
/**
 * "Connect" and "Replace key" together, per person and provider (PERS-87 SEC-01): each attempt is
 * three to six calls to the provider, and Binance counts their weight per IP — the homelab's.
 */
export const KEY_ATTEMPTS = { max: 5, windowMs: 10 * 60_000 } as const;
/** Without a `Retry-After`, a refused pass waits this long before the next call. */
export const DEFAULT_BACKOFF_SECONDS = 300;
export const BACKOFF_KEY = "backoff_until";
/** The version of the dialog's text the person saw when connecting (§1.2), per provider. */
export const ATTESTATION_TEXT_VERSIONS: Record<string, string> = {
  etoro: "etoro-2026-10-28",
  [BINANCE_PROVIDER]: "binance-2026-10-28",
};
/** Permissions that only read, never named as the reason a key was refused (B1). */
export const READ_PERMISSIONS = new Set(["enableReading", "enableFixReadOnly"]);

/**
 * One attempt of {@link KEY_ATTEMPTS}, counted in the table every process shares (rewrite plan R1):
 * a fixed window that opens with the first attempt. A guard against a loop, not a boundary.
 */
export async function takeKeyAttempt(ctx: Pick<Ctx, "userId">, provider: string, now: Date): Promise<void> {
  const verdict = await takeSlot(`key-attempt:${ctx.userId}:${provider}`, KEY_ATTEMPTS, now);
  if (!verdict.allowed) throw new SyncError("cooldown");
}

/** A source failure as the code a form shows (§5.1): never the provider's text. */
export function codeOf(error: unknown): SyncErrorCode {
  if (error instanceof SyncError) return error.code;
  if (!(error instanceof SourceError)) return "provider_unavailable";
  if (error.errorClass === "auth" || error.errorClass === "permission") return "provider_auth";
  if (error.errorClass === "rate_limited") return "rate_limited";
  if (error.errorClass === "unsupported_currency") return "unsupported_currency";
  return "provider_unavailable";
}

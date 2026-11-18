/**
 * A fixed window per token, held in memory.
 *
 * Deliberately per process and not in the database: this is a guard against a script in a loop,
 * not a security boundary — the boundary is the token itself and `userScoped(ctx)` underneath it.
 * With more than one worker the effective allowance is a multiple of {@link MAX_PER_WINDOW}, which
 * is fine for what it protects against and is written here so nobody reads it as a promise.
 */

export const WINDOW_MS = 60_000;
export const MAX_PER_WINDOW = 120;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Drops windows that have run out, so a token used once does not stay in memory for ever. */
function sweep(now: number): void {
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets, for `Retry-After`. */
  retryAfter: number;
}

export function takeSlot(key: string, now: number = Date.now()): RateVerdict {
  if (windows.size > 1_000) sweep(now);
  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_PER_WINDOW - 1, retryAfter: 0 };
  }
  const retryAfter = Math.ceil((window.resetAt - now) / 1000);
  if (window.count >= MAX_PER_WINDOW) return { allowed: false, remaining: 0, retryAfter };
  window.count += 1;
  return { allowed: true, remaining: MAX_PER_WINDOW - window.count, retryAfter };
}

/** For the tests: the windows are process state, and a test must not inherit another's. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The passes the dispatcher (`jobs.ts`) can make, one per provider (docs/design/investments.md
 * §3.1). A provider is found by its id, or by a prefix that ends in `:` — `ccxt:` stands for every
 * `ccxt:<exchange>` — so a new integration adds one entry here and the dispatcher does not change.
 */
import "server-only";
import { runInvestmentPass } from "@/modules/investments/sync";
import { runTrekPass } from "@/modules/timeoff/jobs";
import { runWalletPass } from "@/modules/transactions/jobs";
import type { Ctx } from "@/platform/context";
import type { Person } from "@/modules/users/jobs";
import { runPaperlessPass } from "./paperless/sync";
import {
  BINANCE_PROVIDER,
  ETORO_PROVIDER,
  KINDS_OF,
  PAPERLESS_PROVIDER,
  type SyncKind,
  TREK_PROVIDER,
  WALLET_PROVIDER,
} from "./rules";
import { type Connection, type DueConnection, listConnections } from "./service";

export type PassOutcome = "answered" | "failed" | "refused" | "busy" | "absent";

export interface ProviderPass {
  /** A provider id, or a prefix ending in `:` for a family of them. */
  provider: string;
  /** The kinds the pass syncs, from `KINDS_OF`. */
  kinds: readonly SyncKind[];
  run(person: Person, ctx: Ctx, due: DueConnection, now: Date): Promise<PassOutcome>;
}

export const PASSES: readonly ProviderPass[] = [
  {
    provider: WALLET_PROVIDER,
    kinds: KINDS_OF[WALLET_PROVIDER],
    async run(person, ctx, due, now) {
      const connection = (await listConnections(ctx)).find((one) => one.id === due.id);
      return connection ? await runWalletPass(person, ctx, connection as Connection, now) : "absent";
    },
  },
  { provider: TREK_PROVIDER, kinds: KINDS_OF[TREK_PROVIDER], run: (_person, ctx) => runTrekPass(ctx) },
  {
    provider: PAPERLESS_PROVIDER,
    kinds: KINDS_OF[PAPERLESS_PROVIDER],
    run: (_person, ctx) => runPaperlessPass(ctx),
  },
  // Investments (docs/design/investments.md §3.1): the module's own pass, lock and outcomes.
  { provider: ETORO_PROVIDER, kinds: KINDS_OF[ETORO_PROVIDER], run: runInvestmentPass },
  // Binance through ccxt (§3.2). By id, not by the `ccxt:` prefix: an exchange without an adapter
  // (Kraken, D5 as amended) has no pass to be routed to.
  { provider: BINANCE_PROVIDER, kinds: KINDS_OF[BINANCE_PROVIDER], run: runInvestmentPass },
];

/** The pass for `provider`: an exact id first, then the longest prefix; `null` when nobody owns it. */
export function passFor(provider: string, passes: readonly ProviderPass[] = PASSES): ProviderPass | null {
  const exact = passes.find((pass) => pass.provider === provider);
  if (exact) return exact;
  const prefixed = passes
    .filter((pass) => pass.provider.endsWith(":") && provider.startsWith(pass.provider))
    .sort((a, b) => b.provider.length - a.provider.length);
  return prefixed[0] ?? null;
}

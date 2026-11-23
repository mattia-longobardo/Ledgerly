/**
 * The passes the dispatcher (`jobs.ts`) can make, one per provider (docs/design/investments.md
 * §3.1). A provider is found by its id, or by a prefix that ends in `:` — `ccxt:` stands for every
 * `ccxt:<exchange>` — so a new integration adds one entry here and the dispatcher does not change.
 */
import "server-only";
import { investmentProviderName, runInvestmentPass } from "@ledgerly/domain/investments";
import { runCalendarPass } from "@/modules/timeoff/jobs";
import { runSourcePass } from "@/modules/transactions/jobs";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { Person } from "@ledgerly/domain/users";
import type { UiLocale } from "@ledgerly/format/format";
import en from "../../../../../messages/en.json";
import it from "../../../../../messages/it.json";
import {
  BINANCE_PROVIDER,
  ETORO_PROVIDER,
  KINDS_OF,
  type SyncKind,
} from "@ledgerly/domain/platform/integrations";
import type { DueConnection } from "@ledgerly/domain/platform/integrations";
import type { AddonId } from "@ledgerly/api-contract";

export type PassOutcome = "answered" | "failed" | "refused" | "busy" | "absent";

/** How a person names a connection: its own name ("BBVA"), and the provider's ("Enable Banking"). */
export interface ConnectionLabel {
  name: string;
  provider: string;
}

export interface ProviderPass {
  /** A provider id, or a prefix ending in `:` for a family of them. */
  provider: string;
  /** The kinds the pass syncs, from `KINDS_OF`. */
  kinds: readonly SyncKind[];
  run(person: Person, ctx: Ctx, due: DueConnection, now: Date): Promise<PassOutcome>;
  /**
   * The names of one of the provider's connections: a provider of the core says its own, a plugin
   * the name of its manifest. No screen and no mail names one.
   */
  label?(
    connection: { provider: string; instanceKey: string },
    locale: UiLocale,
  ): ConnectionLabel | Promise<ConnectionLabel>;
  /** The addon whose data a connection reads, for a family of providers that say it for each one. */
  addon?(provider: string): Promise<AddonId | undefined>;
}

/**
 * The passes of the engines of plugin-host, by what a plugin is: a source read with a token, a leave
 * calendar. The application chooses one by the plugin's manifest (`plugin-wiring.ts`).
 */
export const ENGINE_PASSES = { source: runSourcePass, calendar: runCalendarPass };

const CATALOGUES = { en, it } as const;

/** The name of a kind of account a bank exposes, in `locale`: what «Choose the accounts» calls it. */
export function bankKindLabel(
  locale: UiLocale,
): (type: "checking" | "savings" | "credit" | "cash") => string {
  return (type) => CATALOGUES[locale].accounts.types[type];
}

/** What «Choose the accounts» calls a bank's account without a name, in `locale`. */
export function unnamedBankAccount(locale: UiLocale): string {
  return CATALOGUES[locale].banks.connect.accounts.unnamed;
}

/** A provider with one connection: the connection has the provider's name. */
const named = (name: string): ConnectionLabel => ({ name, provider: name });

export const PASSES: readonly ProviderPass[] = [
  // Investments (docs/design/investments.md §3.1): the module's own pass, lock and outcomes.
  {
    provider: ETORO_PROVIDER,
    kinds: KINDS_OF[ETORO_PROVIDER],
    run: runInvestmentPass,
    label: (connection) => named(investmentProviderName(connection.provider)),
  },
  // Binance through ccxt (§3.2). By id, not by the `ccxt:` prefix: an exchange without an adapter
  // (Kraken, D5 as amended) has no pass to be routed to.
  {
    provider: BINANCE_PROVIDER,
    kinds: KINDS_OF[BINANCE_PROVIDER],
    run: runInvestmentPass,
    label: (connection) => named(investmentProviderName(connection.provider)),
  },
];

/**
 * The passes that are not in the list above because this file must not import who owns them: a
 * plugin's pass is registered by the application when it starts (rewrite plan, rule M8 — only
 * the application joins a port and its adapter).
 */
const registered: ProviderPass[] = [];

/** Adds a pass, or replaces the one registered for the same provider. */
export function registerPass(pass: ProviderPass): void {
  const at = registered.findIndex((one) => one.provider === pass.provider);
  if (at >= 0) registered[at] = pass;
  else registered.push(pass);
}

/** Every pass the dispatcher can make: the ones of this file, then the registered ones. */
export function allPasses(): readonly ProviderPass[] {
  return [...PASSES, ...registered];
}

/** The pass for `provider`: an exact id first, then the longest prefix; `null` when nobody owns it. */
export function passFor(
  provider: string,
  passes: readonly ProviderPass[] = allPasses(),
): ProviderPass | null {
  const exact = passes.find((pass) => pass.provider === provider);
  if (exact) return exact;
  const prefixed = passes
    .filter((pass) => pass.provider.endsWith(":") && provider.startsWith(pass.provider))
    .sort((a, b) => b.provider.length - a.provider.length);
  return prefixed[0] ?? null;
}

/** The names of a connection, for a row, a log and a mail; the provider's id when nobody names it. */
export async function labelOf(
  connection: { provider: string; instanceKey: string },
  locale: UiLocale,
): Promise<ConnectionLabel> {
  const label = await passFor(connection.provider)?.label?.(connection, locale);
  return label ?? named(connection.provider);
}

/** The name a person reads for a source: what a provider of one connection is called. */
export async function sourceNameOf(provider: string, locale: UiLocale): Promise<string> {
  return (await labelOf({ provider, instanceKey: "" }, locale)).provider;
}

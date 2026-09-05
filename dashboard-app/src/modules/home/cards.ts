import type { Permission } from "@/platform/auth/permissions";
import type { Capabilities } from "@/platform/capabilities/resolve";

export type CardKey = "total_balance" | "accounts_sync" | "funds" | "leave" | "payroll_imports";

export interface HomeCard {
  key: CardKey;
  title: string;
  href: string;
  requires: {
    feature?: keyof Capabilities["features"];
    integration?: keyof Capabilities["integrations"];
    permission?: Permission;
  };
}

/**
 * What a card renders as, once its data has been loaded. Every branch except
 * `loading` and `permission_denied` is a terminal read the page can render
 * straight from a server component; `loading` exists for a client-fetched
 * card, and nothing here ever collapses "no data" into a zero.
 */
export type CardState<T> =
  | { state: "ready"; data: T; updatedAt: Date | null; source: string }
  | { state: "loading" }
  | { state: "empty"; hint: string }
  | { state: "stale"; data: T; updatedAt: Date; source: string }
  | { state: "partial"; data: T; missing: string[] }
  | { state: "integration_error"; message: string }
  | { state: "permission_denied" };

/**
 * The four sections Home can surface, in display order. Their gates are
 * plain data — a page decides what to render by asking `visibleCards` and
 * `cardState`, never by hardcoding a feature or integration check per card.
 */
export const HOME_CARDS: readonly HomeCard[] = [
  { key: "total_balance", title: "Total balance", href: "/finance/accounts", requires: {} },
  { key: "accounts_sync", title: "Accounts sync", href: "/settings/integrations", requires: { integration: "wallet" } },
  { key: "funds", title: "Funds", href: "/finance/funds", requires: {} },
  { key: "leave", title: "Leave", href: "/company/time-off", requires: { feature: "timeoff" } },
  // Spec §7.1 lists a payroll-import-status card. It is gated on the feature so
  // it disappears with the section, and on `payroll.upload` so a viewer is told
  // out loud rather than silently shown nothing (`cardState`, not `isCardVisible`).
  { key: "payroll_imports", title: "Payroll imports", href: "/company/payroll", requires: { feature: "payroll", permission: "payroll.upload" } },
];

/**
 * Whether a card belongs on the page at all. Only `feature` and `integration`
 * decide that — `permission` never does, because a permission the caller
 * lacks is something the UI should say out loud (`cardState` below), not
 * silently disappear.
 */
export function isCardVisible(card: HomeCard, caps: Capabilities): boolean {
  const { feature, integration } = card.requires;
  if (feature && !caps.features[feature]) return false;
  if (integration && caps.integrations[integration] !== "connected") return false;
  return true;
}

export function visibleCards(caps: Capabilities): HomeCard[] {
  return HOME_CARDS.filter((card) => isCardVisible(card, caps));
}

/**
 * The permission gate for a card, checked once its visibility has already
 * been established. `null` means "nothing to report here" — the page's own
 * loader decides the rest of the `CardState`.
 */
export function cardState(card: HomeCard, caps: Capabilities): { state: "permission_denied" } | null {
  const { permission } = card.requires;
  if (permission && !caps.permissions.has(permission)) return { state: "permission_denied" };
  return null;
}

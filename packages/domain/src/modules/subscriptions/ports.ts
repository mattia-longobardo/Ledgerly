// The ports of subscriptions (10-modularity.md §10.3). In: the payees of the movements another module
// has tied to a record of its own — a purchase of a plan, a deposit of a portfolio — which are no
// subscription (R5d, §11.3.3). Declared here and realised by investments; the application wires it.
import type { Ctx } from "../../platform/context";

/** The payee keys of the movements linked to an operation of Investments. */
interface LinkedPayees {
  payeeKeys(ctx: Pick<Ctx, "userId">): Promise<Set<string>>;
}

declare global {
  var ledgerlySubscriptionsLinked: LinkedPayees | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireSubscriptions(ports: { linked: LinkedPayees }): void {
  globalThis.ledgerlySubscriptionsLinked = ports.linked;
}

export function linkedPayees(): LinkedPayees {
  const wired = globalThis.ledgerlySubscriptionsLinked;
  if (!wired) throw new Error("subscriptions: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}

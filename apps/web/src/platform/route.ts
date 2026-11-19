import type { Route } from "next";

/** An address of the app: what Next's typed routes accept, checked at the one place it is needed. */
export const isAppAddress = (href: string): href is Route => href.startsWith("/");

/** An address built as text (`withParams`), handed to Next's `redirect` or router. */
export function appRoute(href: string): Route {
  if (!isAppAddress(href)) throw new Error(`not an address of the app: ${href}`);
  return href;
}

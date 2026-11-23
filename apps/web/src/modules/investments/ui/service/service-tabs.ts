// The tabs of a service (docs/design/investments-ux.md §1.1, §3.2): routes, so the back button walks them.
export type ServiceTabKey = "overview" | "positions" | "plans" | "activity" | "connection";

/** The path of a tab of a service. */
export const tabPath = (accountId: string, tab: ServiceTabKey) =>
  tab === "overview" ? `/investments/${accountId}` : `/investments/${accountId}/${tab}`;

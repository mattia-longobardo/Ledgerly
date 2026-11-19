"use client";

// The row of a connection on the web: the row of `packages/ui` with the one Server Action of every
// connection (`connection-actions.ts`), which answers the sentences the row shows, until the routes of
// `/api/v1/connections` give them too.
import type { ComponentProps } from "react";
import { ConnectionRow as Row } from "@ledgerly/ui/connection-row";
import { runConnectionAction } from "./connection-actions";

export {
  type ActionKind,
  type ConnectionRowProps,
  type HistoryItem,
  type RowAction,
  type RowStatusValue,
} from "@ledgerly/ui/connection-row";
export { DeactivateLink, SourceLinkRow } from "@ledgerly/ui/source-link-row";

export function ConnectionRow(props: Omit<ComponentProps<typeof Row>, "run">) {
  return <Row {...props} run={runConnectionAction} />;
}

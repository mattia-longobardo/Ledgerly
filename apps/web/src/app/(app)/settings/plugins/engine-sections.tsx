// The sections of the page of a plugin read by an engine of the core (rewrite plan R5c, P3b): a source
// read with a token or a leave calendar, by what `GET /plugins` says it is (`kind`). Its card, its
// accounts and what Ledgerly writes to it; the rest of the page is every source's.
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { interests } from "@ledgerly/api-contract/interests";
import type { sources } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { apiRead } from "@/platform/api-read";
import type { ConnectionRowProps, RowStatusValue } from "./connection-row";
import type { WireConnection } from "./connection-view";
import { DeletedAccounts } from "./deleted-accounts";
import { SourceAccounts } from "./source-accounts";
import { SourceCard } from "./source-card";
import { SourceWrites } from "./source-writes";

type EnginePlugin = RouteOutput<typeof sources.listPlugins>["plugins"][number];
type SourcePage = RouteOutput<typeof sources.getSource> | null;

interface EngineInput {
  plugin: EnginePlugin;
  /** The plugin's one connection and its row, or "Not connected" while it has none. */
  single: { connection: WireConnection | null; row: ConnectionRowProps };
  page: SourcePage;
  deactivateHref: string;
}

/** The accounts of the rules that publish to the source: the list of accounts does not say their source. */
async function publishingAccounts(provider: string): Promise<string[]> {
  const published = ((await apiRead(interests.listInterestRules, {}))?.rules ?? [])
    .filter((rule) => rule.mode === "post_to_provider")
    .map((rule) => rule.accountId);
  const owners = await Promise.all(
    [...new Set(published)].map((id) => apiRead(accountRoutes.getAccount, { params: { id } })),
  );
  return owners.flatMap((account) => (account?.provider === provider ? [account.id] : []));
}

/** What Ledgerly writes to the source: movements waiting, or days waiting for a calendar. */
async function writesOf(input: EngineInput, connection: WireConnection): Promise<ReactNode> {
  const { plugin, page } = input;
  if (plugin.kind === "source") {
    const ids = await publishingAccounts(connection.provider);
    const none = { count: 0, accountIds: [] };
    return (
      <SourceWrites
        provider={plugin.name}
        accountIds={ids}
        waiting={page?.unsent ?? none}
        refused={page?.refused ?? none}
      />
    );
  }
  const text = await getTranslations("settings.plugin");
  const pending = page?.pendingDays ?? 0;
  return (
    <p className="px-4 py-3.5 text-sm text-muted" data-testid="source-writes">
      {pending > 0 ? text("writes.pendingDays", { count: pending }) : text("writes.none")}
    </p>
  );
}

const NOTHING_LEFT = { accounts: 0, excluded: 0 };

/** What «Disconnect» of the connection leaves (H55, point 4). */
function leaveOf(page: SourcePage, connection: WireConnection | null) {
  if (!connection) return NOTHING_LEFT;
  return page?.connections.find((one) => one.id === connection.id)?.leave ?? NOTHING_LEFT;
}

/** The days waiting for a calendar, while it is connected. */
const pendingOf = (page: SourcePage, connection: WireConnection | null) =>
  connection ? (page?.pendingDays ?? 0) : 0;

/** The card, the accounts and the writes of the page of a plugin read by an engine of the core. */
export async function engineSections(input: EngineInput) {
  const { plugin, single, page, deactivateHref } = input;
  const { connection, row } = single;
  const card = (
    <SourceCard
      row={row}
      provider={`plugin:${plugin.id}`}
      connected={connection !== null}
      fields={plugin.fields}
      calendar={plugin.kind === "calendar"}
      leave={leaveOf(page, connection)}
      pendingDays={pendingOf(page, connection)}
      deactivateHref={deactivateHref}
    />
  );
  const accounts =
    connection && plugin.kind === "source" ? (
      <>
        <SourceAccounts connectionId={connection.id} provider={plugin.name} />
        <DeletedAccounts slug={plugin.id} rows={page?.deletedAccounts ?? []} />
      </>
    ) : null;
  const status: RowStatusValue = row.status.value;
  return {
    connection: card,
    own: connection ? [{ connection, row }] : [],
    accounts,
    writes: connection ? await writesOf(input, connection) : null,
    status,
  };
}

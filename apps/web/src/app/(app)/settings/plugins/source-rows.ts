// The rows a source's connections draw, shared by Settings › Plugins (the sources and their pages) and
// Settings › Finance (the banks and the investment services, decision D3). Built on the server, from
// what `GET /connections` gives: nothing here reads a credential.
import type { getTranslations } from "next-intl/server";
import type { RowStatusValue } from "./connection-row";
import { type Capabilities, type connectionRows, type WireConnection } from "./connection-view";

type Rows = Awaited<ReturnType<typeof connectionRows>>;
type Translator = Awaited<ReturnType<typeof getTranslations<"settings.connections">>>;

/** The state a list row shows for a source with several connections: the one that needs most. */
const WORST: readonly RowStatusValue[] = ["action", "late", "running", "paused", "ok", "absent"];

/** The state that needs the person most, of a source with several connections. */
export function worst(values: readonly RowStatusValue[]): RowStatusValue {
  if (values.length === 0) return "absent";
  return WORST.find((value) => values.includes(value)) ?? "ok";
}

interface BankRowsInput {
  connections: readonly WireConnection[];
  rows: Rows;
  text: Translator;
  /** A day as the page writes it. */
  day: (instant: string) => string;
  locale: string;
  now: Date;
}

/** The rows of the connections of one plugin: one per bank, by name. */
export function bankRows(input: BankRowsInput, pluginId: string, active: boolean) {
  const { connections, rows, text, day, locale, now } = input;
  const provider = `plugin:${pluginId}`;
  const built = connections
    .filter((connection) => connection.provider === provider)
    .map((one) => {
      const detail = text("detail.accounts", { count: one.shared ?? 0 });
      const capabilities: Capabilities = active
        ? {
            update: true,
            renewHref: `/banks/connect?renew=${one.id}`,
            replaceKey: "own",
            // `all`: the accounts left out are offered again too, so one can be chosen later.
            chooseAccountsHref: `/banks/connect?step=accounts&c=${one.id}&all=1`,
            disconnect: true,
          }
        : { update: false };
      const ends = one.expiresAt !== null && new Date(one.expiresAt).getTime() > now.getTime();
      // A bank's row says nothing of the IBANs of a reading: its accounts are chosen by hand.
      const connection: WireConnection = { ...one, ibanConflicts: [] };
      return {
        connection,
        row: rows.row({
          connection,
          detail:
            ends && one.expiresAt !== null
              ? `${detail} · ${text("detail.validUntil", { date: day(one.expiresAt) })}`
              : detail,
          capabilities,
        }),
      };
    });
  // By name, whatever the state: a row does not move when its state changes (§7).
  return built.sort((left, right) =>
    left.row.name.localeCompare(right.row.name, locale, { sensitivity: "base" }),
  );
}

/**
 * The investment services (docs/design/investments.md §4.2): the key, its checks and the
 * disconnection live on the service's page.
 */
export function serviceRows(connections: readonly WireConnection[], rows: Rows, text: Translator) {
  return connections.flatMap((connection) => {
    if (connection.service === null) return [];
    const href = `/investments/${connection.service.accountId}/connection`;
    return [
      rows.row({
        connection: { ...connection, ibanConflicts: [] },
        detail: text("detail.readOnlyKey"),
        capabilities: { update: true, replaceKey: href, settingsHref: href },
      }),
    ];
  });
}

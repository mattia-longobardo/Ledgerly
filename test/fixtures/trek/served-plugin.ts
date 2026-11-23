// The Trek plugin served in-process for the tests of the core (rewrite plan R5c): its real handler
// (`plugins/trek/src/server.ts`) on a free port, reached by the core's real adapter (`calendarCalls`
// of plugin-host, through `callPlugin` and the contract's schemas). Trek behind it is a stubbed
// `fetch` per Trek address, so two people's calendars in one test never answer for each other: no
// call leaves the process, and the backoff is never waited through.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConfiguredPlugin } from "@domain/platform/plugin-config";
import type { CalendarCalls } from "@domain/platform/integrations/trek/calls";
import { calendarCalls } from "@plugin-host/calendar";

type Fetch = typeof globalThis.fetch;

const SECRET = "a-secret-the-core-and-the-test-plugin-share";
/** The plugin as the configuration names it; the address is rewritten to the served port. */
export const PLUGIN: ConfiguredPlugin = { id: "trek", url: "http://trek-plugin.test", secret: SECRET };

const treks = new Map<string, Fetch>();
let origin: Promise<string> | undefined;

/** The Trek of the address the plugin calls. */
const byHost: Fetch = async (input, init) => {
  const trek = treks.get(new URL(String(input)).host);
  if (!trek) throw new Error("no stubbed Trek at this address");
  return trek(input, init);
};

async function serve(): Promise<string> {
  process.env.PLUGIN_NO_LISTEN = "1";
  const { createHandler } = await import("../../../plugins/trek/src/server");
  const server = createServer(
    createHandler(SECRET, { fetch: byHost, sleep: async () => undefined, jitter: () => 0 }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // The process ends with the test file: the server does not keep it alive.
  server.unref();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The core's fetch to the plugin: the configured address, sent to the served port. */
export const toPlugin: Fetch = async (input, init) => {
  origin ??= serve();
  return fetch(String(input).replace(PLUGIN.url, await origin), init);
};

/** A Trek address of its own, answered by `trek` from now on: the `baseUrl` of a connection. */
export function stubTrek(trek: Fetch): string {
  const host = `${randomUUID()}.trek.test`;
  treks.set(host, trek);
  return `https://${host}`;
}

/** The calendar's calls through the plugin, on a Trek of its own (`trek`). */
export function servedCalendar(trek: Fetch): CalendarCalls {
  return calendarCalls(
    PLUGIN,
    { baseUrl: stubTrek(trek), clientId: "trekci_test", clientSecret: "trekcs_test" },
    toPlugin,
  );
}

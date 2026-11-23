// The Wallet plugin served in-process for the tests of the core (rewrite plan R5c): its real handler
// (`plugins/wallet/src/server.ts`) on a free port, reached by the core's real adapter (`sourceCalls`
// of plugin-host, through `callPlugin` and the contract's schemas). Wallet behind it is a stubbed
// `fetch` per token, so two sources in one test never answer for each other: no call leaves the
// process, and the backoff is never waited through.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConfiguredPlugin } from "@domain/platform/plugin-config";
import type { SourceCalls } from "@plugin-host/movements/calls";
import { sourceCalls } from "@plugin-host/source";

type Fetch = typeof globalThis.fetch;

const SECRET = "a-secret-the-core-and-the-test-plugin-share";
/** The plugin as the configuration names it; the address is rewritten to the served port. */
export const PLUGIN: ConfiguredPlugin = { id: "wallet", url: "http://wallet-plugin.test", secret: SECRET };

const wallets = new Map<string, Fetch>();
let origin: Promise<string> | undefined;

/** Wallet for the token of the request the plugin makes. */
const byToken: Fetch = async (input, init) => {
  const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
  const wallet = wallets.get(token);
  if (!wallet) throw new Error("no stubbed Wallet for this token");
  return wallet(input, init);
};

async function serve(): Promise<string> {
  process.env.PLUGIN_NO_LISTEN = "1";
  const { createHandler } = await import("../../../plugins/wallet/src/server");
  const server = createServer(
    createHandler(SECRET, { fetchFn: byToken, sleep: async () => undefined, jitter: () => 0 }),
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

/** Wallet answers `token`'s calls with `wallet` from now on. */
export function stubWallet(token: string, wallet: Fetch): void {
  wallets.set(token, wallet);
}

/** The source's calls through the plugin, on a Wallet of its own (`wallet`). */
export function servedSource(wallet: Fetch, token: string = randomUUID()): SourceCalls {
  stubWallet(token, wallet);
  return sourceCalls(PLUGIN, { token }, toPlugin);
}

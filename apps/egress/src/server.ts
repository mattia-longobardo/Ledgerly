/**
 * `ledgerly-egress` (rewrite plan R5c, decisions I8, D1): the plugins' only way to the internet.
 * Port `EGRESS_PORT` (3128) takes `CONNECT host:443` from a plugin with its own credentials and opens
 * a raw tunnel to the address `decide` checked: TLS stays between the plugin and its provider.
 * Port `EGRESS_ADMIN_PORT` (8081) is the core's door (`admin.ts`). Nothing is stored.
 */
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { type AccessDeps, decide } from "./access.ts";
import { adminHandler } from "./admin.ts";
import { Grants } from "./grants.ts";
import { readPolicy } from "./policy.ts";

const REASONS: Record<number, string> = {
  403: "Forbidden",
  407: "Proxy Authentication Required",
  502: "Bad Gateway",
};

/** One `CONNECT`: refused with its status, or joined to a socket on the checked address. */
async function tunnel(
  deps: AccessDeps,
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
): Promise<void> {
  const target = request.url ?? "";
  const decision = await decide(deps, { target, authorization: request.headers["proxy-authorization"] });
  if (!decision.ok) {
    console.log(`[egress] refuse ${decision.plugin ?? "-"} ${target} ${decision.reason}`);
    const challenge = decision.status === 407 ? 'Proxy-Authenticate: Basic realm="egress"\r\n' : "";
    client.end(
      `HTTP/1.1 ${decision.status} ${REASONS[decision.status]}\r\n${challenge}Content-Length: 0\r\n\r\n`,
    );
    return;
  }
  console.log(`[egress] allow ${decision.plugin} ${decision.host}:443 via ${decision.address}`);
  const upstream: Socket = connect({ host: decision.address, port: 443 });
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
}

if (import.meta.main) {
  const catalog = readFileSync(process.env.EGRESS_CATALOG ?? "/app/catalog.json", "utf8");
  const deps: AccessDeps = {
    policy: readPolicy(process.env, catalog),
    grants: new Grants(),
    lookup: (host) => lookup(host, { all: true, verbatim: true }),
  };
  const proxy = createServer((_request, response) => response.writeHead(405).end());
  proxy.on("connect", (request: IncomingMessage, client: Duplex, head: Buffer) => {
    tunnel(deps, request, client, head).catch(() => client.destroy());
  });
  proxy.listen(Number(process.env.EGRESS_PORT ?? 3128));
  createServer(adminHandler(deps)).listen(Number(process.env.EGRESS_ADMIN_PORT ?? 8081));
  console.log(`[egress] ready: ${deps.policy.secrets.size} plugins with a secret`);
}

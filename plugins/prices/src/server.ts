/**
 * The plugin's HTTP server: `GET /health`, `GET /manifest` and `POST /prices`, behind the secret the
 * core and the plugin share. No database, no key and no file.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  PLUGIN_ERROR_STATUS,
  PLUGIN_PATHS,
  type PluginErrorCode,
  SECRET_HEADER,
} from "@ledgerly/plugin-contract";
import { PluginFailure } from "./failure";
import { type Deps, prices } from "./handlers";
import { MANIFEST } from "./manifest";

const MAX_BODY_BYTES = 64 * 1024;
const MIN_SECRET_LENGTH = 32;

function send(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const fail = (response: ServerResponse, code: PluginErrorCode) =>
  send(response, PLUGIN_ERROR_STATUS[code], { error: { code } });

function hasSecret(request: IncomingMessage, secret: string): boolean {
  const given = Buffer.from(String(request.headers[SECRET_HEADER] ?? ""));
  const own = Buffer.from(secret);
  return given.length === own.length && timingSafeEqual(given, own);
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) throw new PluginFailure("invalid_request");
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new PluginFailure("invalid_request");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PluginFailure("invalid_request");
  }
}

/** The request handler, apart from the listening socket so the tests can call it. */
export function createHandler(secret: string, deps: Deps = {}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = (request.url ?? "").split("?")[0];
    try {
      if (request.method === "GET" && path === PLUGIN_PATHS.health)
        return send(response, 200, { status: "ok" });
      if (!hasSecret(request, secret)) return fail(response, "unauthorized");
      if (request.method === "GET" && path === PLUGIN_PATHS.manifest) return send(response, 200, MANIFEST);
      if (request.method !== "POST" || path !== PLUGIN_PATHS.prices) return fail(response, "invalid_request");
      send(response, 200, await prices(await body(request), deps));
    } catch (error) {
      if (error instanceof PluginFailure) return fail(response, error.code);
      // The name only: the message of an unknown error can quote what it was given.
      console.error(
        `[plugin] ${request.method} ${path} failed: ${error instanceof Error ? error.name : "unknown"}`,
      );
      fail(response, "failed");
    }
  };
}

function main(): void {
  const secret = process.env.PLUGIN_SHARED_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(
      `[plugin] refusing to start: PLUGIN_SHARED_SECRET must be ${MIN_SECRET_LENGTH}+ characters`,
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8787);
  createServer(createHandler(secret)).listen(port, "0.0.0.0", () => {
    console.log(`[plugin] ${MANIFEST.id} ${MANIFEST.version} listening on ${port}`);
  });
}

if (process.env.PLUGIN_NO_LISTEN !== "1") main();

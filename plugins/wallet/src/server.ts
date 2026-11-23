/**
 * The plugin's HTTP server: the routes of contract 2 and nothing else. Only the core calls it, on
 * the stack's own network, with the secret the two share. No database, no file: what a call needs
 * is in its body, and what a call learns goes back in its answer.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  PLUGIN_ERROR_STATUS,
  PLUGIN_PATHS,
  type PluginErrorBody,
  SECRET_HEADER,
  SOURCE_PATHS,
} from "@ledgerly/plugin-contract";
import { failureOf, PluginFailure, WalletError } from "./failure";
import {
  accounts,
  categories,
  type Deps,
  edit,
  movements,
  push,
  record,
  verify,
  writeCategoriesCall,
} from "./handlers";
import { MANIFEST } from "./manifest";

const MAX_BODY_BYTES = 256 * 1024;
const MIN_SECRET_LENGTH = 32;

const POSTS: Record<string, (body: unknown, deps: Deps) => Promise<object>> = {
  [PLUGIN_PATHS.verify]: verify,
  [SOURCE_PATHS.accounts]: accounts,
  [SOURCE_PATHS.categories]: categories,
  [SOURCE_PATHS.movements]: movements,
  [SOURCE_PATHS.record]: record,
  [SOURCE_PATHS.push]: push,
  [SOURCE_PATHS.edit]: edit,
  [SOURCE_PATHS.writeCategories]: writeCategoriesCall,
};

function send(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function fail(response: ServerResponse, failure: PluginFailure): void {
  const { code, retryAfterSeconds } = failure;
  const body: PluginErrorBody = {
    error: { code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) },
  };
  send(response, PLUGIN_ERROR_STATUS[code], body);
}

function hasSecret(request: IncomingMessage, secret: string): boolean {
  const given = request.headers[SECRET_HEADER];
  if (typeof given !== "string") return false;
  const sent = Buffer.from(given);
  const expected = Buffer.from(secret);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new PluginFailure("invalid_request");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PluginFailure("invalid_request");
  }
}

/** Any error as the contract's failure: a Wallet failure by its kind, anything else `failed`. */
function asFailure(error: unknown, label: string): PluginFailure {
  if (error instanceof PluginFailure) return error;
  if (error instanceof WalletError) return failureOf(error);
  // The name only: the message of an unknown error can quote what it was given.
  console.error(`[plugin] ${label} failed: ${error instanceof Error ? error.name : "unknown"}`);
  return new PluginFailure("failed");
}

/** The request handler, apart from the listening socket so the tests can call it. */
export function createHandler(secret: string, deps: Deps = {}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = (request.url ?? "").split("?")[0];
    try {
      if (request.method === "GET" && path === PLUGIN_PATHS.health)
        return send(response, 200, { status: "ok" });
      if (!hasSecret(request, secret)) return fail(response, new PluginFailure("unauthorized"));
      if (request.method === "GET" && path === PLUGIN_PATHS.manifest) return send(response, 200, MANIFEST);
      const post = request.method === "POST" && Object.hasOwn(POSTS, path) ? POSTS[path] : undefined;
      if (!post) return fail(response, new PluginFailure("invalid_request"));
      send(response, 200, await post(await readJson(request), deps));
    } catch (error) {
      fail(response, asFailure(error, `${request.method} ${path}`));
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

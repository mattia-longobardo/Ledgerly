/**
 * The plugin's HTTP server: the routes of contract v1 and nothing else. Only the core calls it,
 * on the stack's own network, with the secret the two share. No database, no key ring, no file:
 * what a call needs is in its body, and what a call learns goes back in its answer.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PLUGIN_PATHS, SECRET_HEADER } from "../../../src/platform/plugins/contract/calls";
import {
  PLUGIN_ERROR_STATUS,
  type PluginErrorBody,
  type PluginErrorCode,
} from "../../../src/platform/plugins/contract/errors";
import { PluginFailure } from "./failure";
import { authComplete, authRevoke, authStart, type Deps, institutions, sync, verify } from "./handlers";
import { MANIFEST } from "./manifest";

const MAX_BODY_BYTES = 256 * 1024;
const MIN_SECRET_LENGTH = 32;

const POSTS: Record<string, (body: unknown, deps: Deps) => Promise<object>> = {
  [PLUGIN_PATHS.verify]: verify,
  [PLUGIN_PATHS.institutions]: institutions,
  [PLUGIN_PATHS.authStart]: authStart,
  [PLUGIN_PATHS.authComplete]: authComplete,
  [PLUGIN_PATHS.authRevoke]: authRevoke,
  [PLUGIN_PATHS.sync]: sync,
};

function send(response: ServerResponse, status: number, body: object): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(text);
}

function fail(response: ServerResponse, code: PluginErrorCode, retryAfterSeconds?: number): void {
  const body: PluginErrorBody = {
    error: { code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) },
  };
  send(response, PLUGIN_ERROR_STATUS[code], body);
}

function hasSecret(request: IncomingMessage, secret: string): boolean {
  const given = request.headers[SECRET_HEADER];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new PluginFailure("invalid_request");
    chunks.push(chunk as Buffer);
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
      const post = request.method === "POST" ? POSTS[path] : undefined;
      if (!post) return fail(response, "invalid_request");
      send(response, 200, await post(await readJson(request), deps));
    } catch (error) {
      if (error instanceof PluginFailure) return fail(response, error.code, error.retryAfterSeconds);
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

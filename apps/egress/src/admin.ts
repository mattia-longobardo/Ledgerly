/**
 * The proxy's door for the core (rewrite plan R5c, decision D1): `POST /grants` opens the person's
 * own host of a plugin whose catalog entry says so, for a short time, and `GET /health` is the
 * container's health check. The core proves itself with `Authorization: Bearer <EGRESS_ADMIN_SECRET>`.
 * A host is granted only when it is a name, and every address it has now is public; the tunnel
 * checks the addresses again at each connection.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type AccessDeps, publicAddresses } from "./access.ts";
import { HOST_NAME, sameSecret } from "./policy.ts";

const MAX_BODY_BYTES = 1024;

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > MAX_BODY_BYTES) return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** What a grant asks, read with plain checks; `null` when it is not a grant. */
function grantOf(body: unknown): { plugin: string; host: string; ttlSeconds: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const fields: Record<string, unknown> = { ...body };
  const { plugin, host, ttlSeconds } = fields;
  if (typeof plugin !== "string" || typeof host !== "string" || typeof ttlSeconds !== "number") return null;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) return null;
  return { plugin, host: host.toLowerCase(), ttlSeconds };
}

type Answer = { status: number; reason: string };

/** The answer of the door to one request: a status and the reason the proxy logs. */
export async function answerAdmin(deps: AccessDeps, request: IncomingMessage): Promise<Answer> {
  if (request.method === "GET" && request.url === "/health") return { status: 200, reason: "health" };
  if (request.method !== "POST" || request.url !== "/grants") return { status: 404, reason: "path" };
  return answerGrant(deps, request);
}

async function answerGrant(deps: AccessDeps, request: IncomingMessage): Promise<Answer> {
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
  if (!sameSecret(token, deps.policy.adminSecret)) return { status: 401, reason: "unauthenticated" };
  const grant = grantOf(await readBody(request));
  if (grant === null) return { status: 400, reason: "body" };
  if (!deps.policy.dynamic.has(grant.plugin)) return { status: 403, reason: "not dynamic" };
  if (!HOST_NAME.test(grant.host)) return { status: 403, reason: "not a host name" };
  if ((await publicAddresses(deps.lookup, grant.host)) === null) return { status: 403, reason: "address" };
  deps.grants.add(grant.plugin, grant.host, grant.ttlSeconds);
  return { status: 204, reason: `granted ${grant.plugin} ${grant.host}` };
}

export function adminHandler(deps: AccessDeps) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    answerAdmin(deps, request)
      .then(({ status, reason }) => {
        if (request.url !== "/health") console.log(`[egress] admin ${status} ${reason}`);
        response.writeHead(status).end();
      })
      .catch(() => response.writeHead(500).end());
  };
}

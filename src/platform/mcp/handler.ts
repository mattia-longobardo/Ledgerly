import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MAX_PER_WINDOW, takeSlot } from "@/platform/api/rate-limit";
import { type AccessIdentity, authenticateAccessToken } from "@/platform/auth/access-token";
import { bearerChallenge, looksLikeJwt } from "@/platform/auth/access-token-rules";
import { redactForLog } from "@/platform/auth/logger";
import { resourceMetadataUrl } from "@/platform/auth/oauth";
import { readEnv } from "@/platform/env";
import { buildMcpServer } from "./tools";

/**
 * `/api/mcp` (docs/auth-design.md D6): MCP over Streamable HTTP, stateless, behind the OAuth 2.0
 * resource-server check of D3 with the audience `<origin>/api/mcp`.
 *
 * - No token, or one that is not ours for this audience → 401 with the RFC 9728 challenge, which is
 *   how a client (Claude, MCP Inspector) discovers the authorization server and starts the flow.
 * - Only OAuth access tokens: a personal access token (`pat_…`) is refused here, it was never an
 *   MCP credential and the transition of D4 is for `/api/v1` alone.
 * - Stateless: a server and a transport per POST, no `Mcp-Session-Id`, so nothing lives between
 *   requests and any worker can answer. GET (the server-to-client stream) and DELETE (ending a
 *   session) have nothing to serve: 405.
 * - CORS is open: the credential is a bearer header, never a cookie, so a page on another origin
 *   gains nothing it did not already hold — and browser clients (MCP Inspector) need it.
 */

const BEARER = /^Bearer\s+(\S+)$/i;
const MAX_BODY_BYTES = 1024 * 1024;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Retry-After",
  "Access-Control-Max-Age": "86400",
};

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS, ...headers } });
}

function challenge(failure?: Parameters<typeof bearerChallenge>[1]): Record<string, string> {
  return {
    "WWW-Authenticate": bearerChallenge(resourceMetadataUrl(readEnv().BETTER_AUTH_URL, "mcp"), failure),
  };
}

/** A JSON-RPC error with no id: the request never reached the protocol layer. */
function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return reply(status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);
}

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const match = BEARER.exec(request.headers.get("authorization") ?? "");
  if (!match) return reply(401, { error: "unauthorized" }, challenge());

  let identity: AccessIdentity | null = null;
  try {
    identity = looksLikeJwt(match[1]) ? await authenticateAccessToken(match[1], "mcp") : null;
  } catch (error) {
    console.error("[mcp] token lookup failed", redactForLog(error));
    return reply(500, { error: "server_error" });
  }
  if (!identity) return reply(401, { error: "unauthorized" }, challenge({ error: "invalid_token" }));

  // The same budget as /api/v1 for the same client (D6: key = client_id).
  const verdict = takeSlot(`client:${identity.clientId}`);
  const limits = {
    "X-RateLimit-Limit": String(MAX_PER_WINDOW),
    "X-RateLimit-Remaining": String(verdict.remaining),
  };
  if (!verdict.allowed) {
    return reply(429, { error: "rate_limited" }, { ...limits, "Retry-After": String(verdict.retryAfter) });
  }
  // Every v1 tool reads; a token that cannot read has nothing to call.
  if (!identity.scopes.includes("read")) {
    return reply(403, { error: "forbidden" }, challenge({ error: "insufficient_scope", scope: "read" }));
  }

  if (request.method !== "POST") {
    return rpcError(405, -32000, "Method not allowed: this server is stateless, use POST.", {
      ...limits,
      Allow: "POST, OPTIONS",
    });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return rpcError(413, -32600, "Request too large.", limits);
  }

  const server = buildMcpServer(identity.ctx, identity.scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // The header check above is only the fast path: a chunked body has no Content-Length, and the
    // transport counts the stream as it reads it (PERS-49 SEC-09).
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      authInfo: { token: match[1], clientId: identity.clientId, scopes: [...identity.scopes] },
    });
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries({ ...CORS, ...limits })) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("[mcp] request failed", redactForLog(error));
    return rpcError(500, -32603, "Internal error.", limits);
  } finally {
    await server.close().catch(() => {});
  }
}

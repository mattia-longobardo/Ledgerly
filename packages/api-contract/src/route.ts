// The descriptor of a route of `/api/v1` (rewrite plan R2, 08-agents.md §8.2: «una rotta nasce in
// `api-contract`»). One descriptor gives the REST route in `apps/api`, the MCP tool of a read and the
// OpenAPI document: the three cannot describe the same answer in two ways (audit API-2, MCP-1).
import type { z } from "zod";
import type { ApiErrorCode } from "./errors";
import type { ContractScope } from "./scopes";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContract {
  /** `snake_case`, unique: the OpenAPI `operationId` and the name of the MCP tool. */
  id: string;
  method: HttpMethod;
  /** Under `/api/v1`; a parameter is `{name}` and has its schema in `params`. */
  path: string;
  /** The scope the token needs; `null` only for a route that answers without a token. */
  scope: ContractScope | null;
  /** What `GET /meta` lists when the server has the route: a client hides what the server lacks. */
  capability: string;
  summary: string;
  /** The Server Actions of the web app that call the same use case (R2 criterion 4). */
  actions: readonly string[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The body of the answer; `null` for a `204` without a body. */
  response: z.ZodType | null;
  /** The status of a success: 200 unless the route says otherwise. */
  status?: 200 | 201 | 202 | 204;
  /** The codes of `errors.ts` the route answers with, besides `unauthorized`, `forbidden`, `rate_limited`. */
  errors: readonly ApiErrorCode[];
  /** A read that is also an MCP tool: its title and the sentence the model reads. */
  mcp?: { title: string; description: string };
  /** One example, checked against the schemas by the gate. */
  example: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    response?: unknown;
  };
}

/** Declares a route; the identity function keeps the literal types for `apps/api`. */
export const defineRoute = <const R extends RouteContract>(route: R): R => route;

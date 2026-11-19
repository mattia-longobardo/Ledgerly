// `packages/api-client` (10-modularity.md §10.2): the calls of a client to `/api/v1`, one typed call per
// route of `@ledgerly/api-contract`. On the web the session cookie goes with every call, same origin;
// a write adds the header that proves it comes from the app (`SESSION_CSRF_HEADER`). The answer is
// read with the route's own schema: a client trusts the wire only once it has the declared shape.
import { type RouteContract, SESSION_CSRF_HEADER } from "@ledgerly/api-contract/core";
import type { z } from "zod";

type Schema<S> = S extends z.ZodType ? S : never;

/** What a route answers: its response schema's output, or nothing for a `204`. */
export type RouteOutput<R extends RouteContract> = R["response"] extends z.ZodType
  ? z.output<Schema<R["response"]>>
  : null;

/** What a call to the route carries: its path parameters, its query and its body, each when declared. */
export type RouteInput<R extends RouteContract> = (R["params"] extends z.ZodType
  ? { params: z.input<Schema<R["params"]>> }
  : unknown) &
  (R["query"] extends z.ZodType ? { query?: z.input<Schema<R["query"]>> } : unknown) &
  (R["body"] extends z.ZodType ? { body: z.input<Schema<R["body"]>> } : unknown);

/** A refusal of the API: its code (`errors.ts` of the contract) and, when the route names one, its reason. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string | null,
  ) {
    super(`${status} ${code}${reason ? ` (${reason})` : ""}`);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

interface Wire {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

function urlOf(route: RouteContract, input: Wire): string {
  const path = route.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = input.params?.[name];
    if (value === undefined) throw new Error(`${route.id}: the path parameter ${name} is missing`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) query.set(key, value);
  const search = query.toString();
  return `${BASE}${path}${search ? `?${search}` : ""}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The parts of a call, as the typed signature of `call` let them in. */
function wireOf(input: unknown): Wire {
  if (!isRecord(input)) return {};
  const strings = (value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).map(([key, part]) => [key, String(part)]))
      : undefined;
  const query = isRecord(input.query)
    ? Object.fromEntries(
        Object.entries(input.query).flatMap(([key, part]) =>
          part === undefined ? [] : [[key, String(part)]],
        ),
      )
    : undefined;
  return { params: strings(input.params), query, body: input.body };
}

/** The refusal an answer that is not a 2xx carries, read without trusting its shape. */
async function refusalOf(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const code = isRecord(body) ? body.error : undefined;
  const reason = isRecord(body) ? body.reason : undefined;
  return new ApiError(
    response.status,
    typeof code === "string" ? code : "server_error",
    typeof reason === "string" ? reason : null,
  );
}

/** Calls one route; throws `ApiError` on a refusal and when the answer is not the declared shape. */
export function call<R extends RouteContract>(route: R, input: RouteInput<R>): Promise<RouteOutput<R>>;
export async function call(route: RouteContract, input: unknown): Promise<unknown> {
  const wire = wireOf(input);
  const write = route.method !== "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (write) headers[SESSION_CSRF_HEADER] = "1";
  if (wire.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(urlOf(route, wire), {
    method: route.method,
    headers,
    credentials: "same-origin",
    body: wire.body === undefined ? undefined : JSON.stringify(wire.body),
  });
  if (!response.ok) throw await refusalOf(response);
  if (route.response === null) return null;
  const parsed = route.response.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(response.status, "invalid_answer", null);
  return parsed.data;
}

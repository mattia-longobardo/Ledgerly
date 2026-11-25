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
  /** `iban_exists` and `iban_archived`: the name of the account that has the IBAN. */
  readonly other: string | null;
  /** `not_bookable` of time off: the dates refused and why. */
  readonly refused: ReadonlyArray<{ on: string; reason: string }>;
  /** `reading_in_progress` of «Deactivate» (H56): when the reading that stops it started. */
  readonly startedAt: string | null;

  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string | null,
    extra: {
      other?: string | null;
      refused?: ReadonlyArray<{ on: string; reason: string }>;
      startedAt?: string | null;
    } = {},
  ) {
    super(`${status} ${code}${reason ? ` (${reason})` : ""}`);
    this.name = "ApiError";
    this.other = extra.other ?? null;
    this.refused = extra.refused ?? [];
    this.startedAt = extra.startedAt ?? null;
  }
}

const BASE = "/api/v1";

interface Wire {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

/**
 * Where a call goes from a server, which has no page's origin and no cookie jar: the API's origin and
 * the headers of the person it reads for (their session cookie).
 */
interface Transport {
  origin: string;
  headers?: Record<string, string>;
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

/** A `multipart` body: a file as it is, any other field as its text. */
function formOf(body: unknown): FormData {
  const form = new FormData();
  if (!isRecord(body)) return form;
  for (const [key, part] of Object.entries(body)) {
    if (part !== undefined) form.set(key, part instanceof Blob ? part : String(part));
  }
  return form;
}

/** The refusal an answer that is not a 2xx carries, read without trusting its shape. */
async function refusalOf(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const code = isRecord(body) ? body.error : undefined;
  const reason = isRecord(body) ? body.reason : undefined;
  const other = isRecord(body) ? body.other : undefined;
  const refused = isRecord(body) && Array.isArray(body.refused) ? body.refused : [];
  const startedAt = isRecord(body) ? body.startedAt : undefined;
  return new ApiError(
    response.status,
    typeof code === "string" ? code : "server_error",
    typeof reason === "string" ? reason : null,
    {
      other: typeof other === "string" ? other : null,
      startedAt: typeof startedAt === "string" ? startedAt : null,
      refused: refused.filter(
        (one): one is { on: string; reason: string } =>
          isRecord(one) && typeof one.on === "string" && typeof one.reason === "string",
      ),
    },
  );
}

/** Calls one route; throws `ApiError` on a refusal and when the answer is not the declared shape. */
export function call<R extends RouteContract>(
  route: R,
  input: RouteInput<R>,
  transport?: Transport,
): Promise<RouteOutput<R>>;
export async function call(
  route: RouteContract,
  input: unknown,
  transport: Transport = { origin: "" },
): Promise<unknown> {
  const wire = wireOf(input);
  const write = route.method !== "GET";
  const headers: Record<string, string> = { ...transport.headers, accept: "application/json" };
  if (write) headers[SESSION_CSRF_HEADER] = "1";
  const multipart = route.bodyFormat === "multipart" && isRecord(wire.body);
  // A form sets its own content type, with the boundary of its parts.
  if (wire.body !== undefined && !multipart) headers["content-type"] = "application/json";
  const response = await fetch(`${transport.origin}${urlOf(route, wire)}`, {
    method: route.method,
    headers,
    credentials: "same-origin",
    body: wire.body === undefined ? undefined : multipart ? formOf(wire.body) : JSON.stringify(wire.body),
  });
  if (!response.ok) throw await refusalOf(response);
  if (route.response === null) return null;
  const parsed = route.response.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(response.status, "invalid_answer", null);
  return parsed.data;
}

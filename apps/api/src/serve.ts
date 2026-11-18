// One way to serve a route of the contract (rewrite plan R2, audit API-2, API-3): the descriptor
// says what comes in and what goes out, so a handler only calls its use case. The input is parsed
// with the contract's schemas, the answer is parsed with the contract's schema before it leaves:
// a route cannot answer a shape the OpenAPI document does not describe.
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import {
  API_ERRORS,
  type ApiErrorCode,
  type ContractScope,
  type RouteContract,
} from "@ledgerly/api-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";

/** What every handler reads off the context once the guard accepted the token. */
export interface ApiEnv {
  Variables: { ctx: Ctx };
}

/** The guard of the web process (`withToken`): token, budget, scope. Injected, so auth lives once. */
export type Guard = (scope: ContractScope) => MiddlewareHandler<ApiEnv>;

/** A refusal a use case names: the route answers its code, and `reason` when there is one. */
export class ApiRefusal extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly reason?: string,
  ) {
    super(reason ?? code);
    this.name = "ApiRefusal";
  }
}

type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;

/** What a handler gets: the person, and the input already checked against the contract. */
interface RouteInput<R extends RouteContract> {
  ctx: Ctx;
  /** The headers of the request: who is asking, for a reading a bank is owed (`Psu-*`). */
  headers: Headers;
  params: Parsed<R["params"]>;
  query: Parsed<R["query"]>;
  body: Parsed<R["body"]>;
}

type Answer<R extends RouteContract> = R["response"] extends z.ZodType ? z.input<R["response"]> : void;

type Handler<R extends RouteContract> = (input: RouteInput<R>) => Promise<Answer<R>>;

/** The status of an error code, as Hono types it. */
function statusOf(status: number): ContentfulStatusCode {
  switch (status) {
    case 401:
    case 403:
    case 404:
    case 409:
    case 400:
    case 413:
    case 415:
    case 429:
      return status;
    default:
      return 500;
  }
}

function fail(context: Context, code: ApiErrorCode, reason?: string): Response {
  const body = reason ? { error: code, reason } : { error: code };
  return context.json(body, statusOf(API_ERRORS[code]));
}

async function readBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return undefined;
  }
}

interface RawInput {
  ctx: Ctx;
  headers: Headers;
  params: unknown;
  query: unknown;
  body: unknown;
}

/**
 * Checks the input against the route's schemas and puts the parsed values in place: when it says
 * yes, every part is what the contract describes, which is what the type says.
 */
function fitsContract<R extends RouteContract>(route: R, input: RawInput): input is RouteInput<R> {
  for (const part of ["params", "query", "body"] as const) {
    const schema = route[part];
    if (!schema) {
      input[part] = undefined;
      continue;
    }
    const result = schema.safeParse(input[part]);
    if (!result.success) return false;
    input[part] = result.data;
  }
  return true;
}

/** Hono writes a parameter as `:name`; the contract as `{name}`. */
const honoPath = (path: string) => path.replace(/\{(\w+)\}/g, ":$1");

/** Serves one route of the contract on `app`, behind the guard of its scope. */
export function serve<R extends RouteContract>(
  app: Hono<ApiEnv>,
  guard: Guard,
  route: R,
  handler: Handler<R>,
): void {
  if (route.scope === null) throw new Error(`${route.id}: a public route is served by its own router`);
  app.on(route.method, honoPath(route.path), guard(route.scope), async (context) => {
    const input: RawInput = {
      ctx: context.get("ctx"),
      headers: context.req.raw.headers,
      params: context.req.param(),
      query: context.req.query(),
      body: route.body ? await readBody(context) : undefined,
    };
    // `admin` is the second gate, never the first: the role is checked at every call (plan F8 §3.4.8).
    if (route.scope === "admin" && input.ctx.role !== "admin") return fail(context, "forbidden");
    if (!fitsContract(route, input)) return fail(context, "invalid");
    let answer: unknown;
    try {
      answer = await handler(input);
    } catch (error) {
      if (error instanceof ApiRefusal) return fail(context, error.code, error.reason);
      // A rule of the domain refused the input the contract let in (an unknown time zone): the
      // caller's input, not a fault of the server.
      if (error instanceof Error && error.name === "ZodError") return fail(context, "invalid");
      throw error;
    }
    if (route.response === null) return context.body(null, route.status === 202 ? 202 : 204);
    return context.json(route.response.parse(answer), route.status === 201 ? 201 : 200);
  });
}

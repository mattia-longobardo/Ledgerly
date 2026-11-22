// One way to serve a route of the contract (rewrite plan R2, audit API-2, API-3): the descriptor
// says what comes in and what goes out, so a handler only calls its use case. The input is parsed
// with the contract's schemas, the answer is parsed with the contract's schema before it leaves:
// a route cannot answer a shape the OpenAPI document does not describe.
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import {
  addonOf,
  API_ERRORS,
  type ApiErrorCode,
  type ContractScope,
  type RouteContract,
} from "@ledgerly/api-contract";
import { addonOn, type Ctx } from "@ledgerly/domain/platform/context";

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
    /** The name of what the refusal is about (`iban_exists`: the account with the IBAN). */
    readonly other?: string,
    /** `not_bookable` of time off: the dates refused and why. */
    readonly refused?: ReadonlyArray<{ on: string; reason: "weekend" | "holiday" }>,
  ) {
    // An MCP tool answers the message: `module_inactive` names its addon, so the model knows why.
    super(code === "module_inactive" ? `${code}: ${reason}` : (reason ?? code));
    this.name = "ApiRefusal";
  }
}

/** The answer of a route's `otherStatus` (a file already received): the same body, another status. */
export class OtherStatus<T> {
  constructor(readonly body: T) {}
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

type Handler<R extends RouteContract> = (
  input: RouteInput<R>,
) => Promise<Answer<R> | (R["otherStatus"] extends object ? OtherStatus<Answer<R>> : never)>;

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
    case 503:
      return status;
    default:
      return 500;
  }
}

function fail(
  context: Context,
  code: ApiErrorCode,
  extra: Pick<ApiRefusal, "reason" | "other" | "refused"> = {},
): Response {
  const { reason, other, refused } = extra;
  const body = {
    error: code,
    ...(reason ? { reason } : {}),
    ...(other ? { other } : {}),
    ...(refused?.length ? { refused } : {}),
  };
  return context.json(body, statusOf(API_ERRORS[code]));
}

async function readBody(context: Context, format: RouteContract["bodyFormat"]): Promise<unknown> {
  try {
    // A form's fields by name, a file as the `File` it arrived as; a field sent twice: the last one.
    if (format === "multipart") return Object.fromEntries(await context.req.formData());
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

/** The answer of a success: no body, the route's status, or its `otherStatus`. */
function respond(context: Context, route: RouteContract, answer: unknown): Response {
  if (route.response === null) return context.body(null, route.status === 202 ? 202 : 204);
  if (answer instanceof OtherStatus && route.otherStatus) {
    return context.json(route.response.parse(answer.body), route.otherStatus.status);
  }
  return context.json(route.response.parse(answer), route.status === 201 ? 201 : 200);
}

/** The handlers each app serves, by route id: a read of the contract is also an MCP tool. */
const HANDLERS = new WeakMap<Hono<ApiEnv>, Map<string, (input: RawInput) => Promise<unknown>>>();

/** The handler `app` serves for `routeId`, with the input already checked; `undefined` when none. */
export function handlerOf(app: Hono<ApiEnv>, routeId: string) {
  return HANDLERS.get(app)?.get(routeId);
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
  const handlers = HANDLERS.get(app) ?? new Map<string, (input: RawInput) => Promise<unknown>>();
  HANDLERS.set(app, handlers);
  // The addon of the route (H52, PA10): while the person has it off, the route and its MCP tool
  // answer `module_inactive` with the addon's name, before any read.
  const addon = addonOf(route);
  const inactive = (ctx: Ctx) => addon !== null && !addonOn(ctx, addon);
  handlers.set(route.id, async (input) => {
    if (inactive(input.ctx)) throw new ApiRefusal("module_inactive", addon ?? undefined);
    if (!fitsContract(route, input)) throw new ApiRefusal("invalid");
    return handler(input);
  });
  app.on(route.method, honoPath(route.path), guard(route.scope), async (context) => {
    const input: RawInput = {
      ctx: context.get("ctx"),
      headers: context.req.raw.headers,
      params: context.req.param(),
      query: context.req.query(),
      body: route.body ? await readBody(context, route.bodyFormat) : undefined,
    };
    // `admin` is the second gate, never the first: the role is checked at every call (plan F8 §3.4.8).
    if (route.scope === "admin" && input.ctx.role !== "admin") return fail(context, "forbidden");
    if (inactive(input.ctx)) return fail(context, "module_inactive", { reason: addon ?? undefined });
    if (!fitsContract(route, input)) return fail(context, "invalid");
    let answer: unknown;
    try {
      answer = await handler(input);
    } catch (error) {
      if (error instanceof ApiRefusal) return fail(context, error.code, error);
      // A rule of the domain refused the input the contract let in (an unknown time zone): the
      // caller's input, not a fault of the server.
      if (error instanceof Error && error.name === "ZodError") return fail(context, "invalid");
      throw error;
    }
    return respond(context, route, answer);
  });
}

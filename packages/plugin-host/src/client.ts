/**
 * The one way the core calls a plugin (rewrite plan, 04-now.md §4.1): over HTTP, with the secret
 * the two share, and with every answer read through the contract's schema before anything else
 * sees it. A failure is a code from a closed list; the plugin's body, like the provider's words
 * behind it, never becomes a message.
 */
import type { z } from "zod";
import { SECRET_HEADER } from "@ledgerly/plugin-contract";
import { errorBodySchema, type PluginErrorCode } from "@ledgerly/plugin-contract";
import type { ConfiguredPlugin } from "@ledgerly/domain/platform/plugin-config";

/**
 * Why a call failed: a code of the contract, or `plugin_down` when the plugin itself did not
 * answer as the contract says (not reachable, a refused secret, a body that is not the contract's).
 */
type PluginCallCode = Exclude<PluginErrorCode, "unauthorized"> | "plugin_down";

export class PluginCallError extends Error {
  constructor(
    readonly code: PluginCallCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "PluginCallError";
  }
}

export type Fetch = typeof fetch;

interface CallOptions {
  /** Left out for a `GET`. */
  body?: object;
  timeoutMs?: number;
  fetchFn?: Fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** The largest answer the core reads from a plugin (SEC-06); over it, the call fails closed. */
export const MAX_ANSWER_BYTES = 10 * 1024 * 1024;

/** The body as JSON, read until `MAX_ANSWER_BYTES` and no further: over it, it throws. */
async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ANSWER_BYTES) {
    await response.body?.cancel();
    throw new Error("answer too large");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      await response.body?.cancel();
      throw new Error("answer too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function callPlugin<T>(
  plugin: ConfiguredPlugin,
  path: string,
  schema: z.ZodType<T>,
  options: CallOptions = {},
): Promise<T> {
  let response: Response;
  let json: unknown;
  try {
    response = await (options.fetchFn ?? fetch)(`${plugin.url}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        [SECRET_HEADER]: plugin.secret,
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
      // A plugin answers itself: a redirect could send the core's secret elsewhere (SEC-05).
      redirect: "error",
    });
    json = await readJson(response);
  } catch {
    throw new PluginCallError("plugin_down");
  }
  if (!response.ok) {
    const failure = errorBodySchema.safeParse(json);
    if (!failure.success || failure.data.error.code === "unauthorized")
      throw new PluginCallError("plugin_down");
    throw new PluginCallError(failure.data.error.code, failure.data.error.retryAfterSeconds);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Where the answer leaves the contract, as paths: a path names a field, never its value.
    const where = parsed.error.issues.slice(0, 5).map((issue) => issue.path.join(".") || "(root)");
    console.warn(`[plugins] ${plugin.id} ${path}: answer outside the contract at ${where.join(", ")}`);
    throw new PluginCallError("invalid_data");
  }
  return parsed.data;
}

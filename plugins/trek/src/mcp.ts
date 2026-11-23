/**
 * What Trek's MCP endpoint answers, read: JSON-RPC 2.0 messages on the `data:` lines of an SSE
 * stream, and a tool's payload double-encoded in `result.content[0].text`. Pure: no network.
 */
import { z } from "zod";
import { TrekError } from "./errors";
import type { TrekFraction } from "./plan";

const MAX_DETAIL_CHARS = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Every MCP response is an SSE stream, so the JSON-RPC messages live on the `data:` lines. A plain
 * JSON body is accepted too: a compliant server may answer with one, and it costs one branch.
 */
export function parseMcpStream(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    // A comment, a keep-alive or the done marker is not worth failing a request over.
    const message = payload === "" || payload === "[DONE]" ? undefined : parseJson(payload);
    if (isRecord(message)) messages.push(message);
  }
  if (messages.length === 0 && text.trim() !== "") {
    const whole = parseJson(text);
    if (isRecord(whole)) messages.push(whole);
  }
  return messages;
}

/**
 * Trek nests a tool's payload under a key seen at more than one depth (`{entries:{entries:[…]}}`),
 * so the wrapper is peeled rather than assumed. Bounded; it stops at the first array or at anything
 * that no longer carries the key.
 */
export function unwrapPayload(value: unknown, key: string): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(current) || !isRecord(current) || !(key in current)) return current;
    current = current[key];
  }
  return current;
}

function describe(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 500);
  return JSON.stringify(payload ?? null).slice(0, 500);
}

export function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new TrekError("payload", `unexpected ${what} payload shape: ${issues}`, { detail: raw });
}

/** Picks the response to `id` out of the stream; an error message is a refusal. */
export function rpcResult(
  messages: Record<string, unknown>[],
  raw: string,
  id: number,
  what: string,
): unknown {
  const message =
    messages.find((one) => one.id === id) ??
    messages.find((one) => one.result !== undefined || one.error !== undefined);
  if (message === undefined) {
    throw new TrekError("payload", `Trek's MCP endpoint returned no JSON-RPC response to ${what}`, {
      detail: raw.slice(0, MAX_DETAIL_CHARS),
    });
  }
  if (isRecord(message.error)) {
    const detail =
      typeof message.error.message === "string" ? message.error.message : JSON.stringify(message.error);
    // A protocol-level refusal will not change on an identical second request.
    throw new TrekError("refused", `Trek refused ${what}: ${detail}`, { detail: message.error });
  }
  return message.result;
}

/** The text of the first content part that has one, or `null`. */
function firstText(envelope: Record<string, unknown> | null): string | null {
  const content = Array.isArray(envelope?.content) ? envelope.content : [];
  const part = content.find((one) => isRecord(one) && typeof one.text === "string");
  return isRecord(part) && typeof part.text === "string" ? part.text : null;
}

/**
 * A tool result carries its payload as a JSON string inside `content[0].text`, so it is decoded
 * twice. An error result — `isError`, or a payload whose content is an `error` — is raised as a
 * `refused`, which is what the weekend check reads.
 */
export function readToolPayload(result: unknown, tool: string): unknown {
  const envelope = isRecord(result) ? result : null;
  const payload = decodedPayload(result, envelope);
  const error = isRecord(payload) ? payload.error : undefined;
  const carriesError = error !== undefined && error !== null && error !== false;
  if (envelope?.isError === true || carriesError) {
    const detail = carriesError ? error : payload;
    throw new TrekError("refused", `Trek's ${tool} tool reported an error: ${describe(detail)}`, { detail });
  }
  return payload;
}

/** The payload under its two encodings: the JSON text of the content, or the structured content. */
function decodedPayload(result: unknown, envelope: Record<string, unknown> | null): unknown {
  const text = firstText(envelope);
  if (text !== null) return parseJson(text) ?? text;
  return envelope?.structuredContent !== undefined ? envelope.structuredContent : result;
}

/* What the tools answer */

/**
 * Mirrors what Trek itself does on write rather than failing loudly: it coerces any fraction that
 * is not 0.5 to 1, so a legacy row carrying 0.25 is a 1 as far as Trek is concerned.
 */
const fractionSchema = z.number().transform((value): TrekFraction => (value === 0.5 ? 0.5 : 1));

export const entryListSchema = z.array(
  z.object({
    id: z.number().int(),
    // Whose day it is: `get_vacay_entries` answers for the whole **plan**, and on a shared plan it
    // hands back every member's leave.
    user_id: z.number().int().nullish(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    fraction: fractionSchema,
    // Loud on an unknown kind: `vacation` and `comp` land in different buckets of Trek's own stats.
    kind: z.enum(["vacation", "comp"]),
  }),
);

const statsRowSchema = z.object({
  year: z.number().int(),
  total_available: z.number(),
  used: z.number(),
  remaining: z.number(),
});

/** The stats tool answers with a row or a list of them; both are accepted and normalised. */
export const statsPayloadSchema = z.union([z.array(statsRowSchema), statsRowSchema]);

export const toggleSchema = z.object({ action: z.enum(["added", "updated", "removed"]) });

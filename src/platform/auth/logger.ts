import type { Logger } from "better-auth";
import { DrizzleQueryError } from "drizzle-orm";

// Credentials never reach the logs (spec §5.4): OAuth codes and tokens travel in URL query
// strings, and a failed query's message lists its parameters (password hashes, session tokens).
const URL_QUERY = /(\b[a-z][a-z\d+.-]*:\/\/[^\s?#"'<>]*)\?[^\s#"'<>]*/gi;
const QUERY_PARAMS_LINE = /^params: .*$/gm;

function redactText(text: string): string {
  return text.replace(URL_QUERY, "$1?[redacted]").replace(QUERY_PARAMS_LINE, "params: [redacted]");
}

/** A copy of the error with its message, stack and cause redacted; extra properties except `code` dropped. */
function redactError(error: Error): Error {
  const message =
    error instanceof DrizzleQueryError ? `Failed query: ${error.query}` : redactText(error.message);
  const redacted = new Error(
    message,
    error.cause === undefined ? undefined : { cause: redactForLog(error.cause) },
  );
  redacted.name = error.name;
  redacted.stack =
    error.stack === undefined ? undefined : redactText(error.stack.replace(error.message, message));
  if ("code" in error && typeof error.code === "string") Object.assign(redacted, { code: error.code });
  return redacted;
}

export function redactForLog(value: unknown): unknown {
  if (value instanceof Error) return redactError(value);
  if (typeof value === "string") return redactText(value);
  return value;
}

/** Better Auth's logger: the default level (warn), with every message and argument redacted. */
export const authLogger: Logger = {
  log: (level, message, ...args) =>
    console[level](`[Better Auth] ${redactText(message)}`, ...args.map(redactForLog)),
};

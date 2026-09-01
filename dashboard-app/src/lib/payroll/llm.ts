/**
 * LLM extraction pass — an OpenAI-compatible Chat Completions endpoint over
 * plain `fetch` (no SDK is a dependency of this app).
 *
 * The base URL is configurable (default `https://api.openai.com/v1`), so the
 * exact same code drives api.openai.com, OpenRouter, or a self-hosted
 * llama.cpp/Ollama OpenAI shim on the LAN. Credentials, model and base URL are
 * resolved by `@/lib/payroll/llm-config` (Settings first, environment second)
 * and handed in through `LlmOptions`; this module only knows how to talk.
 *
 * Strict JSON is forced with a single function-tool definition plus a forced
 * `tool_choice`, so the model can only answer by filling the schema. Money and
 * hours come back as STRINGS (the payslip prints `1.234,56`; keeping them as
 * text avoids float/locale guesswork on the model's side) and are parsed here.
 * Unlike Anthropic, the tool arguments arrive as a JSON *string* that has to be
 * parsed — a malformed one is a normal failure, not a throw.
 *
 * Contract: never throws and never logs the API key or payslip content. Any
 * failure returns `{ fields: {}, error }` so the rules pass stands alone.
 */

import { parseItalianNumber } from "@/lib/format";
import type { PayslipField } from "@/lib/contracts";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import { env } from "@/lib/env";

/** OpenAI's own v1 root. Anything OpenAI-compatible can be pointed at instead. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const TOOL_NAME = "record_payslip";

export const DEFAULT_TIMEOUT_MS = 25_000;
/** Payslips are ~2-4 KB of text; the cap only bites on pathological OCR. */
export const DEFAULT_MAX_CHARS = 24_000;
const MAX_TOKENS = 2048;

export interface LlmPassResult {
  readonly fields: Partial<Record<PayslipField, number | null>>;
  readonly isThirteenth: boolean | null;
  readonly month: string | null;
  readonly error?: string;
  readonly truncated?: boolean;
}

export interface LlmOptions {
  /** Injected in tests so the suite never touches the network. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxChars?: number;
  readonly apiKey?: string;
  readonly model?: string;
  /** Root of the OpenAI-compatible API, without the `/chat/completions` leaf. */
  readonly baseUrl?: string;
}

const FIELD_DESCRIPTIONS: Readonly<Record<PayslipField, string>> = {
  gross: "TOTALE LORDO — gross pay for the period, euros.",
  net: "NETTO BUSTA — net pay actually paid, euros.",
  taxes:
    "Total income tax withheld: TOTALE TRATTENUTE IRPEF plus ADDIZIONALE REGIONALE and ADDIZIONALE COMUNALE, euros.",
  fundContribEmployee: "FONDO C/DIPE — pension fund contribution, employee share, euros.",
  fundContribEmployer: "FONDO C/AZIENDA — pension fund contribution, employer share, euros.",
  ferieBalance: "FERIE RES. — residual vacation balance, in HOURS.",
  rolBalance: "ROL RES. — residual ROL balance, in HOURS.",
  permessiBalance: "PERMESSI RES. — residual permessi balance, in HOURS.",
  ferieTakenHours:
    "FERIE GOD. from the leave grid — vacation used, in HOURS. Body row 300 " +
    "ASSENZA X FERIE A.C.(hh) is a different figure; prefer the grid column.",
  rolTakenHours: "ROL. GOD. from the leave grid — ROL used this period, in HOURS. 0 when blank.",
};

const SYSTEM_PROMPT = [
  "You extract figures from an Italian payslip (TeamSystem 'Mod. Cedolino TS').",
  "Read only what is printed: never compute, infer or carry over a value from elsewhere.",
  "If a figure is absent, unreadable, or you are unsure which column it belongs to, return null for it.",
  "Return every amount exactly as printed, including the Italian thousands/decimal separators.",
  "Vacation, permessi and ROL balances are in hours, not days.",
].join(" ");

/**
 * One OpenAI `function` tool. The JSON Schema is the same shape the Anthropic
 * transport used, only under `parameters` instead of `input_schema`; `strict`
 * moves inside the function object. `additionalProperties: false` plus a
 * fully-populated `required` are what OpenAI's structured-output mode demands,
 * and servers that do not implement strict mode simply ignore the flag.
 */
function buildTool(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of PAYSLIP_FIELDS) {
    properties[field] = {
      type: ["string", "null"],
      description: `${FIELD_DESCRIPTIONS[field]} As printed, e.g. "1.234,56". null if absent.`,
    };
  }
  properties["isThirteenth"] = {
    type: ["boolean", "null"],
    description:
      "true if this document is a tredicesima / 13ma / gratifica natalizia rather than an ordinary month.",
  };
  properties["month"] = {
    type: ["string", "null"],
    description: "Pay period as YYYY-MM, from the 'periodo di paga' header. null if absent.",
  };
  return {
    type: "function",
    function: {
      name: TOOL_NAME,
      description: "Record the figures read off this payslip. Call exactly once.",
      strict: true,
      parameters: {
        type: "object",
        properties,
        required: [...PAYSLIP_FIELDS, "isThirteenth", "month"],
        additionalProperties: false,
      },
    },
  };
}

function emptyResult(error?: string, truncated?: boolean): LlmPassResult {
  return {
    fields: {},
    isThirteenth: null,
    month: null,
    ...(error ? { error } : {}),
    ...(truncated ? { truncated } : {}),
  };
}

function coerceNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  return parseItalianNumber(raw.trim());
}

function coerceMonth(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})/.exec(raw.trim());
  if (!m?.[1] || !m[2]) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Maps the tool input onto the domain shape, ignoring anything unexpected. */
export function parseToolInput(input: unknown, truncated: boolean): LlmPassResult {
  if (typeof input !== "object" || input === null) {
    return emptyResult("llm returned a non-object tool input", truncated);
  }
  const raw = input as Record<string, unknown>;
  const fields: Partial<Record<PayslipField, number | null>> = {};
  for (const field of PAYSLIP_FIELDS) {
    fields[field] = coerceNumber(raw[field]);
  }
  const isThirteenth = typeof raw["isThirteenth"] === "boolean" ? raw["isThirteenth"] : null;
  return {
    fields,
    isThirteenth,
    month: coerceMonth(raw["month"]),
    ...(truncated ? { truncated: true } : {}),
  };
}

interface ToolCall {
  readonly type?: unknown;
  readonly function?: { readonly name?: unknown; readonly arguments?: unknown };
}

/** `{baseUrl}` may or may not carry a trailing slash; normalise before joining. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * The token-limit parameter is the one place where "OpenAI-compatible" is not.
 *
 * Current OpenAI models REJECT `max_tokens` and require `max_completion_tokens`;
 * plenty of compatible servers (llama.cpp, older vLLM/LocalAI builds) only ever
 * learned `max_tokens`. Sending both is not an option — OpenAI 400s on the pair.
 * So: send the forward-looking `max_completion_tokens`, and if the server comes
 * back 400 *naming* a token parameter, retry once with `max_tokens`. Any other
 * 400 is a real error and is not retried. One extra round-trip, only on a server
 * that has told us in so many words which name it wants.
 */
const TOKEN_PARAM_HINT = /max_(completion_)?tokens/i;

type TokenParam = "max_completion_tokens" | "max_tokens";

/**
 * One request, one answer (plus at most one token-parameter retry). Errors are
 * returned, never thrown, and never carry response bodies, prompt text or the
 * API key into the message.
 */
export async function runLlmPass(text: string, options: LlmOptions = {}): Promise<LlmPassResult> {
  let apiKey = options.apiKey;
  let model = options.model;
  let baseUrl = options.baseUrl;
  // Environment is the *fallback* only: the caller (see `resolveLlmConfig`) has
  // already merged Settings over env. Reading it here keeps a direct call to
  // this module working without a database.
  if (!apiKey || !model || !baseUrl) {
    try {
      const config = env();
      apiKey = apiKey ?? config.OPENAI_API_KEY;
      model = model ?? config.LLM_MODEL;
      baseUrl = baseUrl ?? config.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    } catch {
      // env() only throws when the *whole* environment is unparseable, which
      // says nothing about the LLM; degrade rather than take the pipeline down.
      if (!apiKey) return emptyResult("llm skipped: environment not configured");
      baseUrl = baseUrl ?? DEFAULT_BASE_URL;
    }
  }
  if (!apiKey) return emptyResult("llm skipped: no API key configured");
  if (!model) return emptyResult("llm skipped: no model configured");
  const url = chatCompletionsUrl(baseUrl ?? DEFAULT_BASE_URL);

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const truncated = text.length > maxChars;
  const payload = truncated ? text.slice(0, maxChars) : text;
  if (!payload.trim()) return emptyResult("llm skipped: empty text");

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") return emptyResult("llm skipped: fetch unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const send = (tokenParam: TokenParam): Promise<Response> =>
    doFetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // Bearer auth is the OpenAI convention every compatible server accepts.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        [tokenParam]: MAX_TOKENS,
        // No `temperature`: the current OpenAI models reject any value but the
        // default, and the forced tool call already pins the output shape.
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Payslip text follows.\n\n<payslip>\n${payload}\n</payslip>`,
          },
        ],
        tools: [buildTool()],
        tool_choice: { type: "function", function: { name: TOOL_NAME } },
        parallel_tool_calls: false,
      }),
    });

  try {
    let response = await send("max_completion_tokens");

    if (response.status === 400) {
      // Read the body ONLY to sniff which parameter name the server wants, then
      // drop it on the floor — it can echo the request, i.e. payslip text.
      let complainsAboutTokens = false;
      try {
        complainsAboutTokens = TOKEN_PARAM_HINT.test(await response.text());
      } catch {
        complainsAboutTokens = false;
      }
      if (complainsAboutTokens) response = await send("max_tokens");
    }

    if (!response.ok) {
      // Status only: the body can echo request content.
      return emptyResult(`llm http ${response.status}`, truncated);
    }

    const body: unknown = await response.json();
    const choices = (body as { choices?: unknown } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return emptyResult("llm response had no choices", truncated);
    }
    const message = (choices[0] as { message?: { tool_calls?: unknown } } | null)?.message;
    const calls = message?.tool_calls;
    if (!Array.isArray(calls)) return emptyResult("llm did not call the extraction tool", truncated);
    const call = (calls as ToolCall[]).find((c) => c?.function?.name === TOOL_NAME);
    const args = call?.function?.arguments;
    if (typeof args !== "string") {
      return emptyResult("llm did not call the extraction tool", truncated);
    }

    // OpenAI hands the arguments back as a JSON *string*, so it can be invalid
    // JSON (a truncated generation, a non-strict server). Failure, not a throw.
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      return emptyResult("llm returned malformed tool arguments", truncated);
    }
    return parseToolInput(parsed, truncated);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return emptyResult(aborted ? "llm timed out" : `llm request failed: ${errorName(err)}`, truncated);
  } finally {
    clearTimeout(timer);
  }
}

/** Error *type*, not message — messages can quote the request body or the key. */
function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}

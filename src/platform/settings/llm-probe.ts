import "server-only";

/**
 * "Test connection" for the OpenAI fallback of spec D12/D18: does the saved key work, and does the
 * saved model exist for it?
 *
 * HTTP only — no database handle, no module import, no transaction. The credential is passed in
 * (the caller opens it; see `llmFallbackCredentials`) so this file never learns where keys are
 * kept, and nothing it returns can carry one: {@link LlmProbeResult} has no field for it.
 *
 * The probe is a **read**, `GET /v1/models/{model}`: it proves key *and* model in one request
 * without generating a single billable token, which a chat completion would. One attempt, no
 * retry, and a hard timeout ({@link LLM_PROBE_TIMEOUT_MS}) — an admin pressing a button waits.
 * The answer's body is never read, let alone shown: the outcome is decided from the status code
 * alone, so no external text can reach a message (spec §5.4).
 */

/** The OpenAI models endpoint (spec D18: no other provider, no configurable base URL). */
export const LLM_PROBE_URL = "https://api.openai.com/v1/models";

/** A button press is not a background job: it fails fast rather than hanging the card. */
export const LLM_PROBE_TIMEOUT_MS = 8_000;

/**
 * What the probe found, as a `settings.llm.test.*` message key. A code, not a sentence: the card
 * turns it into a catalogued message, so no English text is built on the server.
 */
export type LlmProbeOutcome =
  "ok" | "keyRejected" | "modelMissing" | "rateLimited" | "notConfigured" | "unreachable";

/**
 * The result, deliberately this narrow: the only string that ever travels back is the model the
 * admin themselves saved, so no edit here can leak the key or quote OpenAI's body.
 */
export type LlmProbeResult = { outcome: "ok"; model: string } | { outcome: Exclude<LlmProbeOutcome, "ok"> };

/** Anything outside 2xx that is not one of these is a bad afternoon, not a verdict on the key. */
function outcomeOfStatus(status: number): Exclude<LlmProbeOutcome, "ok" | "notConfigured"> {
  switch (status) {
    // 401 is a wrong or revoked key; 403 is a key that may not reach this endpoint at all.
    case 401:
    case 403:
      return "keyRejected";
    // 404: no such model, or none this key is entitled to — OpenAI does not distinguish.
    case 404:
      return "modelMissing";
    // 429 is rate limit *and* exhausted quota; 402 is billing refusing outright.
    case 402:
    case 429:
      return "rateLimited";
    default:
      return "unreachable";
  }
}

export async function probeLlmFallback(
  credentials: { model: string; apiKey: string } | null,
  deps: { fetch: typeof fetch } = { fetch: globalThis.fetch },
): Promise<LlmProbeResult> {
  if (!credentials) return { outcome: "notConfigured" };
  const { model, apiKey } = credentials;
  let status: number;
  try {
    const response = await deps.fetch(`${LLM_PROBE_URL}/${encodeURIComponent(model)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LLM_PROBE_TIMEOUT_MS),
    });
    if (response.ok) return { outcome: "ok", model };
    status = response.status;
  } catch {
    // A refused connection, a DNS failure or the timeout above. The reason stays here: its text
    // could quote the request, and the key travels in that request.
    return { outcome: "unreachable" };
  }
  return { outcome: outcomeOfStatus(status) };
}

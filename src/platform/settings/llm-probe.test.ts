// The "Test connection" probe of Admin › Server (spec D12, D18), against a stand-in for OpenAI:
// no request leaves the process, and the key below is synthetic.
import { describe, expect, it, vi } from "vitest";
import { LLM_PROBE_TIMEOUT_MS, LLM_PROBE_URL, type LlmProbeResult, probeLlmFallback } from "./llm-probe";

const KEY = "sk-test_abcdefghijklmnopqrstuvwxyz0123";
const MODEL = "gpt-5-mini";
const CREDENTIALS = { model: MODEL, apiKey: KEY };

/**
 * The compile-time half of "the key never comes back": no branch of the result has a field a
 * credential could sit in. Distributed over the union, so adding one to a single branch is caught
 * too. If the type grows an `apiKey`, this file stops type-checking.
 */
type SecretKeys<T> = T extends unknown
  ? Extract<keyof T, "apiKey" | "key" | "credentials" | "secret">
  : never;
type CarriesNoSecret<T> = [SecretKeys<T>] extends [never] ? true : false;
const RESULT_CARRIES_NO_SECRET: CarriesNoSecret<LlmProbeResult> = true;

/** A `fetch` that answers with a status and never a body worth reading. */
function openAi(status: number, body = '{"id":"gpt-5-mini","object":"model"}') {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

/** Every string the result carries, for "the key is not in here". */
function text(result: LlmProbeResult): string {
  return JSON.stringify(result);
}

describe("probeLlmFallback (Admin › Server, «Test connection»)", () => {
  it("reads the model instead of generating, with the key in the header and a timeout", async () => {
    const fetchStub = openAi(200);
    const result = await probeLlmFallback(CREDENTIALS, { fetch: fetchStub });

    expect(result).toEqual({ outcome: "ok", model: MODEL });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe(`${LLM_PROBE_URL}/${MODEL}`);
    expect(init?.method).toBe("GET");
    // A read, not a completion: nothing is generated and nothing is billed.
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(LLM_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(text(result)).not.toContain(KEY);
  });

  it("tells the six outcomes apart, and never gives one of them a key or an answer body", async () => {
    const secret = '{"error":{"message":"Incorrect API key provided: sk-live_realkeyleaked"}}';
    const cases: { answer: () => ReturnType<typeof openAi>; expected: LlmProbeResult }[] = [
      { answer: () => openAi(401, secret), expected: { outcome: "keyRejected" } },
      { answer: () => openAi(403, secret), expected: { outcome: "keyRejected" } },
      { answer: () => openAi(404, secret), expected: { outcome: "modelMissing" } },
      { answer: () => openAi(429, secret), expected: { outcome: "rateLimited" } },
      { answer: () => openAi(402, secret), expected: { outcome: "rateLimited" } },
      { answer: () => openAi(500, secret), expected: { outcome: "unreachable" } },
    ];
    for (const { answer, expected } of cases) {
      const fetchStub = answer();
      const result = await probeLlmFallback(CREDENTIALS, { fetch: fetchStub });
      expect(result, `status ${String(expected.outcome)}`).toEqual(expected);
      // No retry: one press, one request.
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(text(result)).not.toContain(KEY);
      expect(text(result)).not.toContain("Incorrect API key");
      expect(text(result)).not.toContain("sk-");
    }
  });

  it("calls a network failure or a timeout unreachable, without the reason's text", async () => {
    const failures = [
      new TypeError("fetch failed: ECONNREFUSED 10.0.0.1:443"),
      Object.assign(new Error(`The operation was aborted: ${KEY}`), { name: "TimeoutError" }),
    ];
    for (const failure of failures) {
      const fetchStub = vi.fn<typeof fetch>(async () => {
        throw failure;
      });
      const result = await probeLlmFallback(CREDENTIALS, { fetch: fetchStub });
      expect(result).toEqual({ outcome: "unreachable" });
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(text(result)).not.toContain(KEY);
      expect(text(result)).not.toContain("ECONNREFUSED");
    }
  });

  it("sends nothing at all when no admin has saved a configuration", async () => {
    const fetchStub = openAi(200);
    expect(await probeLlmFallback(null, { fetch: fetchStub })).toEqual({ outcome: "notConfigured" });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(RESULT_CARRIES_NO_SECRET).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { chatCompletionsUrl, parseToolInput, runLlmPass } from "@/lib/payroll/llm";

const SECRET = "sk-proj-test-do-not-log-0123456789";
const BASE = "https://api.openai.com/v1";

/** OpenAI hands tool arguments back as a JSON *string*, not an object. */
function toolResponse(input: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "record_payslip", arguments: JSON.stringify(input) },
              },
            ],
          },
        },
      ],
    }),
  } as unknown as Response;
}

function errorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response;
}

const FULL_INPUT = {
  gross: "3.000,00",
  net: "2.035,80",
  taxes: "643,50",
  fundContribEmployee: "37,20",
  fundContribEmployer: "46,50",
  ferieBalance: "45,33",
  rolBalance: "12,00",
  permessiBalance: "12,00",
  ferieTakenHours: "16,00",
  isThirteenth: false,
  month: "2026-08",
};

interface Body {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tool_choice: { type: string; function: { name: string } };
  tools: Array<{
    type: string;
    function: { name: string; strict: boolean; parameters: Record<string, unknown> };
  }>;
  max_completion_tokens?: number;
  max_tokens?: number;
  temperature?: number;
}

function sentBody(call: unknown): Body {
  const [, init] = call as [string, RequestInit];
  return JSON.parse(String(init.body)) as Body;
}

describe("chatCompletionsUrl", () => {
  it("joins the leaf onto a base URL with or without a trailing slash", () => {
    expect(chatCompletionsUrl(BASE)).toBe("https://api.openai.com/v1/chat/completions");
    expect(chatCompletionsUrl("http://ollama:11434/v1//")).toBe(
      "http://ollama:11434/v1/chat/completions",
    );
  });
});

describe("runLlmPass", () => {
  it("forces strict JSON through a single function tool and parses Italian money strings", async () => {
    const fetchImpl = vi.fn(async () => toolResponse(FULL_INPUT));
    const result = await runLlmPass("NETTO BUSTA 2.035,80", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "gpt-4.1-mini",
      baseUrl: BASE,
    });

    expect(result.error).toBeUndefined();
    expect(result.fields.net).toBe(2035.8);
    expect(result.fields.gross).toBe(3000);
    expect(result.fields.ferieBalance).toBe(45.33);
    expect(result.month).toBe("2026-08-01");
    expect(result.isThirteenth).toBe(false);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${SECRET}`);

    const body = sentBody(fetchImpl.mock.calls[0]);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.tool_choice).toMatchObject({ type: "function", function: { name: "record_payslip" } });
    expect(body.tools[0]?.type).toBe("function");
    expect(body.tools[0]?.function.strict).toBe(true);
    expect(body.tools[0]?.function.parameters).toMatchObject({ additionalProperties: false });
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]?.role).toBe("user");
    // No temperature: current models reject anything but the default.
    expect(body.temperature).toBeUndefined();
  });

  it("targets whatever OpenAI-compatible base URL it is given", async () => {
    const fetchImpl = vi.fn(async () => toolResponse(FULL_INPUT));
    await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "llama-3.1-8b",
      baseUrl: "http://ollama:11434/v1",
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://ollama:11434/v1/chat/completions");
  });

  it("sends max_completion_tokens and never both token parameters", async () => {
    const fetchImpl = vi.fn(async () => toolResponse(FULL_INPUT));
    await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    const body = sentBody(fetchImpl.mock.calls[0]);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
  });

  it("retries once with max_tokens when a compatible server rejects the new name", async () => {
    const fetchImpl = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        errorResponse(400, '{"error":{"message":"unknown field: max_completion_tokens"}}'),
      )
      .mockResolvedValueOnce(toolResponse(FULL_INPUT));

    const result = await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });

    expect(result.error).toBeUndefined();
    expect(result.fields.net).toBe(2035.8);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchImpl.mock.calls[0]).max_completion_tokens).toBe(2048);
    const retry = sentBody(fetchImpl.mock.calls[1]);
    expect(retry.max_tokens).toBe(2048);
    expect(retry.max_completion_tokens).toBeUndefined();
  });

  it("does not retry a 400 that is about something else", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400, '{"error":{"message":"no such model"}}'));
    const result = await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("llm http 400");
  });

  it("caps the input text and reports the truncation", async () => {
    const fetchImpl = vi.fn(async () => toolResponse(FULL_INPUT));
    const result = await runLlmPass("X".repeat(5000), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
      maxChars: 100,
    });
    expect(result.truncated).toBe(true);
    const body = sentBody(fetchImpl.mock.calls[0]);
    expect(body.messages[1]?.content.match(/X/g)?.length).toBe(100);
  });

  it("returns an error instead of throwing on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(529));
    const result = await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(result.fields).toEqual({});
    expect(result.error).toBe("llm http 529");
  });

  it("times out without throwing and never leaks the key or the payslip", async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const result = await runLlmPass("NETTO BUSTA 2.035,80", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
      timeoutMs: 5,
    });
    expect(result.error).toBe("llm timed out");
    expect(result.error).not.toContain(SECRET);
    expect(result.error).not.toContain("2.035,80");
  });

  it("survives a transport failure and a response without a tool call", async () => {
    const boom = await runLlmPass("text", {
      fetchImpl: (() => Promise.reject(new TypeError("network down"))) as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(boom.fields).toEqual({});
    expect(boom.error).toBe("llm request failed: TypeError");
    expect(boom.error).not.toContain("network down");

    const noChoices = await runLlmPass("text", {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      })) as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(noChoices.error).toBe("llm response had no choices");

    const noTool = await runLlmPass("text", {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "sorry" } }] }),
      })) as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(noTool.error).toBe("llm did not call the extraction tool");
  });

  it("treats malformed tool arguments as a failure, not a throw", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  { type: "function", function: { name: "record_payslip", arguments: "{ net: " } },
                ],
              },
            },
          ],
        }),
      }) as unknown as Response;
    const result = await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: SECRET,
      model: "m",
      baseUrl: BASE,
    });
    expect(result.fields).toEqual({});
    expect(result.error).toBe("llm returned malformed tool arguments");
  });

  /**
   * The key travels in one place only — the Authorization header — so no
   * failure path may ever put it in the string the caller stores in
   * `job_runs.error` or renders on the verification screen.
   */
  it("never puts the API key in any returned error string", async () => {
    const failures: Array<() => Promise<Response>> = [
      async () => errorResponse(401, `Incorrect API key provided: ${SECRET}`),
      async () => errorResponse(400, `bad request for key ${SECRET}`),
      () => Promise.reject(new Error(`connect ECONNREFUSED using ${SECRET}`)),
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError(`Unexpected token, key was ${SECRET}`);
          },
        }) as unknown as Response,
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  tool_calls: [
                    { type: "function", function: { name: "record_payslip", arguments: SECRET } },
                  ],
                },
              },
            ],
          }),
        }) as unknown as Response,
    ];

    for (const fetchImpl of failures) {
      const result = await runLlmPass("NETTO BUSTA 2.035,80", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        apiKey: SECRET,
        model: "m",
        baseUrl: BASE,
      });
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain(SECRET);
      expect(result.error).not.toContain("2.035,80");
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it("skips rather than calling out when there is no key", async () => {
    const fetchImpl = vi.fn(async () => toolResponse(FULL_INPUT));
    const result = await runLlmPass("text", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: "",
      model: "m",
      baseUrl: BASE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toMatch(/^llm skipped/);
  });

  it("degrades when no credentials are configured", async () => {
    // fetchImpl is a rejecting stub so the suite cannot reach the network even
    // if the machine running the tests happens to have the env configured.
    const result = await runLlmPass("text", {
      fetchImpl: (() => Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch,
    });
    expect(result.fields).toEqual({});
    expect(result.error).toMatch(/^llm (skipped|request failed)/);
  });
});

describe("parseToolInput", () => {
  it("accepts nulls and ignores unknown keys", () => {
    const result = parseToolInput({ net: null, gross: "1.234,56", surprise: 1 }, false);
    expect(result.fields.gross).toBe(1234.56);
    expect(result.fields.net).toBeNull();
    expect(result.isThirteenth).toBeNull();
  });

  it("rejects a non-object input", () => {
    expect(parseToolInput("nope", false).error).toBeTruthy();
  });
});

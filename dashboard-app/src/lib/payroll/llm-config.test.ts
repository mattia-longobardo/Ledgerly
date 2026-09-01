import { beforeEach, describe, expect, it, vi } from "vitest";

const getSetting = vi.fn();
const envMock = vi.fn();

vi.mock("@/lib/repo/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo/settings")>();
  return { ...actual, getSetting, setSetting: vi.fn() };
});
vi.mock("@/lib/env", () => ({ env: envMock }));

const { checkBaseUrl, llmConfigStatus, llmOptionsFromConfig, resolveLlmConfig } = await import(
  "@/lib/payroll/llm-config"
);

/** `getSetting(key, fallback)` — answer per key from a plain map. */
function settings(values: Record<string, unknown>) {
  getSetting.mockImplementation(async (key: string, fallback: unknown) =>
    key in values ? values[key] : fallback,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settings({});
  envMock.mockReturnValue({});
});

describe("resolveLlmConfig", () => {
  it("lets Settings win over the environment, field by field", async () => {
    envMock.mockReturnValue({
      OPENAI_API_KEY: "env-key",
      OPENAI_BASE_URL: "https://env.example.com/v1",
      LLM_MODEL: "env-model",
    });
    settings({ llm_api_key: "settings-key", llm_model: "settings-model" });

    const config = await resolveLlmConfig();
    expect(config.apiKey).toBe("settings-key");
    expect(config.model).toBe("settings-model");
    // Not overridden in Settings, so the environment still supplies it.
    expect(config.baseUrl).toBe("https://env.example.com/v1");
  });

  it("falls back to the environment and then to the OpenAI default", async () => {
    envMock.mockReturnValue({ OPENAI_API_KEY: "env-key", LLM_MODEL: "env-model" });
    const config = await resolveLlmConfig();
    expect(config).toEqual({
      apiKey: "env-key",
      baseUrl: "https://api.openai.com/v1",
      model: "env-model",
    });
  });

  it("treats a blank stored value as absent", async () => {
    envMock.mockReturnValue({ LLM_MODEL: "env-model" });
    settings({ llm_model: "   ", llm_api_key: null });
    const config = await resolveLlmConfig();
    expect(config.model).toBe("env-model");
    expect(config.apiKey).toBeUndefined();
  });

  it("never throws when the environment or the database is unavailable", async () => {
    envMock.mockImplementation(() => {
      throw new Error("Invalid environment configuration");
    });
    getSetting.mockRejectedValue(new Error("ECONNREFUSED"));

    const config = await resolveLlmConfig();
    expect(config).toEqual({ baseUrl: "https://api.openai.com/v1", model: "" });

    const options = await llmOptionsFromConfig();
    expect(options).toEqual({ baseUrl: "https://api.openai.com/v1" });
  });
});

describe("llmConfigStatus", () => {
  it("reports the key as present without ever returning its value", async () => {
    settings({ llm_api_key: "sk-secret-value", llm_model: "gpt-4.1-mini" });
    const status = await llmConfigStatus();

    expect(status.hasKey).toBe(true);
    expect(status.keySource).toBe("settings");
    expect(status.hasStoredKey).toBe(true);
    expect(status.disabledReason).toBeNull();
    expect(JSON.stringify(status)).not.toContain("sk-secret-value");
  });

  it("distinguishes an environment key, which cannot be cleared from the UI", async () => {
    envMock.mockReturnValue({ OPENAI_API_KEY: "env-key", LLM_MODEL: "m" });
    const status = await llmConfigStatus();
    expect(status.keySource).toBe("env");
    expect(status.hasStoredKey).toBe(false);
    expect(status.modelSource).toBe("env");
    expect(status.baseUrlSource).toBe("default");
  });

  it("explains why the pass is off when nothing is configured", async () => {
    const status = await llmConfigStatus();
    expect(status.hasKey).toBe(false);
    expect(status.disabledReason).toMatch(/No API key/);
  });

  it("explains a missing model too", async () => {
    settings({ llm_api_key: "k" });
    const status = await llmConfigStatus();
    expect(status.disabledReason).toMatch(/No model/);
  });
});

describe("checkBaseUrl", () => {
  it("accepts and normalises an https endpoint", () => {
    expect(checkBaseUrl("  https://api.openai.com/v1/  ")).toEqual({
      ok: true,
      url: "https://api.openai.com/v1",
    });
    expect(checkBaseUrl("https://openrouter.ai/api/v1?x=1#f")).toEqual({
      ok: true,
      url: "https://openrouter.ai/api/v1",
    });
  });

  it("allows plain http only for a host that cannot leave the LAN", () => {
    for (const url of [
      "http://localhost:8080/v1",
      "http://127.0.0.1:11434/v1",
      "http://192.168.1.20:8080/v1",
      "http://10.0.0.5/v1",
      "http://172.16.4.4/v1",
      "http://ollama:11434/v1",
      "http://box.local/v1",
      "http://gpu.home.arpa/v1",
      "http://[::1]:8080/v1",
    ]) {
      expect(checkBaseUrl(url), url).toMatchObject({ ok: true });
    }
  });

  it("refuses plain http to a public host", () => {
    const result = checkBaseUrl("http://api.openai.com/v1");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/own network/);
    expect(checkBaseUrl("http://172.32.0.1/v1").ok).toBe(false);
  });

  it("refuses junk, other schemes and embedded credentials", () => {
    expect(checkBaseUrl("").ok).toBe(false);
    expect(checkBaseUrl("api.openai.com/v1").ok).toBe(false);
    expect(checkBaseUrl("ftp://api.openai.com/v1").ok).toBe(false);
    expect(checkBaseUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkBaseUrl("https://user:pass@api.openai.com/v1").ok).toBe(false);
  });
});

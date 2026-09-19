// The OpenAI fallback (spec D12, D18) and its admin settings, against the real test database and
// bucket, with a stand-in for OpenAI: no request ever leaves.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listEvidence } from "@/modules/imports/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { appSettings } from "@/platform/settings/schema";
import {
  llmFallbackAvailable,
  llmFallbackCredentials,
  llmFallbackView,
  removeLlmFallback,
  saveLlmFallback,
  SettingsError,
} from "@/platform/settings/service";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { MARCH } from "../../../tests/fixtures/payroll/samples";
import { twinPdf } from "../../../tests/fixtures/payroll/twin";
import { fillWithLlm } from "./llm";
import { decideField, PayrollError, processPayslip, uploadPayslip, verifyPayslip } from "./service";

const KEY = "sk-test_abcdefghijklmnopqrstuvwxyz0123";
let ctx: Ctx;
let admin: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  admin = { ...(await newContext()), role: "admin" };
});
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

/** March with its IRPEF gross and net boxes blank: two values the rules cannot find. */
async function withBlanks() {
  const bytes = await twinPdf({ ...MARCH, irpefGross: undefined, net: "" });
  const { document } = await uploadPayslip(ctx, { name: "m.pdf", bytes });
  await processPayslip(ctx, document.id);
  return document.id;
}

function openAi(reply: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status }),
  );
}

describe("the fallback's settings (Admin › Server)", () => {
  it("are an admin's only, seal the key, and never give it back", async () => {
    await expect(saveLlmFallback(ctx, { model: "gpt-5-mini", apiKey: KEY })).rejects.toBeInstanceOf(SettingsError);
    await expect(llmFallbackView(ctx)).rejects.toBeInstanceOf(SettingsError);

    await saveLlmFallback(admin, { model: "gpt-5-mini", apiKey: KEY });
    expect(await llmFallbackView(admin)).toMatchObject({ model: "gpt-5-mini", keyHint: "0123" });
    const [row] = await getDb().select().from(appSettings);
    expect(row.sealed!.toString("utf8")).not.toContain(KEY);
    expect(JSON.stringify(row.value)).not.toContain(KEY);
    expect(await llmFallbackCredentials()).toEqual({ model: "gpt-5-mini", apiKey: KEY });

    // An empty key keeps the stored one; a malformed one or model is refused.
    await saveLlmFallback(admin, { model: "gpt-5", apiKey: "" });
    expect(await llmFallbackCredentials()).toEqual({ model: "gpt-5", apiKey: KEY });
    await expect(saveLlmFallback(admin, { model: "gpt-5", apiKey: "not-a-key" })).rejects.toBeInstanceOf(SettingsError);
    await expect(saveLlmFallback(admin, { model: "https://evil.example/v1", apiKey: "" })).rejects.toBeInstanceOf(
      SettingsError,
    );

    await removeLlmFallback(admin);
    expect(await llmFallbackAvailable()).toBe(false);
    expect(await llmFallbackCredentials()).toBeNull();
  });
});

describe("fillWithLlm (spec §7.8 \"Fallback LLM\")", () => {
  it("sends nothing without a configuration", async () => {
    const id = await withBlanks();
    const fetch = openAi({});
    await expect(fillWithLlm(ctx, id, { fetch })).rejects.toSatisfy(
      (error) => error instanceof PayrollError && error.code === "llm_not_configured",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for the blank fields only, and stores the answers as inferred values to confirm", async () => {
    await saveLlmFallback(admin, { model: "gpt-5-mini", apiKey: KEY });
    const id = await withBlanks();
    const fetch = openAi({ irpefGross: "417.73", netPay: "1511.00", employeeSocial: "1.00" });
    expect(await fillWithLlm(ctx, id, { fetch })).toEqual({
      asked: ["irpefGross", "netPay"],
      filled: ["irpefGross", "netPay"],
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-5-mini");
    expect(Object.keys(body.response_format.json_schema.schema.properties).sort()).toEqual(["irpefGross", "netPay"]);
    expect(body.messages[1].content).toContain("NETTO BUSTA");
    expect(String(init?.body)).not.toContain(KEY);

    const evidence = await listEvidence(ctx, id);
    expect(evidence.find((row) => row.field === "netPay")).toMatchObject({
      value: "1511.00",
      origin: "inferred",
      confidence: "0.40",
      verification: "unverified",
      sourceLabel: "OpenAI gpt-5-mini",
    });
    // Not asked, so not taken.
    expect(evidence.find((row) => row.field === "employeeSocial")).toMatchObject({ value: "183.80", origin: "printed" });

    // An inferred value blocks verifying until a person decides on it.
    await expect(verifyPayslip(ctx, id)).rejects.toSatisfy(
      (error) => error instanceof PayrollError && error.code === "unconfirmed_inferred",
    );
    await decideField(ctx, id, "netPay", null);
    await decideField(ctx, id, "irpefGross", null);
    await verifyPayslip(ctx, id);
  });

  it("changes nothing when OpenAI fails, and says so with a code", async () => {
    await saveLlmFallback(admin, { model: "gpt-5-mini", apiKey: KEY });
    const id = await withBlanks();
    const before = await listEvidence(ctx, id);
    await expect(fillWithLlm(ctx, id, { fetch: openAi({ error: KEY }, 500) })).rejects.toSatisfy(
      (error) => error instanceof PayrollError && error.code === "llm_failed" && !String(error.message).includes(KEY),
    );
    const failing = vi.fn(async () => {
      throw new Error(`boom ${KEY}`);
    });
    await expect(fillWithLlm(ctx, id, { fetch: failing })).rejects.toSatisfy(
      (error) => error instanceof PayrollError && error.code === "llm_failed",
    );
    expect(await listEvidence(ctx, id)).toEqual(before);
  });

  it("asks nothing when no blank is left, and touches no one else's payslip", async () => {
    await saveLlmFallback(admin, { model: "gpt-5-mini", apiKey: KEY });
    const { document } = await uploadPayslip(ctx, { name: "m.pdf", bytes: await twinPdf(MARCH) });
    await processPayslip(ctx, document.id);
    const fetch = openAi({});
    expect(await fillWithLlm(ctx, document.id, { fetch })).toEqual({ asked: [], filled: [] });
    expect(fetch).not.toHaveBeenCalled();

    const blanks = await withBlanks();
    const other = await newContext();
    await expect(fillWithLlm(other, blanks, { fetch })).rejects.toSatisfy(
      (error) => error instanceof PayrollError && error.code === "not_found",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

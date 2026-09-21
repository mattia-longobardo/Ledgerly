import "server-only";
import { listEvidence, readOriginal, upsertEvidence } from "@/modules/imports/service";
import { readPdfText } from "@/modules/imports/pdf/text";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { llmFallbackCredentials } from "@/platform/settings/service";
import { FIELDS, type FieldName, isFieldName, llmFillable } from "./fields";
import { layoutText, readReply, requestBody } from "./parse/llm-prompt";
import { PayrollError, recompute } from "./service";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 25_000;
/** An inferred value is always low confidence and always to review (spec §7.8). */
const INFERRED_CONFIDENCE = 0.4;

/**
 * The OpenAI fallback (spec D12, D18, §7.8): for the fields the rules left `null` — and only
 * those —, one request with the document's text, personal identifiers masked; what comes back is
 * `inferred`, low confidence, unconfirmed, and blocks verifying until a person decides on it.
 * Without an admin's configuration nothing is sent. The key and the text never reach a log.
 * The request is made outside any transaction; the result is written in a short one.
 */
export async function fillWithLlm(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  deps: { fetch: typeof fetch } = { fetch: globalThis.fetch },
): Promise<{ asked: FieldName[]; filled: FieldName[] }> {
  const credentials = await llmFallbackCredentials();
  if (!credentials) throw new PayrollError("llm_not_configured");
  const evidence = await listEvidence(ctx, documentId);
  if (evidence.length === 0) throw new PayrollError("not_found");
  const asked = evidence
    .filter(
      (row) =>
        isFieldName(row.field) &&
        llmFillable(row.field) &&
        row.value === null &&
        row.origin === "printed" &&
        row.verification === "unverified",
    )
    .map((row) => row.field as FieldName);
  if (asked.length === 0) return { asked, filled: [] };

  const original = await readOriginal(ctx, documentId);
  if (!original) throw new PayrollError("not_found");
  const text = layoutText(await readPdfText(original.bytes));

  let content: unknown;
  try {
    const response = await deps.fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` },
      body: JSON.stringify(requestBody(credentials.model, asked, text)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PayrollError("llm_failed");
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    content = body.choices?.[0]?.message?.content;
  } catch (error) {
    // The reason stays a code: an HTTP error body could quote the request.
    if (error instanceof PayrollError) throw error;
    throw new PayrollError("llm_failed");
  }
  const values = readReply(content, asked);
  const filled = asked.filter((field) => values[field] !== undefined);
  if (filled.length === 0) return { asked, filled };

  await getDb().transaction(async (tx) => {
    await upsertEvidence(
      ctx,
      documentId,
      filled.map((field) => ({
        field,
        value: values[field]!,
        unit: FIELDS[field].unit,
        sourceLabel: `OpenAI ${credentials.model}`,
        page: null,
        bbox: null,
        origin: "inferred",
        confidence: INFERRED_CONFIDENCE,
        rawText: null,
      })),
      tx,
    );
    await recompute(ctx, documentId, tx);
  });
  return { asked, filled };
}

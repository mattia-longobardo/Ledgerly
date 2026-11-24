import type { PageText } from "../../imports/pdf/text";
import { centsToDecimal, parseCents } from "../../../shared/money";
import { FIELDS, type FieldName } from "../fields";
import type { PayslipProfile } from "../rules";

/** At most this much of the document's text goes out (plan F5 §3.5). */
export const MAX_TEXT_CHARS = 24_000;

/** What the prompt is built from: the profile the payslip was read with, a language, a currency. */
interface PromptSettings {
  profile: Pick<PayslipProfile, "language" | "prompt">;
  /** The person's language; the profile's own when it has no words in it. */
  language: string;
  /** The currency the payslip's amounts are in (ISO 4217). */
  currency: string;
}

/** The words of the prompt in the asked language, else in the profile's own. */
function wordsOf({ profile, language }: PromptSettings) {
  const asked = profile.prompt[language];
  return asked ? { language, words: asked } : { language: profile.language, words: profile.prompt[profile.language] };
}

/**
 * The system prompt (spec D12, D18): the profile's definitions of the fields the fallback may fill —
 * the owner's spec's (L91–161), word for word, for the first profile, its worked examples left out
 * (D14) — and the rules of the answer, the amounts in `currency`. The document's text is data,
 * never instructions (spec §9.3).
 */
export function systemPrompt(settings: PromptSettings): string {
  const { language, words } = wordsOf(settings);
  const currency = new Intl.DisplayNames([language], { type: "currency" }).of(settings.currency) ?? settings.currency;
  return [
    words.intro,
    "",
    words.rulesTitle,
    ...words.rules.map((rule) => `- ${rule.replaceAll("{currency}", currency)}`),
    "",
    words.definitionsTitle,
    ...words.definitions.map((definition) => `- ${definition.field} — ${definition.text}`),
  ].join("\n");
}

const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const TAX_CODE = /\b[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** Personal identifiers out before anything leaves (spec §5.4): IBAN, fiscal code, email. */
export function maskPersonal(text: string): string {
  return text.replace(IBAN, "[IBAN]").replace(TAX_CODE, "[CODICE FISCALE]").replace(EMAIL, "[EMAIL]");
}

/** The pages as lines of text in reading order — label rows and value rows by baseline. */
export function layoutText(pages: readonly PageText[]): string {
  const lines: string[] = [];
  for (const page of pages) {
    const rows = new Map<number, typeof page.items>();
    for (const item of page.items) {
      const key = Math.round(item.baseline);
      rows.set(key, [...(rows.get(key) ?? []), item]);
    }
    for (const [, items] of [...rows].toSorted(([a], [b]) => a - b)) {
      lines.push(
        items
          .toSorted((a, b) => a.x0 - b.x0)
          .map((item) => item.text.trim())
          .join("   "),
      );
    }
  }
  return maskPersonal(lines.join("\n")).slice(0, MAX_TEXT_CHARS);
}

/**
 * The request to OpenAI's Chat Completions API (spec D18) with structured output whose schema lists
 * only the fields still `null` (spec D12): nothing else can come back.
 */
export function requestBody(model: string, fields: readonly FieldName[], text: string, settings: PromptSettings) {
  const { words } = wordsOf(settings);
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt(settings) },
      { role: "user", content: `${words.fieldsTitle}: ${fields.join(", ")}.\n\n${words.textTitle}:\n${text}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "payslip_fields",
        strict: true,
        schema: {
          type: "object",
          properties: Object.fromEntries(
            fields.map((field) => [field, { type: ["string", "null"], description: `${field} (${FIELDS[field].unit})` }]),
          ),
          required: [...fields],
          additionalProperties: false,
        },
      },
    },
  };
}

/**
 * The values an answer carries for the asked fields, in canonical form. Anything that is not a plain
 * amount — or a field that was not asked — is dropped: a wrong number that looks right is far
 * worse than a blank.
 */
export function readAnswer(content: unknown, fields: readonly FieldName[]): Partial<Record<FieldName, string>> {
  let parsed: unknown = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      return {};
    }
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const out: Partial<Record<FieldName, string>> = {};
  for (const field of fields) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (FIELDS[field].unit !== "eur" || !/^-?\d{1,9}(\.\d{1,2})?$/.test(text)) continue;
    out[field] = centsToDecimal(parseCents(text));
  }
  return out;
}

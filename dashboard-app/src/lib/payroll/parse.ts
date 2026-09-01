/**
 * Payslip parsing orchestrator. Both passes always run (PLAN §4): the
 * deterministic anchors keep the LLM honest, the LLM buys robustness to layout
 * changes, and disagreement is surfaced rather than resolved.
 *
 * Contract: never throws. Every failure path degrades to low confidence.
 */

import type { FieldExtraction, PayslipExtraction, PayslipField, SanityCheck } from "@/lib/contracts";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import { ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS } from "@/lib/payroll/anchors";
import { crossValidate, median, type PayslipHistoryEntry } from "@/lib/payroll/confidence";
import { runLlmPass, type LlmOptions, type LlmPassResult } from "@/lib/payroll/llm";
import { detectPeriodMonth, runRules, type RulesResult } from "@/lib/payroll/rules";
import { extractTeamSystem } from "@/lib/payroll/teamsystem";
import { normalizeText, type TextSource } from "@/lib/payroll/text";

/** Bump on every change to anchors, engine or confidence rules. */
export const PARSER_VERSION = "payroll-1.0.0";

/** A tredicesima is roughly a second monthly net; accept a wide band. */
export const THIRTEENTH_NET_RATIO = { min: 1.6, max: 2.6 } as const;

export type LlmPass = (text: string) => Promise<LlmPassResult>;

export interface ParsePayslipInput {
  readonly text: string;
  readonly textSource: TextSource;
  /** Month key from Paperless metadata, when known; otherwise detected. */
  readonly month?: string | null;
  readonly history?: readonly PayslipHistoryEntry[];
  /** Injected in tests so the suite never touches the network. */
  readonly llm?: LlmPass;
  readonly llmOptions?: LlmOptions;
}

export interface ThirteenthSignals {
  readonly keyword: string | null;
  readonly december: boolean;
  readonly ordinaryMarkers: boolean;
  readonly netRatio: number | null;
  readonly llmFlag: boolean | null;
}

export interface ThirteenthDetection {
  readonly isThirteenth: boolean;
  readonly signals: ThirteenthSignals;
  readonly reasons: readonly string[];
}

export interface DetectThirteenthInput {
  readonly text: string;
  readonly month: string | null;
  readonly net: number | null;
  readonly history: readonly PayslipHistoryEntry[];
  readonly llmFlag?: boolean | null;
}

/**
 * The tredicesima normally arrives as its own Paperless document, so detection
 * only has to label a whole document — it never splits one.
 *
 * Interpretation of PLAN §4's three signals: keyword and "net ≈ 2× median" are
 * conclusive on their own; a December period is not, because every ordinary
 * December payslip would otherwise be mislabelled. December counts when the
 * document also lacks ordinary-month markers (ferie/ROL grid, worked hours) or
 * when the LLM independently flagged it.
 */
export function detectThirteenth(input: DetectThirteenthInput): ThirteenthDetection {
  const upper = input.text.toUpperCase();
  const keyword = THIRTEENTH_KEYWORDS.find((k) => upper.includes(k)) ?? null;
  const december = input.month !== null && input.month.slice(5, 7) === "12";
  const ordinaryMarkers = ORDINARY_MONTH_MARKERS.some((m) => upper.includes(m));

  const nets = input.history
    .filter((h) => !h.isThirteenth)
    .map((h) => h.net ?? null)
    .filter((v): v is number => v !== null);
  const med = nets.length >= 3 ? median(nets) : null;
  const netRatio = med !== null && med > 0 && input.net !== null ? input.net / med : null;
  const netDoubled =
    netRatio !== null && netRatio >= THIRTEENTH_NET_RATIO.min && netRatio <= THIRTEENTH_NET_RATIO.max;

  const llmFlag = input.llmFlag ?? null;
  const reasons: string[] = [];
  if (keyword) reasons.push(`keyword "${keyword}"`);
  if (netDoubled && netRatio !== null) reasons.push(`net is ${netRatio.toFixed(1)}× the ordinary median`);
  if (december && !ordinaryMarkers) reasons.push("December period with no ordinary-month rows");
  if (december && llmFlag === true) reasons.push("December period and the LLM read it as a tredicesima");

  return {
    isThirteenth: reasons.length > 0,
    signals: { keyword, december, ordinaryMarkers, netRatio, llmFlag },
    reasons,
  };
}

function emptyRules(): RulesResult {
  return { fields: {}, aux: {}, provenance: {}, degraded: [], errors: [] };
}

function allLowFields(): Partial<Record<PayslipField, FieldExtraction<number | null>>> {
  const fields: Partial<Record<PayslipField, FieldExtraction<number | null>>> = {};
  for (const field of PAYSLIP_FIELDS) {
    fields[field] = { value: null, confidence: "low", rules: null, llm: null };
  }
  return fields;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function parsePayslip(input: ParsePayslipInput): Promise<PayslipExtraction> {
  const textSource = input.textSource;
  try {
    const text = normalizeText(input.text);
    const history = input.history ?? [];

    let rules: RulesResult;
    try {
      rules = runRules(text);
    } catch (err) {
      rules = { ...emptyRules(), errors: [`rules pass failed: ${errorMessage(err)}`] };
    }

    // The employer's real "Mod. Cedolino TS" layout takes precedence over the
    // generic anchors: it is verified field-by-field against an actual payslip
    // and encodes the owner's own mapping (Cometa = 9110 + 8003 + 9109, taxes =
    // TOTALE TRATTENUTE, gross = net + taxes). The generic pass still runs and
    // still feeds cross-validation, so a layout change degrades rather than
    // silently producing wrong numbers.
    try {
      const ts = extractTeamSystem(text);
      const overlay: Partial<Record<PayslipField, number | null>> = {
        net: ts.net,
        taxes: ts.taxes,
        gross: ts.gross,
        fundContribEmployee: ts.fundEmployee,
        fundContribEmployer: ts.fundEmployer,
        ferieBalance: ts.ferieResidualHours,
        rolBalance: ts.rolResidualHours,
        ferieTakenHours: ts.ferieTakenHours,
        rolTakenHours: ts.rolTakenHours,
      };
      for (const [field, value] of Object.entries(overlay)) {
        if (value !== null && value !== undefined) {
          rules.fields[field as PayslipField] = value;
        }
      }
    } catch (err) {
      rules = { ...rules, errors: [...rules.errors, `teamsystem pass failed: ${errorMessage(err)}`] };
    }

    const runLlm: LlmPass = input.llm ?? ((t) => runLlmPass(t, input.llmOptions));
    let llm: LlmPassResult;
    try {
      llm = await runLlm(text);
    } catch (err) {
      // runLlmPass never throws, but an injected pass might.
      llm = { fields: {}, isThirteenth: null, month: null, error: `llm pass failed: ${errorMessage(err)}` };
    }

    const month = input.month ?? detectPeriodMonth(text) ?? llm.month ?? null;
    const netCandidate = rules.fields.net ?? llm.fields.net ?? null;
    const thirteenth = detectThirteenth({
      text,
      month,
      net: netCandidate,
      history,
      llmFlag: llm.isThirteenth,
    });

    const { fields, checks } = crossValidate({
      rules,
      llmFields: llm.fields,
      textSource,
      isThirteenth: thirteenth.isThirteenth,
      month,
      history,
    });

    const allChecks: SanityCheck[] = [...checks];
    if (thirteenth.isThirteenth) {
      allChecks.push({
        id: "tredicesima",
        label: "tredicesima",
        passed: true,
        detail: `flagged as tredicesima: ${thirteenth.reasons.join("; ")}`,
      });
    }
    for (const err of rules.errors) {
      allChecks.push({ id: "parser_error", label: "rules pass", passed: false, detail: err });
    }

    return {
      parserVersion: PARSER_VERSION,
      month,
      isThirteenth: thirteenth.isThirteenth,
      textSource,
      fields,
      checks: allChecks,
      ...(llm.error ? { llmError: llm.error } : {}),
    };
  } catch (err) {
    // Last line of defence: a parse can degrade, but it can never fail.
    return {
      parserVersion: PARSER_VERSION,
      month: input.month ?? null,
      isThirteenth: false,
      textSource,
      fields: allLowFields(),
      checks: [
        {
          id: "parser_error",
          label: "parser",
          passed: false,
          detail: `parser failed, manual entry required: ${errorMessage(err)}`,
        },
      ],
    };
  }
}

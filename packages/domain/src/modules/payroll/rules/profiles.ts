// The payslip profiles (rewrite plan R5g, extension point E1): how one payslip form is read, as data.
// A profile is a JSON file of `../profiles/` — its labels, columns, codes, checks, balances and the
// words of its AI prompt — and one generic reader in code (`parse/read.ts`) interprets any of them.
// No form is written in the code: a new one is a new file in the list below.
import { z } from "zod";
import firstProfile from "../profiles/it-monthly-1.json";
import { LEAVE_KINDS } from "./legacy";
import { CODE_ROLES, LINE_UNITS } from "./roles";

const text = z.string().min(1);
const span = z.tuple([z.number(), z.number()]);

/** The generic checks a profile runs, by name, with its parameters (`parse/checks.ts`). */
const check = z.discriminatedUnion("id", [
  z.object({ id: z.literal("irpef"), tolerance: z.number().int().min(0) }),
  z.object({ id: z.literal("net") }),
  z.object({ id: z.literal("body_deductions") }),
  z.object({ id: z.literal("total_deductions") }),
  z.object({ id: z.literal("substitute_tax") }),
  z.object({ id: z.literal("leave_balance"), kinds: z.array(z.enum(LEAVE_KINDS)), tolerance: z.number().int().min(0) }),
  z.object({ id: z.literal("plausibility"), ratio: z.number().positive(), window: z.number().int().positive() }),
]);

const profileSchema = z.object({
  /** The key of the person's code map for this form. */
  id: text,
  name: text,
  /** Stored on every document read with the profile: bumped when the same PDF would read differently. */
  parserVersion: text,
  country: z.string().length(2),
  language: text,
  currency: z.string().length(3),
  /** Labels the form always prints: a document with all of them is this form (`detectProfile`). */
  markers: z.array(text).min(1),
  geometry: z.object({
    /** Text at most this size is a printed label; larger text is a value. */
    labelMaxSize: z.number().positive(),
    /** How far apart two baselines may be and still be one row. */
    rowTolerance: z.number().nonnegative(),
    /** How far below a label its second line hangs. */
    labelHang: span,
    /** How far below its label row a value row sits. */
    labelAbove: span,
    /** How far below the body's header its first line starts. */
    bodyHeaderGap: z.number().nonnegative(),
  }),
  /** Where each field is printed, by label; a label printed twice is the first from the top. */
  summary: z.array(z.object({ field: text, label: text })),
  /** The leave balances, in the order the form prints them; `labels`: previous year, accrued, used, remaining. */
  balances: z.array(
    z.object({
      kind: z.enum(LEAVE_KINDS),
      labels: z.tuple([text, text, text, text]),
      /** The role of the body lines that are a use of this leave. */
      eventRole: z.enum(CODE_ROLES).optional(),
      /** The balances that may confirm a use, in order; none confirming leaves it unconfirmed. */
      confirmBy: z.array(z.enum(LEAVE_KINDS)).optional(),
      /** The balance a use counts against, when it is not its own. */
      countsAgainst: z.enum(LEAVE_KINDS).optional(),
    }),
  ),
  employer: z.object({
    rowPattern: text,
    taxCodePattern: text,
    sourceLabel: text,
    companyCodeLabel: text,
    companyCodePrefix: z.string(),
  }),
  printedOn: z.object({ pattern: text, sourceLabel: text }),
  body: z.object({
    headers: z.object({
      code: text,
      description: text,
      quantity: text,
      rate: text,
      earnings: text,
      deductions: text,
      statistical: text,
    }),
    /** The label of the row that closes the body. */
    end: text,
    codePattern: text,
    units: z.array(z.object({ pattern: text, unit: z.enum(LINE_UNITS) })),
  }),
  /** Fields no label or line of the form ever shows: `null`, never zero. */
  neverPrinted: z.array(text),
  /** The code map a person starts with (spec §7.8): a code missing here is `other`. */
  codes: z.array(z.object({ code: z.string().regex(/^\d{1,6}$/), role: z.enum(CODE_ROLES) })),
  checks: z.array(check),
  /** How many months before the payslip's own the leave it prints was used. */
  absenceLagMonths: z.number().int().min(0),
  /** What a balance snapshot says about its unit. */
  unitEvidence: text,
  /** The words of the AI prompt, by language; `{currency}` is the currency's name in that language. */
  prompt: z.record(
    z.string(),
    z.object({
      intro: text,
      rulesTitle: text,
      rules: z.array(text),
      definitionsTitle: text,
      definitions: z.array(z.object({ field: text, text })),
      fieldsTitle: text,
      textTitle: text,
    }),
  ),
});

export type PayslipProfile = z.infer<typeof profileSchema>;
export type ProfileCheck = z.infer<typeof check>;
export type ProfileBalance = PayslipProfile["balances"][number];

/** Every profile, in the order `detectProfile` tries them; the first is the default one. */
export const PAYSLIP_PROFILES: readonly PayslipProfile[] = [firstProfile].map((data) => profileSchema.parse(data));

export const DEFAULT_PROFILE = PAYSLIP_PROFILES[0];

/** A profile as data read from elsewhere (a test's fixture), checked the same way. */
export function parseProfile(data: unknown): PayslipProfile {
  return profileSchema.parse(data);
}

export function profileById(id: string): PayslipProfile | null {
  return PAYSLIP_PROFILES.find((profile) => profile.id === id) ?? null;
}

/** The profile a document was read with, from the version stored on it. */
export function profileOfVersion(version: string | null): PayslipProfile | null {
  return PAYSLIP_PROFILES.find((profile) => profile.parserVersion === version) ?? null;
}

/** Whether the reading profile has the code: «Reset» puts it back rather than removing it. */
export function isSeededCode(code: string, profileId = DEFAULT_PROFILE.id): boolean {
  return (profileById(profileId)?.codes ?? []).some((entry) => entry.code === code);
}

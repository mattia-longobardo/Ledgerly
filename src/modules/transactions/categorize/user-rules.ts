/**
 * The rules of a person (categories-and-rules.md §4): what a rule is, how it is checked, and which
 * rule decides a movement. Pure: the service beside it reads and writes, this file only answers.
 *
 * A rule is conditions, all true (§12 #2), and an action: a category — the section comes with it —
 * and, if asked, labels and a note. The first active rule that matches decides (QC5).
 */
import { z } from "zod";
import { normalise, shownText } from "./text";

/** The most rules a person may have, and the most conditions in one rule (§4.3, §4.8). */
export const RULE_LIMIT = 200;
export const MAX_CONDITIONS = 8;
/** "Text" may appear up to three times ("contains X" and "does not contain Y"); every other field once. */
export const MAX_TEXT_CONDITIONS = 3;
export const NOTE_MAX = 200;

export const TEXT_OPS = ["contains", "notContains", "equals", "startsWith"] as const;
export const COUNTERPARTY_OPS = ["contains", "equals"] as const;
export const AMOUNT_OPS = ["gt", "lt", "between", "equals"] as const;
export const DIRECTIONS = ["in", "out"] as const;
/** Where a movement comes from: a source that reads it, or a person who wrote it. */
export const RULE_SOURCES = ["bank", "manual"] as const;
export const RULE_FIELDS = [
  "text",
  "counterparty",
  "ownAccount",
  "amount",
  "direction",
  "account",
  "source",
  "currency",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

const words = z.string().trim().min(1).max(100);
/** A positive amount in cents: a number, for JSON; no amount reaches 2^53. */
const cents = z.number().int().min(0).max(1e13);

export const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("text"), op: z.enum(TEXT_OPS), value: words }),
  z.object({ field: z.literal("counterparty"), op: z.enum(COUNTERPARTY_OPS), value: words }),
  z.object({ field: z.literal("ownAccount") }),
  z
    .object({ field: z.literal("amount"), op: z.enum(AMOUNT_OPS), cents, toCents: cents.optional() })
    .refine((one) => one.op !== "between" || (one.toCents !== undefined && one.toCents >= one.cents), {
      path: ["toCents"],
    }),
  z.object({ field: z.literal("direction"), value: z.enum(DIRECTIONS) }),
  z.object({ field: z.literal("account"), accountIds: z.array(z.uuid()).min(1).max(50) }),
  z.object({ field: z.literal("source"), value: z.enum(RULE_SOURCES) }),
  z.object({ field: z.literal("currency"), value: z.string().regex(/^[A-Z]{3}$/) }),
]);
export type RuleCondition = z.infer<typeof conditionSchema>;

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    active: z.boolean().default(true),
    conditions: z.array(conditionSchema).min(1).max(MAX_CONDITIONS),
    categoryId: z.uuid(),
    labelIds: z.array(z.uuid()).max(20).default([]),
    note: z
      .string()
      .trim()
      .max(NOTE_MAX)
      .nullish()
      .transform((note) => (note ? note : null)),
  })
  .superRefine((rule, issues) => {
    for (const field of RULE_FIELDS) {
      const count = rule.conditions.filter((one) => one.field === field).length;
      if (count > (field === "text" ? MAX_TEXT_CONDITIONS : 1)) {
        issues.addIssue({ code: "custom", path: ["conditions"], message: `repeated:${field}` });
      }
    }
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** What of a movement a rule looks at. */
export interface RuleMovement {
  payee: string | null;
  note: string | null;
  rawText: string | null;
  counterparty: string | null;
  amountCents: bigint;
  currency: string;
  accountId: string;
  /** Written by a person (a manual movement, or an account no source reads). */
  manual: boolean;
}

/** What a rule needs to know beyond the movement: the person's own IBANs (compact, upper case). */
export interface RuleFacts {
  ownIbans: readonly { accountId: string; iban: string }[];
}

const squash = (text: string) => normalise(text).replace(/ /g, "");
const compactIban = (text: string) => text.replace(/[\s-]/g, "").toUpperCase();

function textMatches(op: (typeof TEXT_OPS)[number], movement: RuleMovement, needle: string): boolean {
  const wanted = normalise(needle);
  if (wanted === "") return false;
  // "contains" reads everything written about the movement; "is" and "starts with" the words a
  // person reads it by, the same text the table shows.
  if (op === "contains" || op === "notContains") {
    // Without spaces: "ACME S.r.l." is found by "acme srl" as by "acme s r l".
    const all = squash([movement.payee, movement.note, movement.rawText].filter(Boolean).join(" "));
    return all.includes(squash(needle)) === (op === "contains");
  }
  const shown = normalise(shownText(movement));
  return op === "equals" ? shown === wanted : shown.startsWith(wanted);
}

/** Whether one condition is true of the movement. */
export function conditionMatches(
  condition: RuleCondition,
  movement: RuleMovement,
  facts: RuleFacts,
): boolean {
  const size = movement.amountCents < 0n ? -movement.amountCents : movement.amountCents;
  switch (condition.field) {
    case "text":
      return textMatches(condition.op, movement, condition.value);
    case "counterparty": {
      const party = normalise(movement.counterparty ?? movement.payee ?? "");
      const wanted = normalise(condition.value);
      if (wanted === "" || party === "") return false;
      return condition.op === "equals" ? party === wanted : squash(party).includes(squash(wanted));
    }
    case "ownAccount": {
      const text = compactIban(
        [movement.payee, movement.note, movement.rawText, movement.counterparty].filter(Boolean).join(" "),
      );
      return facts.ownIbans.some((own) => own.accountId !== movement.accountId && text.includes(own.iban));
    }
    case "amount": {
      const from = BigInt(condition.cents);
      if (condition.op === "gt") return size > from;
      if (condition.op === "lt") return size < from;
      if (condition.op === "equals") return size === from;
      return size >= from && size <= BigInt(condition.toCents ?? condition.cents);
    }
    case "direction":
      return condition.value === "in" ? movement.amountCents > 0n : movement.amountCents < 0n;
    case "account":
      return condition.accountIds.includes(movement.accountId);
    case "source":
      return condition.value === "manual" ? movement.manual : !movement.manual;
    case "currency":
      return movement.currency === condition.value;
  }
}

/** Whether every condition of the rule is true of the movement. */
export function ruleMatches(
  rule: { conditions: readonly RuleCondition[] },
  movement: RuleMovement,
  facts: RuleFacts,
): boolean {
  return rule.conditions.length > 0 && rule.conditions.every((one) => conditionMatches(one, movement, facts));
}

/**
 * The rule that decides the movement: the first, in the order given, that is active and matches
 * (QC5). The rules after it are not looked at. `null` when none matches.
 */
export function firstMatch<R extends { active: boolean; conditions: readonly RuleCondition[] }>(
  rules: readonly R[],
  movement: RuleMovement,
  facts: RuleFacts,
): R | null {
  return rules.find((rule) => rule.active && ruleMatches(rule, movement, facts)) ?? null;
}

/** The reason a rule's category carries on a movement (§4.5): the code and what its sentence names. */
export function ruleReason(rule: { id: string; name: string }): {
  categoryReason: "rule";
  categoryReasonParams: Record<string, string>;
} {
  return { categoryReason: "rule", categoryReasonParams: { name: rule.name, ruleId: rule.id } };
}

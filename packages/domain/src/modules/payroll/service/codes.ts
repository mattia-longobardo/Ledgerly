import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type CodeRole, CODE_ROLES, REPLY_TEAMSYSTEM, REPLY_TEAMSYSTEM_CODES } from "../rules";
import { payrollCodeMap, payrollRawLines, payslips } from "../schema";

export type Payslip = typeof payslips.$inferSelect;
type CodeMapEntry = typeof payrollCodeMap.$inferSelect;
export type RawLineRow = typeof payrollRawLines.$inferSelect;

type PayrollErrorCode =
  | "not_found"
  | "invalid_state"
  | "invalid_value"
  | "derived_field"
  | "unconfirmed_inferred"
  | "blocking_checks"
  | "no_identity"
  | "conflict"
  | "llm_not_configured"
  | "llm_failed";

export class PayrollError extends Error {
  constructor(readonly code: PayrollErrorCode) {
    super(code);
    this.name = "PayrollError";
  }
}

// ——— The code map (spec §7.8 "Mappa dei codici") ———

/** The code map of a profile, seeded with the Reply/TeamSystem codes the first time it is needed. */
export async function codeMapOf(
  ctx: Pick<Ctx, "userId">,
  profile = REPLY_TEAMSYSTEM,
): Promise<Map<string, CodeRole>> {
  let rows = await listCodeMap(ctx, profile);
  if (rows.length === 0 && profile === REPLY_TEAMSYSTEM) {
    await getDb()
      .insert(payrollCodeMap)
      .values(REPLY_TEAMSYSTEM_CODES.map((entry) => userScoped(ctx).stamp({ profile, ...entry })))
      .onConflictDoNothing();
    rows = await listCodeMap(ctx, profile);
  }
  return new Map(rows.map((row) => [row.code, row.role]));
}

export async function listCodeMap(ctx: Pick<Ctx, "userId">, profile = REPLY_TEAMSYSTEM): Promise<CodeMapEntry[]> {
  return getDb()
    .select()
    .from(payrollCodeMap)
    .where(and(userScoped(ctx).owns(payrollCodeMap), eq(payrollCodeMap.profile, profile)))
    .orderBy(sql`length(${payrollCodeMap.code})`, asc(payrollCodeMap.code));
}

/** Sets what a code means; a code the map lacked is added. Payslips read later use it. */
export async function setCodeRole(
  ctx: Pick<Ctx, "userId">,
  input: { code: string; role: string; note?: string | null },
  profile = REPLY_TEAMSYSTEM,
): Promise<void> {
  const code = input.code.trim();
  const note = input.note?.trim() || null;
  if (!/^\d{1,6}$/.test(code) || !(CODE_ROLES as readonly string[]).includes(input.role) || (note?.length ?? 0) > 200) {
    throw new PayrollError("invalid_value");
  }
  await codeMapOf(ctx, profile);
  await getDb()
    .insert(payrollCodeMap)
    .values(userScoped(ctx).stamp({ profile, code, role: input.role as CodeRole, note }))
    .onConflictDoUpdate({
      target: [payrollCodeMap.userId, payrollCodeMap.profile, payrollCodeMap.code],
      set: { role: input.role as CodeRole, note, updatedAt: new Date() },
    });
}

/** Puts a code back to what the profile says, or removes a code the profile does not have. */
export async function resetCode(ctx: Pick<Ctx, "userId">, code: string, profile = REPLY_TEAMSYSTEM): Promise<void> {
  const seeded = REPLY_TEAMSYSTEM_CODES.find((entry) => entry.code === code);
  const where = and(
    userScoped(ctx).owns(payrollCodeMap),
    eq(payrollCodeMap.profile, profile),
    eq(payrollCodeMap.code, code),
  );
  if (seeded && profile === REPLY_TEAMSYSTEM) {
    await getDb().update(payrollCodeMap).set({ role: seeded.role, note: null }).where(where);
  } else {
    await getDb().delete(payrollCodeMap).where(where);
  }
}

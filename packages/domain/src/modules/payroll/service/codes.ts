import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type CodeRole, CODE_ROLES, DEFAULT_PROFILE, type PayslipKind, profileById } from "../rules";
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
  | "month_applied"
  | "llm_not_configured"
  | "llm_failed";

/** The rows of one kind and extra payment: the old `type` is no longer read (R5f.1). */
export function ofKind(key: { kind: PayslipKind; extraNumber: number | null }) {
  return and(
    eq(payslips.kind, key.kind),
    key.extraNumber === null ? isNull(payslips.extraNumber) : eq(payslips.extraNumber, key.extraNumber),
  );
}

/** The two unique keys of an applied month: the old one, by type, goes with the type in R5f. */
export const ACTIVE_KEYS = ["payslips_active_key_uq", "payslips_active_kind_uq"] as const;

export class PayrollError extends Error {
  constructor(readonly code: PayrollErrorCode) {
    super(code);
    this.name = "PayrollError";
  }
}

// ——— The code map (spec §7.8 "Mappa dei codici") ———

/** The code map of a profile, seeded with the profile's own codes the first time it is needed. */
export async function codeMapOf(
  ctx: Pick<Ctx, "userId">,
  profile = DEFAULT_PROFILE.id,
): Promise<Map<string, CodeRole>> {
  let rows = await listCodeMap(ctx, profile);
  const seed = profileById(profile)?.codes ?? [];
  if (rows.length === 0 && seed.length > 0) {
    await getDb()
      .insert(payrollCodeMap)
      .values(seed.map((entry) => userScoped(ctx).stamp({ profile, ...entry })))
      .onConflictDoNothing();
    rows = await listCodeMap(ctx, profile);
  }
  return new Map(rows.map((row) => [row.code, row.role]));
}

export async function listCodeMap(ctx: Pick<Ctx, "userId">, profile = DEFAULT_PROFILE.id): Promise<CodeMapEntry[]> {
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
  profile = DEFAULT_PROFILE.id,
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
export async function resetCode(ctx: Pick<Ctx, "userId">, code: string, profile = DEFAULT_PROFILE.id): Promise<void> {
  const seeded = profileById(profile)?.codes.find((entry) => entry.code === code);
  const where = and(
    userScoped(ctx).owns(payrollCodeMap),
    eq(payrollCodeMap.profile, profile),
    eq(payrollCodeMap.code, code),
  );
  if (seeded) {
    await getDb().update(payrollCodeMap).set({ role: seeded.role, note: null }).where(where);
  } else {
    await getDb().delete(payrollCodeMap).where(where);
  }
}

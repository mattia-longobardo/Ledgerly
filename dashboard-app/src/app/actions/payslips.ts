"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { PayslipExtraction, PayslipField } from "@/lib/contracts";
import * as fundsRepo from "@/lib/repo/funds";
import * as payslipsRepo from "@/lib/repo/payslips";
import { monthKeyOf } from "@/lib/time";
import { fail, parseMoney, succeed, toNumericString, type ActionResult } from "./types";

/** The fields the verification form owns; `permessi` is read-only context. */
const VERIFIABLE = [
  "gross",
  "net",
  "taxes",
  "fundContribEmployee",
  "fundContribEmployer",
  "ferieBalance",
  "rolBalance",
  "ferieTaken",
  "rolTaken",
] as const;

type VerifiableField = (typeof VERIFIABLE)[number];

const nullableMoney = z.union([z.string(), z.number()]).nullish();

const verifySchema = z.object({
  id: z.coerce.number().int(),
  gross: nullableMoney,
  net: nullableMoney,
  taxes: nullableMoney,
  fundContribEmployee: nullableMoney,
  fundContribEmployer: nullableMoney,
  ferieBalance: nullableMoney,
  rolBalance: nullableMoney,
  ferieTaken: nullableMoney,
  rolTaken: nullableMoney,
  isThirteenth: z.coerce.boolean().default(false),
});

function revalidatePayslips(id: number): void {
  revalidatePath("/");
  revalidatePath("/work");
  revalidatePath(`/work/verify/${id}`);
  revalidatePath("/finance/funds");
  revalidatePath("/finance/funds/cometa");
}

/**
 * The run the verification screen walks. Returned by confirm and reject so the
 * browser lands on the next payslip from state the server has just written,
 * rather than from whatever the page held when it was opened.
 */
interface PendingEntry {
  id: number;
  month: string;
  isThirteenth: boolean;
}

async function pendingQueue(): Promise<PendingEntry[]> {
  const rows = await payslipsRepo.pendingVerification();
  return rows.map((row) => ({ id: row.id, month: row.month, isThirteenth: row.isThirteenth }));
}

function extractionOf(raw: unknown): PayslipExtraction | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = raw as Partial<PayslipExtraction>;
  return typeof candidate.fields === "object" && candidate.fields !== null
    ? (candidate as PayslipExtraction)
    : null;
}

function extractedValue(
  extraction: PayslipExtraction | null,
  field: VerifiableField,
): number | null {
  return extraction?.fields[field as PayslipField]?.value ?? null;
}

/**
 * Confirm & commit. Everything the human touched is logged as
 * `{extracted, corrected}` — that log is the labelled dataset the parser gets
 * tuned against, which is why it is computed here from the immutable raw
 * extraction rather than trusted from the browser.
 */
export async function confirmPayslip(
  input: z.input<typeof verifySchema>,
): Promise<ActionResult<{ id: number; pending: PendingEntry[] }>> {
  await requireUser();

  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return fail("Those payslip values are not valid.");

  const existing = await payslipsRepo.payslipById(parsed.data.id);
  if (!existing) return fail("That payslip no longer exists.");

  const extraction = extractionOf(existing.rawExtraction);

  const values: Record<VerifiableField, string | null> = {
    gross: null,
    net: null,
    taxes: null,
    fundContribEmployee: null,
    fundContribEmployer: null,
    ferieBalance: null,
    rolBalance: null,
    ferieTaken: null,
    rolTaken: null,
  };
  const corrections: Record<string, { extracted: unknown; corrected: unknown }> = {};

  for (const field of VERIFIABLE) {
    const raw = parsed.data[field];
    const value = raw === null || raw === undefined || raw === "" ? null : parseMoney(raw);
    if (raw !== null && raw !== undefined && raw !== "" && value === null) {
      return fail(`"${field}" is not a number.`);
    }
    values[field] = value === null ? null : toNumericString(value);

    const extracted = extractedValue(extraction, field);
    const same =
      (extracted === null && value === null) ||
      (extracted !== null && value !== null && Math.abs(extracted - value) < 0.005);
    if (!same) corrections[field] = { extracted, corrected: value };
  }

  if (parsed.data.isThirteenth !== existing.isThirteenth) {
    corrections.isThirteenth = {
      extracted: existing.isThirteenth,
      corrected: parsed.data.isThirteenth,
    };
  }

  const row = await payslipsRepo.verify(
    existing.id,
    { ...values, isThirteenth: parsed.data.isThirteenth },
    corrections,
  );
  if (!row) return fail("The payslip could not be saved.");

  await upsertCometaDeposit(row.id, row.month, values.fundContribEmployee, values.fundContribEmployer);

  revalidatePayslips(existing.id);
  return succeed({ id: existing.id, pending: await pendingQueue() });
}

/**
 * §2 "both modes write here": a verified payslip's Cometa contributions become
 * the month's `fund_deposits` row, so the fund's total-deposited figure never
 * has to know which mode was active.
 */
async function upsertCometaDeposit(
  payslipId: number,
  month: string,
  employee: string | null,
  employer: string | null,
): Promise<void> {
  if (employee === null && employer === null) return;

  const cometa = (await fundsRepo.listFunds()).find((f) => f.slug === "cometa");
  if (!cometa) return;

  const total = (employee === null ? 0 : Number(employee)) + (employer === null ? 0 : Number(employer));
  if (!Number.isFinite(total)) return;

  await fundsRepo.upsertDeposit({
    fundId: cometa.id,
    month: monthKeyOf(month),
    amount: toNumericString(total),
    employeePart: employee,
    employerPart: employer,
    source: "payroll",
    payslipId,
  });
}

export async function rejectPayslip(
  id: number,
): Promise<ActionResult<{ pending: PendingEntry[] }>> {
  await requireUser();
  if (!Number.isInteger(id)) return fail("Unknown payslip.");

  const row = await payslipsRepo.reject(id);
  if (!row) return fail("That payslip no longer exists.");

  revalidatePayslips(id);
  return succeed({ pending: await pendingQueue() });
}

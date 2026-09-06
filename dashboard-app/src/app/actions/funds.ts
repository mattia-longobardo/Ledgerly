"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeIssue } from "@/modules/funds/application/acknowledge-issue";
import { addContribution, type AddContributionInput } from "@/modules/funds/application/add-contribution";
import { createFund, type CreateFundInput } from "@/modules/funds/application/create-fund";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "@/modules/funds/application/errors";
import type { Fund, FundContribution, FundPlan, FundSchedule, ReconciliationIssue } from "@/modules/funds/application/ports";
import { reconcileFund } from "@/modules/funds/application/reconcile-fund";
import { reverseContribution } from "@/modules/funds/application/reverse-contribution";
import { setPlan, type SetPlanInput } from "@/modules/funds/application/set-plan";
import { setSchedule, type SetScheduleInput } from "@/modules/funds/application/set-schedule";
import { updateFund } from "@/modules/funds/application/update-fund";
import { runForPrincipal } from "@/modules/funds/ui/deps";
import { parseFundMoney } from "@/modules/funds/ui/parse-fund-money";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

function required(data: FormData, key: string): string { return text(data.get(key)) ?? ""; }
function month(data: FormData, key: string): string { const value = required(data, key); return value.length === 7 ? `${value}-01` : value; }
function optionalMonth(data: FormData, key: string): string | undefined { const value = text(data.get(key)); return value ? (value.length === 7 ? `${value}-01` : value) : undefined; }
function parsedMoney(data: FormData, key: string): string | null {
  return parseFundMoney(data.get(key));
}
function mapError(error: unknown): string {
  if (error instanceof PermissionDeniedError) return "You do not have permission to change funds.";
  if (error instanceof VersionMismatchError) return "This fund changed in the meantime. Reload and try again.";
  if (error instanceof InvalidInputError || error instanceof NotFoundError) return error.message;
  return errorMessage(error);
}
function revalidateFunds(id?: string): void {
  revalidatePath("/"); revalidatePath("/finance/funds");
  if (id) revalidatePath(`/finance/funds/${id}`);
}

export async function createFundAction(data: FormData): Promise<ActionResult<Fund>> {
  const input: CreateFundInput = { slug: required(data, "slug"), name: required(data, "name"), kind: required(data, "kind") as CreateFundInput["kind"], currency: required(data, "currency"), accountId: text(data.get("accountId")) };
  try { const result = await runForPrincipal((deps, principal) => createFund(deps)(principal, input)); revalidateFunds(result.id); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function updateFundAction(data: FormData): Promise<ActionResult<Fund>> {
  const id = required(data, "id");
  const patch = { name: required(data, "name"), kind: required(data, "kind") as Fund["kind"], accountId: text(data.get("accountId")), status: required(data, "status") as Fund["status"] };
  try { const result = await runForPrincipal((deps, principal) => updateFund(deps)(principal, id, Number(required(data, "version")), patch)); revalidateFunds(id); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function setScheduleAction(data: FormData): Promise<ActionResult<FundSchedule>> {
  const fundId = required(data, "fundId"); const fee = parsedMoney(data, "feePerPosting");
  if (fee === null) return fail("Enter a valid posting fee.");
  const input: SetScheduleInput = { frequency: required(data, "frequency") as SetScheduleInput["frequency"], periodAnchorMonth: Number(required(data, "periodAnchorMonth")), postingLagMonths: Number(required(data, "postingLagMonths")), feePerPosting: fee, effectiveFrom: month(data, "effectiveFrom") };
  try { const result = await runForPrincipal((deps, principal) => setSchedule(deps)(principal, fundId, input)); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function setPlanAction(data: FormData): Promise<ActionResult<FundPlan>> {
  const fundId = required(data, "fundId"); const initialCapital = parsedMoney(data, "initialCapital"); const fixedRaw = text(data.get("fixedMonthlyAmount")); const fixedMonthlyAmount = fixedRaw === null ? null : parsedMoney(data, "fixedMonthlyAmount");
  if (initialCapital === null || (fixedRaw !== null && fixedMonthlyAmount === null)) return fail("Enter valid plan amounts.");
  const input: SetPlanInput = { effectiveFrom: month(data, "effectiveFrom"), initialCapital, fixedMonthlyAmount, note: text(data.get("note")) };
  try { const result = await runForPrincipal((deps, principal) => setPlan(deps)(principal, fundId, input)); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function addContributionAction(data: FormData): Promise<ActionResult<FundContribution>> {
  const fundId = required(data, "fundId"); const amount = parsedMoney(data, "amount");
  if (amount === null) return fail("Enter a valid contribution amount.");
  const input: AddContributionInput = { typeCode: required(data, "typeCode") as AddContributionInput["typeCode"], accrualMonth: month(data, "accrualMonth"), amount, valueDate: text(data.get("valueDate")), note: text(data.get("note")), postedMonth: optionalMonth(data, "postedMonth") };
  try { const result = await runForPrincipal((deps, principal) => addContribution(deps)(principal, fundId, input)); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function reverseContributionAction(data: FormData): Promise<ActionResult<FundContribution>> {
  const fundId = required(data, "fundId");
  try { const result = await runForPrincipal((deps, principal) => reverseContribution(deps)(principal, fundId, required(data, "contributionId"), text(data.get("note")))); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function reconcileFundAction(data: FormData): Promise<ActionResult<{ detected: unknown[]; resolved: number }>> {
  const fundId = required(data, "fundId");
  try { const result = await runForPrincipal((deps, principal) => reconcileFund(deps)(principal, fundId)); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}
export async function acknowledgeIssueAction(data: FormData): Promise<ActionResult<ReconciliationIssue>> {
  const fundId = required(data, "fundId");
  try { const result = await runForPrincipal((deps, principal) => acknowledgeIssue(deps)(principal, required(data, "issueId"))); revalidateFunds(fundId); return succeed(result); }
  catch (error) { return fail(mapError(error)); }
}

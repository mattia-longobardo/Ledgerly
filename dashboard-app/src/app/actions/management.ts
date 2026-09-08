"use server";

/**
 * Server actions for the management operations Phase 9 exposes as API but does
 * not give pages to (the reduced plan defers those to the redesign). One action
 * per use case, so a page added later only has to render a `<form>` and point
 * `action=` at the right export.
 *
 * Every action follows `app/actions/expenses.ts`: `FormData` in, `ActionResult`
 * out, errors turned into copy rather than thrown, and `revalidatePath` on the
 * pages whose data the write invalidates. `revalidatePath` on a route that does
 * not exist yet is a no-op, so the calls are written for where the pages will
 * be rather than left to be remembered later.
 */

import { revalidatePath } from "next/cache";
import type { TransactionCategory, TransactionLabel } from "@/modules/expenses/domain/transaction";
import {
  InvalidInputError as ExpensesInvalidInputError,
  NotFoundError as ExpensesNotFoundError,
} from "@/modules/expenses/application/errors";
import { createCategory } from "@/modules/expenses/application/create-category";
import { createLabel } from "@/modules/expenses/application/create-label";
import { updateCategory } from "@/modules/expenses/application/update-category";
import { updateLabel } from "@/modules/expenses/application/update-label";
import { runForPrincipal as runExpenses } from "@/modules/expenses/ui/run";
import {
  InvalidInputError as PayrollInvalidInputError,
  NotFoundError as PayrollNotFoundError,
  VersionMismatchError as PayrollVersionMismatchError,
} from "@/modules/payroll/application/errors";
import { createMappingRule } from "@/modules/payroll/application/create-mapping-rule";
import { deleteMappingRule } from "@/modules/payroll/application/delete-mapping-rule";
import { listMappingRules } from "@/modules/payroll/application/list-mapping-rules";
import { updateMappingRule } from "@/modules/payroll/application/update-mapping-rule";
import type { ManagedMappingRule, MappingTarget, PayrollComponentKind } from "@/modules/payroll/application/ports";
import { runMappingRulesForPrincipal } from "@/modules/payroll/ui/run";
import { NotFoundError as FundsNotFoundError } from "@/modules/funds/application/errors";
import { listIssues } from "@/modules/funds/application/list-issues";
import { resolveIssue } from "@/modules/funds/application/resolve-issue";
import type { ListIssuesPage, ReconciliationIssue } from "@/modules/funds/application/ports";
import { runForPrincipal as runFunds } from "@/modules/funds/ui/run";
import { InvalidInputError as IntegrationsInvalidInputError, UnknownProviderError } from "@/modules/integrations/application/errors";
import { setSyncJobEnabled } from "@/modules/integrations/application/set-sync-job-enabled";
import type { SyncJob } from "@/modules/integrations/application/ports";
import { runIntegrationsForPrincipal } from "@/modules/integrations/ui/run";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

const FINANCE_PATHS = ["/finance/expenses", "/finance/management"];

function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change this.";
  if (err instanceof PayrollVersionMismatchError) return "This changed in the meantime. Reload and try again.";
  if (err instanceof ExpensesNotFoundError || err instanceof PayrollNotFoundError || err instanceof FundsNotFoundError) {
    return "This no longer exists.";
  }
  if (
    err instanceof ExpensesInvalidInputError ||
    err instanceof PayrollInvalidInputError ||
    err instanceof IntegrationsInvalidInputError ||
    err instanceof UnknownProviderError
  ) {
    // These messages are written for a person to read (they name the provider,
    // the clashing name, the bad pattern), so they are shown as they are.
    return err.message;
  }
  return errorMessage(err);
}

function revalidate(paths: readonly string[]): void {
  for (const path of paths) revalidatePath(path);
}

/** `undefined` when the field was not submitted at all, so a patch leaves it alone. */
function optionalText(formData: FormData, name: string): string | null | undefined {
  return formData.has(name) ? text(formData.get(name)) : undefined;
}

/** An unchecked checkbox is simply absent from `FormData`, so presence is the value. */
function checkbox(formData: FormData, name: string): boolean | undefined {
  if (!formData.has(name)) return undefined;
  const raw = text(formData.get(name));
  return raw !== null && raw !== "false" && raw !== "off";
}

export async function createCategoryAction(formData: FormData): Promise<ActionResult<TransactionCategory>> {
  const name = text(formData.get("name")) ?? "";
  const kind = text(formData.get("kind"));
  try {
    const created = await runExpenses((deps, principal) =>
      createCategory(deps)(principal, {
        name,
        ...(kind ? { kind: kind as TransactionCategory["kind"] } : {}),
        color: text(formData.get("color")),
        parentId: text(formData.get("parentId")),
      }),
    );
    revalidate(FINANCE_PATHS);
    return succeed(created);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function updateCategoryAction(formData: FormData): Promise<ActionResult<TransactionCategory>> {
  const id = text(formData.get("id")) ?? "";
  try {
    const updated = await runExpenses((deps, principal) =>
      updateCategory(deps)(principal, id, {
        ...(formData.has("name") ? { name: text(formData.get("name")) ?? "" } : {}),
        ...(formData.has("color") ? { color: text(formData.get("color")) } : {}),
        ...(formData.has("parentId") ? { parentId: text(formData.get("parentId")) } : {}),
        ...(checkbox(formData, "archived") !== undefined ? { archived: checkbox(formData, "archived") } : {}),
      }),
    );
    revalidate(FINANCE_PATHS);
    return succeed(updated);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function createLabelAction(formData: FormData): Promise<ActionResult<TransactionLabel>> {
  try {
    const created = await runExpenses((deps, principal) =>
      createLabel(deps)(principal, {
        name: text(formData.get("name")) ?? "",
        color: text(formData.get("color")),
      }),
    );
    revalidate(FINANCE_PATHS);
    return succeed(created);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function updateLabelAction(formData: FormData): Promise<ActionResult<TransactionLabel>> {
  const id = text(formData.get("id")) ?? "";
  try {
    const updated = await runExpenses((deps, principal) =>
      updateLabel(deps)(principal, id, {
        ...(formData.has("name") ? { name: text(formData.get("name")) ?? "" } : {}),
        ...(formData.has("color") ? { color: text(formData.get("color")) } : {}),
      }),
    );
    revalidate(FINANCE_PATHS);
    return succeed(updated);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function listMappingRulesAction(): Promise<ActionResult<ManagedMappingRule[]>> {
  try {
    return succeed(await runMappingRulesForPrincipal((deps, principal) => listMappingRules(deps)(principal)));
  } catch (err) {
    return fail(mapError(err));
  }
}

/**
 * `target` arrives as JSON because it is a discriminated union with different
 * fields per branch — flattening it into `target.kind`/`target.fundSlug` form
 * fields would put the union's shape in two places.
 */
function parseTarget(raw: string | null): MappingTarget {
  if (!raw) return { kind: "none" };
  try {
    return JSON.parse(raw) as MappingTarget;
  } catch {
    throw new PayrollInvalidInputError("target must be a JSON object naming a kind");
  }
}

export async function createMappingRuleAction(formData: FormData): Promise<ActionResult<ManagedMappingRule>> {
  const priority = text(formData.get("priority"));
  try {
    const created = await runMappingRulesForPrincipal((deps, principal) =>
      createMappingRule(deps)(principal, {
        matchCode: text(formData.get("matchCode")),
        matchLabel: text(formData.get("matchLabel")),
        componentKind: (text(formData.get("componentKind")) ?? "info") as PayrollComponentKind,
        target: parseTarget(text(formData.get("target"))),
        ...(priority ? { priority: Number(priority) } : {}),
      }),
    );
    revalidate(["/company/payroll", "/finance/management"]);
    return succeed(created);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function updateMappingRuleAction(formData: FormData): Promise<ActionResult<ManagedMappingRule>> {
  const id = text(formData.get("id")) ?? "";
  const version = Number(text(formData.get("version")) ?? "0");
  const priority = text(formData.get("priority"));
  try {
    const updated = await runMappingRulesForPrincipal((deps, principal) =>
      updateMappingRule(deps)(principal, id, version, {
        ...(formData.has("matchCode") ? { matchCode: text(formData.get("matchCode")) } : {}),
        ...(formData.has("matchLabel") ? { matchLabel: text(formData.get("matchLabel")) } : {}),
        ...(formData.has("componentKind")
          ? { componentKind: (text(formData.get("componentKind")) ?? "info") as PayrollComponentKind }
          : {}),
        ...(formData.has("target") ? { target: parseTarget(text(formData.get("target"))) } : {}),
        ...(priority ? { priority: Number(priority) } : {}),
      }),
    );
    revalidate(["/company/payroll", "/finance/management"]);
    return succeed(updated);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function deleteMappingRuleAction(formData: FormData): Promise<ActionResult<null>> {
  const id = text(formData.get("id")) ?? "";
  try {
    await runMappingRulesForPrincipal((deps, principal) => deleteMappingRule(deps)(principal, id));
    revalidate(["/company/payroll", "/finance/management"]);
    return succeed(null);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function listIssuesAction(formData: FormData): Promise<ActionResult<ListIssuesPage>> {
  const limit = text(formData.get("limit"));
  try {
    const page = await runFunds((deps, principal) =>
      listIssues(deps)(principal, {
        ...(text(formData.get("domain")) ? { domain: text(formData.get("domain"))! } : {}),
        ...(text(formData.get("status"))
          ? { status: text(formData.get("status")) as ReconciliationIssue["status"] }
          : {}),
        ...(text(formData.get("severity"))
          ? { severity: text(formData.get("severity")) as ReconciliationIssue["severity"] }
          : {}),
        cursor: text(formData.get("cursor")),
        ...(limit ? { limit: Number(limit) } : {}),
      }),
    );
    return succeed(page);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function resolveIssueAction(formData: FormData): Promise<ActionResult<ReconciliationIssue>> {
  const id = text(formData.get("id")) ?? "";
  try {
    const issue = await runFunds((deps, principal) => resolveIssue(deps)(principal, id));
    revalidate(["/finance/funds", "/finance/management"]);
    return succeed(issue);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function setSyncJobEnabledAction(formData: FormData): Promise<ActionResult<SyncJob>> {
  const provider = text(formData.get("provider")) ?? "";
  const kind = text(formData.get("kind")) ?? "";
  const enabled = checkbox(formData, "enabled") ?? false;
  try {
    const job = await runIntegrationsForPrincipal((deps, principal) =>
      setSyncJobEnabled(deps)(principal, provider, kind, enabled),
    );
    revalidate(["/settings/integrations", "/finance/management"]);
    return succeed(job);
  } catch (err) {
    return fail(mapError(err));
  }
}

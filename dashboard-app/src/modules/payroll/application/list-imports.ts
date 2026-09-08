import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { ListImportsOptions, PayrollImport, UseCaseDeps } from "./ports";
import { NotFoundError } from "./errors";

/** Pipeline state, not money (Ruling R4-12). No page reads this for a financial figure. */
export function listImports(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListImportsOptions = {}): Promise<PayrollImport[]> => {
    assertPermission(principal, "payroll.read");
    return deps.imports.list(principal.userId, opts);
  };
}

export function getImport(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.read");
    const found = await deps.imports.get(principal.userId, id);
    // A row belonging to somebody else is "not found", never "forbidden": the
    // second answer confirms the id exists.
    if (!found) throw new NotFoundError();
    return found;
  };
}

import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { ListIssuesOptions, ListIssuesPage, UseCaseDeps } from "./ports";

/**
 * Every reconciliation issue the caller owns, across domains.
 *
 * It lives in the funds module because that is where `reconciliation_issues`
 * and its repository already are, but it is deliberately NOT scoped to
 * `domain = 'funds'`: the table is the platform's one issue list, and the
 * management view has to show whatever writes into it next without another use
 * case being added. `finance.manage` rather than `funds.read` for the same
 * reason — this is the operator's cross-domain view, not a fund's detail.
 */
export function listIssues(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListIssuesOptions = {}): Promise<ListIssuesPage> => {
    assertPermission(principal, "finance.manage");
    return deps.issues.list(principal.userId, opts);
  };
}

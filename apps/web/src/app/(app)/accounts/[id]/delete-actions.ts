// The calls of «Delete account» to `/api/v1` (rewrite plan R3): the answers of the Server Actions they
// replace, `{ ok }` or the dialog's code; what the dialog cannot name is `failed`, never a throw.
import { ACCOUNTS } from "@ledgerly/api-contract";
import { ApiError, call } from "@ledgerly/api-client";

const { removal } = ACCOUNTS;

/** The kinds of what rests on an account, as the route takes them. */
const DEPENDENT_KINDS = [
  "pocket",
  "interestRule",
  "budgetLimit",
  "subscription",
  "fund",
  "fundSource",
] as const;

function failure(error: unknown) {
  const code = error instanceof ApiError && error.status < 500 ? (error.reason ?? error.code) : "failed";
  return { ok: false as const, error: code };
}

/** What the dialog shows when it opens: what rests on the account, and where it can go. */
export async function accountDependentsAction(accountId: string) {
  try {
    return {
      ok: true as const,
      ...(await call(removal.listAccountDependents, { params: { id: accountId } })),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function moveDependentAction(input: {
  accountId: string;
  kind: string;
  id: string;
  to: string;
}) {
  const kind = DEPENDENT_KINDS.find((one) => one === input.kind);
  if (kind === undefined) return { ok: false as const, error: "failed" };
  try {
    await call(removal.moveAccountDependent, {
      params: { id: input.accountId },
      body: { kind, id: input.id, to: input.to },
    });
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAccountAction(accountId: string) {
  try {
    await call(removal.deleteAccount, { params: { id: accountId } });
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

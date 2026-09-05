/**
 * Pure and deliberately isolated: `page.tsx` transitively pulls in next-auth
 * (via `requirePrincipalOrRedirect` and, through `../_components/SettingsForms`'s
 * server actions, `@/lib/auth/require-user`), which vitest's unit
 * environment cannot resolve (`next/server`). Keeping this one helper in its
 * own file with no such imports lets it be unit-tested directly, without
 * mocking that whole import graph.
 *
 * `interest-accrual.ts`'s job detail can report a "success" run that still
 * skipped rules (Ruling P3-C44, B6) or left a post in-flight — `postFailed`
 * counts a `PostFailedError`, which is exactly the `postedAt` set /
 * `entryId` null state `reconcileInterest` surfaces as `indeterminate`
 * (Ruling P3-C39, B2). A plain success badge would hide both, so the
 * Scheduled-jobs row for this job alone reads its own `detail` shape rather
 * than only the run's status.
 */
interface InterestAccrualDetail {
  skipped?: number;
  postFailed?: number;
}

export function interestAccrualNotice(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const { skipped, postFailed } = detail as InterestAccrualDetail;
  const parts: string[] = [];
  if (typeof skipped === "number" && skipped > 0) parts.push(`${skipped} rule${skipped === 1 ? "" : "s"} skipped`);
  if (typeof postFailed === "number" && postFailed > 0) {
    parts.push(`${postFailed} post${postFailed === 1 ? "" : "s"} unconfirmed at Wallet`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

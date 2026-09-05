import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { romeDate } from "@/lib/time";
import { loadInterestRuleDetail } from "@/modules/interests/ui/load-interests";
import { RuleDetail } from "@/modules/interests/ui/RuleDetail";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interest rule" };

/** Month-to-date in Europe/Rome, matching how the rest of the app reads "this period". */
function monthStart(now: Date): string {
  return `${romeDate(now).slice(0, 7)}-01`;
}

export default async function InterestRulePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePrincipalOrRedirect();
  const { id } = await params;
  const now = new Date();
  // A real error here (a database failure, a permission edge) propagates to
  // this route's error boundary instead of being swallowed into `notFound()`
  // — `loadInterestRuleDetail` only ever returns null for a rule that
  // genuinely does not exist.
  const detail = await loadInterestRuleDetail(id, { periodStart: monthStart(now), periodEnd: romeDate(now) });
  if (!detail) notFound();

  return (
    <>
      <PageHeader
        title={`Interest rule — ${detail.rule.accountName}`}
        eyebrow={
          <Link href="/finance/interests" className="text-fg-muted transition-colors hover:text-fg">
            &larr; Interests
          </Link>
        }
      />
      <div className="max-w-lg pt-6">
        <RuleDetail
          accruals={detail.accruals}
          reconciliationStatus={detail.reconciliationStatus}
          projection={detail.projection}
          ruleInert={detail.rule.inert}
        />
      </div>
    </>
  );
}

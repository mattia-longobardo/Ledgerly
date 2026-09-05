import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadEligibleAccounts, loadInterestRules } from "@/modules/interests/ui/load-interests";
import { RuleForm } from "@/modules/interests/ui/RuleForm";
import { RulesTable } from "@/modules/interests/ui/RulesTable";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interests" };

/**
 * Wallet disconnected (`caps.features.interests` false) keeps the existing
 * "Connect Budget Makers Wallet" empty state; connected renders the rules
 * list plus its create-rule form (Ruling P3-17 — there is no separate "new
 * rule" route in the spec's page map, so the form lives here).
 */
export default async function InterestsPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.interests) {
    return (
      <>
        <PageHeader title="Interests" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect Budget Makers Wallet"
            description="Interest is accrued from a Wallet account's daily balance. Connect the integration to start tracking rules."
            action={
              <Link
                href="/settings/integrations/wallet"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const [rows, accounts] = await Promise.all([loadInterestRules(), loadEligibleAccounts()]);

  return (
    <>
      <PageHeader title="Interests" />
      <div className="flex flex-col gap-8 pt-6">
        <RulesTable rows={rows} />
        <div className="max-w-md hairline-t pt-8">
          <h2 className="text-body-sm font-medium text-fg-muted">New rule</h2>
          <div className="pt-4">
            <RuleForm accounts={accounts} />
          </div>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interests" };

/**
 * Unreachable from the navigation until Wallet is connected; this is what a
 * bookmarked URL shows in the meantime, and never a zero.
 */
export default async function InterestsPage() {
  await requirePrincipalOrRedirect();

  return (
    <>
      <PageHeader title="Interests" />
      <div className="max-w-xl pt-6">
        <EmptyState
          title="Connect Budget Makers Wallet"
          description="Interest is accrued from a Wallet account's daily balance."
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

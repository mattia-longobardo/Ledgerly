import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listAccounts } from "@ledgerly/domain/accounts";
import { takenComponents } from "@ledgerly/domain/funds";
import { FUND_TEMPLATES } from "@ledgerly/domain/funds";
import { FundWizard } from "@/modules/funds/ui/fund-wizard";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { today } from "@ledgerly/domain/shared/dates";
import { Card } from "@ledgerly/ui/card";
import { Page } from "@/ui/shell/page";
import { Skeleton } from "@ledgerly/ui/skeleton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("funds.wizard");
  return { title: t("title") };
}

/**
 * "Add pension fund" (docs/design/rewrite-plan/ux/n6-pension-fund.md §3): a page of its own, four
 * steps of one form. The step is in the address and read by the form itself, so that the browser's
 * Back goes to the step before without a round trip that would lose what was typed. Nothing is
 * written before "Create fund".
 */
export default async function NewFundPage() {
  const ctx = await requireSession();
  const t = await getTranslations("funds");
  return (
    <Page title={t("wizard.title")} parent={{ href: "/funds", label: t("title") }}>
      <Suspense fallback={<WizardSkeleton />}>
        <Wizard ctx={ctx} />
      </Suspense>
    </Page>
  );
}

async function Wizard({ ctx }: { ctx: Ctx }) {
  const [accounts, taken] = await Promise.all([listAccounts(ctx), takenComponents(ctx)]);
  return (
    <FundWizard
      accounts={accounts.map((account) => ({ id: account.id, name: account.name }))}
      taken={Object.fromEntries(taken)}
      // The Payroll module is active for every user until release R5a (modules per user): the
      // payslip question is always there. From R5a this reads the user's own modules.
      payrollAvailable={true}
      todayOn={today(ctx.timeZone)}
      currency={ctx.displayCurrency}
      templates={FUND_TEMPLATES}
      format={ctx.numberFormat}
      locale={ctx.locale}
    />
  );
}

/** The shape of the procedure while it reads (§3.6): the steps and a card with four rows. */
function WizardSkeleton() {
  return (
    <div data-testid="fund-wizard-loading" className="flex w-full flex-col gap-4">
      <Skeleton className="h-6 w-72 max-w-full" />
      <Card className="flex flex-col gap-4">
        <Skeleton className="h-6 w-32" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </Card>
    </div>
  );
}

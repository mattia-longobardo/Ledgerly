"use client";

// "Add pension fund", read from `/api/v1` (rewrite plan R3): the templates and the payslip components
// other funds take come from `GET /funds/setup`, the accounts from `GET /accounts`. Nothing is written
// before "Create fund".
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { funds as fundRoutes } from "@ledgerly/api-contract/funds";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Skeleton } from "@ledgerly/ui/skeleton";
import { FundWizard, useSay } from "@/modules/funds/client";

export function NewFundScreen() {
  const setup = useApi(fundRoutes.getFundSetup, {});
  const open = useApi(accountRoutes.listAccounts, {});
  const say = useSay();
  if (setup.data === undefined || open.data === undefined || say.data === undefined) {
    // A refusal says so and offers to read again; anything else is still being read.
    if (setup.error) return <Loaded state={setup}>{() => null}</Loaded>;
    if (open.error) return <Loaded state={open}>{() => null}</Loaded>;
    if (say.error) return <Loaded state={say}>{() => null}</Loaded>;
    return <WizardSkeleton />;
  }
  const words = say.data;
  return (
    <FundWizard
      accounts={open.data.accounts.map((account) => ({ id: account.id, name: account.name }))}
      taken={Object.fromEntries(setup.data.taken.map((one) => [one.component, one.fund]))}
      // The Payroll module is active for every user until release R5a (modules per user): the
      // payslip question is always there. From R5a this reads the user's own modules.
      payrollAvailable={true}
      todayOn={words.todayOn}
      currency={words.currency}
      templates={setup.data.templates}
      format={words.format}
      locale={words.locale}
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

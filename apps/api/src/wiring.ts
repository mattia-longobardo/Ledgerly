// The wiring of the domain's ports (10-modularity.md §10.3: «il collegamento è in apps/api e
// apps/worker»): a port is declared by the module that uses it and realised by the module above it,
// and only an application knows both. Every process calls it once, before any request, job or
// test: the web server (`instrumentation.ts`), the worker, the test projects and the scripts.
import { wireAccounts } from "@ledgerly/domain/accounts";
import { wireInterests } from "@ledgerly/domain/interests";
import { managedAccountsOfInvestments } from "@ledgerly/domain/investments";
import { ledgerPosting } from "@ledgerly/domain/platform/integrations/source";
import { movementsOfAccounts } from "@ledgerly/domain/transactions";

export function wireDomain(): void {
  wireAccounts({ movements: movementsOfAccounts, managed: managedAccountsOfInvestments });
  wireInterests({ posting: ledgerPosting });
}

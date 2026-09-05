import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { listGroups } from "@/modules/accounts/application/groups";
import { listAccounts } from "@/modules/accounts/application/list-accounts";
import type { AccountTableRow } from "@/modules/accounts/ui/AccountsTable";
import { AccountsTable } from "@/modules/accounts/ui/AccountsTable";
import { AccountsToolbar } from "@/modules/accounts/ui/AccountsToolbar";
import { runForPrincipal } from "@/modules/accounts/ui/deps";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { FinanceTabs } from "../_components/FinanceTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requirePrincipalOrRedirect();

  const { items, groups } = await runForPrincipal(async (deps, principal) => {
    const [items, groups] = await Promise.all([
      listAccounts(deps)(principal),
      listGroups(deps)(principal),
    ]);
    return { items, groups };
  });

  const groupNameById = new Map(groups.map((g) => [g.id, g.name] as const));
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));

  const rows: AccountTableRow[] = items.map((item) => ({
    id: item.account.id,
    name: item.account.name,
    type: item.account.type,
    currency: item.account.currency,
    origin: item.account.origin,
    status: item.account.status,
    provider: item.account.provider,
    groupName: item.account.groupId
      ? (groupNameById.get(item.account.groupId) ?? null)
      : null,
    balance: item.latest ? item.latest.balance : null,
    capturedAt: item.latest ? item.latest.capturedAt.toISOString() : null,
    trend: item.trend.map((p) => p.value),
    stale: item.stale,
    unavailableSince:
      item.account.status === "unavailable"
        ? item.account.updatedAt.toISOString()
        : null,
  }));

  return (
    <>
      <PageHeader
        title="Accounts"
        segmented={<FinanceTabs />}
        action={
          rows.length > 0 ? (
            <AccountsToolbar groups={groupOptions} variant="header" />
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <div className="max-w-xl pt-6">
          <EmptyState
            title="No accounts yet"
            description="Add one by hand, or connect Budget Makers Wallet to bring in what it already tracks."
            action={<AccountsToolbar groups={groupOptions} variant="empty" />}
          />
        </div>
      ) : (
        <PageGrid className="pt-5">
          <Panel span={12} ariaLabel="Accounts">
            <AccountsTable rows={rows} />
          </Panel>
        </PageGrid>
      )}
    </>
  );
}

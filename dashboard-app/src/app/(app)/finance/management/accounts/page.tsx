import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { listGroups } from "@/modules/accounts/application/groups";
import { listAccounts } from "@/modules/accounts/application/list-accounts";
import { runForPrincipal } from "@/modules/accounts/ui/deps";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { ArchivedAccountsList } from "./_components/ArchivedAccountsList";
import { GroupsManager } from "./_components/GroupsManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts management" };

export default async function AccountsManagementPage() {
  await requirePrincipalOrRedirect();

  const { groups, archived } = await runForPrincipal(
    async (deps, principal) => {
      const [groups, items] = await Promise.all([
        listGroups(deps)(principal),
        listAccounts(deps)(principal, { includeArchived: true }),
      ]);
      return {
        groups,
        archived: items.filter((i) => i.account.status === "archived"),
      };
    },
  );

  return (
    <>
      <PageHeader
        title="Accounts management"
        eyebrow={
          <Link
            href="/finance/management"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            &larr; Management
          </Link>
        }
      />

      <PageGrid className="pt-5">
        <Panel span={12} bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Groups"
            description="Organise accounts into groups, e.g. by bank or by owner. Renaming or deleting a group never touches the accounts inside it."
          >
            <GroupsManager
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            />
          </SettingsSection>

          <SettingsSection
            title="Archived accounts"
            description="Accounts archived because they were deleted while still linked to a provider, or because deleting them would have discarded referenced history. Restoring one makes it active again."
          >
            <ArchivedAccountsList
              accounts={archived.map((i) => ({
                id: i.account.id,
                version: i.account.version,
                name: i.account.name,
                type: i.account.type,
                origin: i.account.origin,
                balance: i.latest ? i.latest.balance : null,
              }))}
            />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

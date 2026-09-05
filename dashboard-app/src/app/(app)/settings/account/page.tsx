import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { db } from "@/lib/db";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { loadProfile } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  const profile = await loadProfile(db, principal);
  const permissions = [...principal.permissions].sort();

  return (
    <>
      <PageHeader title="Account" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Account" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Organization">
            <dl className="hairline-t">
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Name</dt>
                <dd className="shrink-0 text-body text-fg">{profile.organizationName}</dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Your user id</dt>
                <dd className="num shrink-0 text-caption text-fg-muted">{principal.userId}</dd>
              </div>
            </dl>
          </SettingsSection>

          <SettingsSection
            title="Your roles"
            description="Roles decide what you may do; permissions are what they expand to."
          >
            <p className="text-body text-fg">{profile.roles.join(", ")}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <li
                  key={permission}
                  className="num rounded-xs bg-surface-hover px-1.5 py-0.5 text-caption text-fg-muted"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </SettingsSection>

          <SettingsSection title="Your data">
            <EmptyState
              title="Export and deletion are not available yet"
              description="A full JSON export with the original documents, and account deletion, arrive with the security phase."
            />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

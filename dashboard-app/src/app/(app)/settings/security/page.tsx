import { headers } from "next/headers";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { describeCurrentSession } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

/**
 * One session, honestly labelled (Ruling P2-8). Auth.js still issues JWT
 * sessions, so there is no table to list from — inventing rows here would be
 * worse than showing the one session this request can actually see.
 */
export default async function SecuritySettingsPage() {
  await requirePrincipalOrRedirect();
  const session = describeCurrentSession(await headers());

  return (
    <>
      <PageHeader title="Security" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Security" bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Sessions"
            footnote="This device is the only session this release can see. Listing and revoking every session, two-factor authentication and personal access tokens arrive with database sessions."
          >
            <ul className="hairline-t">
              <li className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{session.userAgent}</span>
                  <span className="num block text-caption text-fg-muted">
                    {session.ip ?? "Address unknown"}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-positive">Current session</span>
              </li>
            </ul>
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

import { notFound } from "next/navigation";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import { ConnectForm } from "@/modules/integrations/ui/ConnectForm";
import { ConnectionActions } from "@/modules/integrations/ui/ConnectionActions";
import { DisconnectForm } from "@/modules/integrations/ui/DisconnectForm";
import { SyncRunsTable } from "@/modules/integrations/ui/SyncRunsTable";
import { loadIntegration } from "@/modules/integrations/ui/load-integrations";
import { STATUS_LABEL, STATUS_TONE } from "@/modules/integrations/ui/styles";

export const dynamic = "force-dynamic";

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const summary = await loadIntegration(provider);
  // No adapter under that code: the page does not exist, rather than existing
  // and being empty.
  if (!summary) notFound();

  const connection = summary.connection;
  const status = connection?.status ?? "disconnected";

  return (
    <>
      <PageHeader title={summary.label} />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Connection" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Status">
            <dl className="hairline-t">
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">State</dt>
                <dd className={cn("shrink-0 text-body", STATUS_TONE[status])}>{STATUS_LABEL[status]}</dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Last test</dt>
                <dd className="shrink-0">
                  <StaleBadge capturedAt={connection?.lastTestAt ?? null} stale={!connection?.lastTestAt} />
                </dd>
              </div>
              <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">Last sync</dt>
                <dd className="shrink-0">
                  <StaleBadge capturedAt={connection?.lastSyncAt ?? null} stale={!connection?.lastSyncAt} />
                </dd>
              </div>
            </dl>
            {connection?.lastError && (
              <ErrorInline className="mt-3" message={connection.lastError} />
            )}
          </SettingsSection>

          <SettingsSection
            title="Credentials"
            footnote="Stored encrypted and never shown again. Submitting replaces what is stored."
          >
            <ConnectForm
              provider={summary.provider}
              fields={summary.credentialFields}
              connected={connection !== null}
            />
          </SettingsSection>

          {connection && (
            <>
              <SettingsSection title="Actions">
                <ConnectionActions provider={summary.provider} />
              </SettingsSection>
              <SettingsSection title="Disconnect">
                <DisconnectForm provider={summary.provider} current={connection.disconnectPolicy} />
              </SettingsSection>
            </>
          )}
        </Panel>

        <Panel span={6} ariaLabel="Recent syncs" bodyClassName="flex flex-col gap-10">
          <SettingsSection title="Recent syncs">
            <SyncRunsTable runs={summary.recentRuns} />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

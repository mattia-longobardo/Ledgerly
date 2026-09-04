import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { IntegrationsList } from "@/modules/integrations/ui/IntegrationsList";
import { loadIntegrations } from "@/modules/integrations/ui/load-integrations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const items = await loadIntegrations();
  return (
    <>
      <PageHeader title="Integrations" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Integrations" bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Providers"
            description="Credentials are encrypted at rest and never shown again after you enter them."
          >
            <IntegrationsList items={items} />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { identityProviderUrl } from "@ledgerly/domain/platform/auth";
import { requireAdmin } from "@/platform/auth/session";
import { lastExport } from "@/platform/export/jobs";
import { NEXT_VERSION } from "@/platform/next-version";
import { SettingsSection } from "@ledgerly/ui/section";
import { DiagnosticsCard } from "./diagnostics-card";
import { ServerScreen } from "./server-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("server") };
}

/**
 * Admin › Server (spec §7.10). The screen reads the settings and the jobs from `/api/v1/server`. The
 * server still draws the plugins' diagnostics and tells the screen the environment's identity
 * provider, the Next.js version and the size of the last export, until the contract carries them.
 */
export default async function SettingsServerPage() {
  const ctx = await requireAdmin();
  const [text, exported] = await Promise.all([getTranslations("settings.diagnostics"), lastExport()]);
  return (
    <ServerScreen
      facts={{
        environmentOrigin: identityProviderUrl()?.origin ?? null,
        nextVersion: NEXT_VERSION,
        lastExport: exported && { users: exported.users, bytes: exported.bytes },
      }}
      diagnostics={
        <SettingsSection title={text("title")} description={text("description")} padded={false}>
          <DiagnosticsCard ctx={ctx} />
        </SettingsSection>
      }
    />
  );
}

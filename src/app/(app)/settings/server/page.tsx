import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { llmFallbackView } from "@/platform/settings/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { LlmCard } from "./llm-card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("server") };
}

/** Admin › Server (spec §7.10). F5 brings its OpenAI fallback; F8 the rest of the page. */
export default async function SettingsServerPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations("settings.llm");
  const current = await llmFallbackView(ctx);
  return (
    <SettingsGrid>
      <SettingsSection title={t("title")} description={t("description")}>
        <LlmCard current={current && { model: current.model, keyHint: current.keyHint }} />
      </SettingsSection>
    </SettingsGrid>
  );
}

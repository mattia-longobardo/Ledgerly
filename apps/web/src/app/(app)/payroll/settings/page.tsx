import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { PayrollSettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payroll");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/** Payroll › Settings reads its data from `/api/v1` (rewrite plan R3); the session says only the role. */
export default async function PayrollSettingsPage() {
  const ctx = await requireSession();
  return <PayrollSettingsScreen admin={ctx.role === "admin"} />;
}

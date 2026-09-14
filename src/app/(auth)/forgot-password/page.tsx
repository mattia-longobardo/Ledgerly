import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.forgot"))("title") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ForgotForm />
    </AuthCard>
  );
}

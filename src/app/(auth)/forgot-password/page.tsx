import { getTranslations } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ForgotForm />
    </AuthCard>
  );
}

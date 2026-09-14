import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { identityProviderUrl } from "@/platform/auth/provider";
import { BrandMark } from "@/ui/shell/brand";

export async function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("auth");
  const common = await getTranslations("common");
  const host = identityProviderUrl()?.host ?? "";
  return (
    <div className="flex w-[360px] max-w-full animate-in flex-col gap-5 rounded-modal border border-border bg-card p-8">
      <div className="flex items-center gap-2.5">
        <BrandMark size={28} />
        <span className="text-lg font-semibold">{common("product")}</span>
      </div>
      <div>
        <h1 className="text-title leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 text-muted">{description}</p>}
      </div>
      {children}
      <div className="flex justify-between text-sm text-faint">
        <span>{host}</span>
        <span>{t("version")}</span>
      </div>
    </div>
  );
}

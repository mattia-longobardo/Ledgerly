import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import packageJson from "../../../package.json";
import { identityProviderUrl } from "@/platform/auth/provider";
import { BrandLockup } from "@/ui/shell/brand";

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
      <BrandLockup name={common("product")} />
      <div>
        <h1 className="text-title leading-[1.2] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 text-muted">{description}</p>}
      </div>
      {children}
      <div className="flex justify-between text-sm text-faint">
        <span>{host}</span>
        <span>{t("version", { version: packageJson.version })}</span>
      </div>
      <nav aria-label={t("legal")} className="flex gap-4 text-sm text-faint">
        {(["privacy", "terms"] as const).map((document) => (
          <Link
            key={document}
            className="inline-flex min-h-6 items-center underline underline-offset-2 hover:text-fg"
            href={`/${document}`}
          >
            {t(document)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

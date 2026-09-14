import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/ui/button";
import { EmptyState } from "@/ui/states";

/** Unknown pages, and admin-only pages seen by a user (they answer 404 so they stay undisclosed). */
export default function NotFound() {
  const t = useTranslations("errors.notFound");
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="w-[480px] max-w-full">
        <EmptyState
          icon={<Compass aria-hidden className="size-[18px]" />}
          title={t("title")}
          description={t("description")}
          actions={
            <ButtonLink href="/" variant="primary">
              {t("cta")}
            </ButtonLink>
          }
        />
      </div>
    </main>
  );
}

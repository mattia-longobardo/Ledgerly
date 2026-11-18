"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/ui/states";

/**
 * Funds could not be read (docs/design/rewrite-plan/ux/n6-pension-fund.md §10.3): the pages of the
 * section keep the app's shell and say so, with a way to try again. Never the error's own message.
 */
export default function FundsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("funds");
  const generic = useTranslations("errors.generic");
  const common = useTranslations("common");
  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-col p-6 max-md:p-4">
      <ErrorState
        title={t("errors.load")}
        description={generic("description")}
        onRetry={reset}
        retryLabel={common("retry")}
      />
    </main>
  );
}

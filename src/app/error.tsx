"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/ui/states";

/** An unexpected error below the root layout: generic copy only, never the error's own message. */
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors.generic");
  const common = useTranslations("common");
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="w-[480px] max-w-full">
        <ErrorState
          title={t("title")}
          description={t("description")}
          onRetry={reset}
          retryLabel={common("retry")}
        />
      </div>
    </main>
  );
}

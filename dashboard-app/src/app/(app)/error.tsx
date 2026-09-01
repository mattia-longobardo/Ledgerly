"use client";

import { useEffect } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="px-4 pt-6">
      <ErrorInline
        message="This page could not be loaded."
        detail={error.digest ? `Reference ${error.digest}` : error.message}
        onRetry={reset}
      />
    </main>
  );
}

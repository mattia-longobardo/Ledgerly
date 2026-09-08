"use client";

import { useEffect } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";

export default function CompanyError({
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
    <div className="max-w-xl pt-6">
      <ErrorInline
        message="Company could not be loaded."
        detail={error.digest ? `Reference ${error.digest}` : error.message}
        onRetry={reset}
      />
    </div>
  );
}

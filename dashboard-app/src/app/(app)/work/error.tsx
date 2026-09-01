"use client";

import { useEffect } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";

export default function WorkError({
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
        message="Work could not be loaded."
        detail={error.digest ? `Reference ${error.digest}` : error.message}
        onRetry={reset}
      />
    </div>
  );
}

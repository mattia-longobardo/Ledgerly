"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { syncIntegrationAction, testIntegrationAction } from "@/app/actions/integrations";
import { SECONDARY } from "./styles";

export function ConnectionActions({ provider }: { provider: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: "test" | "sync") {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      const result = action === "test" ? await testIntegrationAction(data) : await syncIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToast(
        "message" in result.data
          ? result.data.message
          : `Sync finished: ${result.data.kind} (${result.data.status}).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run("test")} className={SECONDARY}>
          Test connection
        </button>
        <button type="button" disabled={pending} onClick={() => run("sync")} className={SECONDARY}>
          Sync now
        </button>
      </div>
      <Toast
        open={toast !== null}
        message={toast ?? ""}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}

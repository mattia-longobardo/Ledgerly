"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { renewBankAccessAction, retryBankReadingAction } from "./calls";

/** "Try again now" on the outcome of a first reading that failed (ux/n1-plugin-bank.md §6.6). */
export function RetryReading({ connectionId }: { connectionId: string }) {
  const t = useTranslations("banks.connect");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="primary"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await retryBankReadingAction(connectionId);
          } finally {
            // The page reads the outcome again: it says what this reading did.
            router.refresh();
          }
        })
      }
    >
      {pending ? t("done.retrying") : t("done.retryNow")}
    </Button>
  );
}

/** "Continue on the bank's site" for a renewal (§6.7): no bank to choose, the access starts at once. */
export function RenewAccess({ connectionId, bank }: { connectionId: string; bank: string }) {
  const t = useTranslations("banks.connect");
  const [failed, setFailed] = useState(false);
  const [opening, startOpening] = useTransition();

  return (
    <>
      {failed && (
        <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
          {t("return.unreachable")}
        </p>
      )}
      <Button
        variant="primary"
        disabled={opening}
        onClick={() => {
          setFailed(false);
          startOpening(async () => {
            try {
              const result = await renewBankAccessAction(connectionId);
              if (result.ok) {
                window.location.assign(result.url);
                return;
              }
              setFailed(true);
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        {opening ? t("bank.opening") : t("bank.continueTo", { bank })}
      </Button>
    </>
  );
}

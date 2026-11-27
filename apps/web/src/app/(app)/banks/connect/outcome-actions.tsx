"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { useRefusalText } from "../../settings/plugins/connection-refusal";
import { isBankPage } from "./bank-page";
import { renewBankAccessAction, retryBankReadingAction } from "./calls";

/**
 * "Try again now" on the outcome of a first reading that failed (ux/n1-plugin-bank.md §6.6). A reading
 * refused (`409` with its `reason`) is said in place: nothing ran, so the page is not read again.
 */
export function RetryReading({ connectionId, bank }: { connectionId: string; bank: string }) {
  const t = useTranslations("banks.connect");
  const refusalText = useRefusalText();
  const router = useRouter();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {refusal !== null && (
        <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
          {refusal}
        </p>
      )}
      <Button
        variant="primary"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setRefusal(null);
          startTransition(async () => {
            const result = await retryBankReadingAction(connectionId);
            // The page reads the outcome again: it says what this reading did.
            if (result.ok) return router.refresh();
            setRefusal(
              result.error === "busy"
                ? t("done.readingBusy")
                : refusalText(result.error, { name: bank, provider: bank }),
            );
          });
        }}
      >
        {pending ? t("done.retrying") : t("done.retryNow")}
      </Button>
    </>
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
              if (result.ok && isBankPage(result.url)) {
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

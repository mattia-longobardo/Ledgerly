"use client";

// The manual movements of an account «a mano» dated before its opening (PERS-678): the balance leaves
// them out, because the opening holds every earlier day (decision 12). The banner says so, and on a
// click only «Move the opening» dates the opening the day before the first of them.
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { views } from "@ledgerly/api-contract/accounts";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatDate } from "@ledgerly/format/format";
import { Banner } from "@ledgerly/ui/banner";
import { Button } from "@ledgerly/ui/button";
import { notify } from "@ledgerly/ui/toast";
import { moveOpeningAction } from "../calls";
import type { CardFormat } from "./net-worth-card";

type BeforeOpening = NonNullable<RouteOutput<typeof views.getAccountContext>["beforeOpening"]>;

export function BeforeOpeningBanner({
  accountId,
  before,
  format,
}: {
  accountId: string;
  before: BeforeOpening | null;
  format: CardFormat;
}) {
  const text = useTranslations("accounts.beforeOpening");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  if (before === null) return null;
  const day = (civil: string) => formatDate(civil, "long", format.locale);
  const { opening } = before;

  function onMove() {
    if (opening === null || before === null) return;
    startTransition(async () => {
      const result = await moveOpeningAction(accountId, opening, before.moveTo).catch(() => null);
      setFailed(result?.ok ? null : result?.error === "balance_exists" ? "taken" : "failed");
      if (result?.ok) notify(text("moved", { date: day(before.moveTo) }));
    });
  }

  return (
    <Banner
      tone="warn"
      title={text("title", { count: before.count })}
      testId="account-before-opening"
      action={
        opening && (
          <Button variant="primary" size="sm" onClick={onMove} disabled={pending}>
            {text("move", { date: day(before.moveTo) })}
          </Button>
        )
      }
    >
      {text("body", {
        count: before.count,
        first: day(before.first),
        opening: day(before.openingOn),
      })}
      {failed && (
        <p role="alert" className="mt-1 text-neg">
          {failed === "taken" ? text("taken", { date: day(before.moveTo) }) : text("failed")}
        </p>
      )}
    </Banner>
  );
}

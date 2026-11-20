"use client";

import { createDefaultGroups } from "../category-calls";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { type DefaultGroupView, DefaultGroupsForm } from "./default-groups-form";

/** How often the page is read again while the categories are being worked out, and for how long. */
const POLL_MS = 5_000;
const GIVE_UP_MS = 120_000;

/**
 * "Ledgerly is looking for a category…" (ux/n3-categories-manual.md §8.4): the page is read again
 * every five seconds while a pass of the cascade runs, for two minutes at most. Reading again
 * moves no focus; after two minutes the card says the person can come back later.
 */
export function PreparingCard({ count }: { count: number }) {
  const t = useTranslations("expenses.review.guide");
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (slow) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= GIVE_UP_MS) setSlow(true);
      else router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [router, slow]);

  return (
    <Card className="flex flex-col gap-2">
      <div role="status" className="flex flex-col gap-2">
        {slow ? (
          <p>{t("preparing.slow")}</p>
        ) : (
          <>
            <p className="font-medium">{t("preparing.title", { count })}</p>
            <ProgressBar value={0} label={t("preparing.title", { count })} dashed />
            <p className="text-sm text-muted">{t("preparing.hint")}</p>
          </>
        )}
      </div>
      {slow && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            onClick={() => {
              setSlow(false);
              router.refresh();
            }}
          >
            {t("preparing.retry")}
          </Button>
          <ButtonLink size="sm" variant="primary" href={"/expenses" as Route}>
            {t("preparing.toExpenses")}
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

/**
 * The first step of the guided review, for a person with no category: the default groups. Creating
 * them, or "Not now", leads to the step of the categories.
 */
export function GroupsStep({
  groups,
  next,
}: {
  groups: readonly DefaultGroupView[];
  /** Where the step of the categories is. */
  next: string;
}) {
  const router = useRouter();
  const go = () => {
    router.push(next as Route);
    router.refresh();
  };
  return (
    <Card>
      <DefaultGroupsForm
        groups={groups}
        onCreate={async (keys) => {
          const result = await createDefaultGroups(keys);
          return result.ok ? result.count : null;
        }}
        onLater={go}
        onCreated={go}
      />
    </Card>
  );
}

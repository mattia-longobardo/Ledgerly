"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { notify } from "@/ui/toast";
import { resumeSourceAccountAction } from "./deactivate-actions";

/**
 * The end of a source's "Accounts" section (plugin-settings.md §2.2, §3.4): the accounts deleted
 * here, which the source no longer brings, each with "Bring back". Nothing when there are none.
 */
export function DeletedAccounts({
  slug,
  rows,
}: {
  slug: string;
  rows: readonly { externalId: string; name: string | null }[];
}) {
  const t = useTranslations("settings.plugin");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return null;

  function resume(externalId: string, name: string) {
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await resumeSourceAccountAction(slug, externalId);
        if (!result.ok) {
          setFailed(true);
          return;
        }
        if (result.href !== null) router.push(result.href as Route);
        else notify(t("accounts.resumed", { name }));
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="border-t border-border" data-testid="deleted-accounts">
      <p className="px-4 pt-3 text-sm font-semibold text-muted">{t("accounts.deleted")}</p>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const name = row.name ?? t("accounts.unnamed");
          return (
            <li
              key={row.externalId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="min-w-0 break-words">{name}</span>
              <Button
                size="sm"
                disabled={pending}
                aria-label={t("accounts.resumeFor", { name })}
                onClick={() => resume(row.externalId, name)}
              >
                {t("accounts.resume")}
              </Button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="px-4 pb-3 text-sm text-neg">
          {t("accounts.resumeFailed")}
        </p>
      )}
    </div>
  );
}

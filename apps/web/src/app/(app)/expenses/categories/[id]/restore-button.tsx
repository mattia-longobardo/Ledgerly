"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { categories as categoryRoutes } from "@ledgerly/api-contract/settings";
import { call } from "@ledgerly/api-client";
import { Button } from "@ledgerly/ui/button";
import { invalidate } from "@ledgerly/ui/data";
import { notify } from "@ledgerly/ui/toast";

/** "Restore" on the page of an archived category (categories-and-rules.md §6). */
export function RestoreButton({ id }: { id: string }) {
  const t = useTranslations("settings.categories");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await call(categoryRoutes.restoreCategories, { body: { ids: [id] } });
            invalidate(categoryRoutes.listCategories);
            notify(t("restoredToast"), "success");
          } catch {
            notify(t("errors.failed"), "error");
          }
        })
      }
    >
      {t("restore")}
    </Button>
  );
}

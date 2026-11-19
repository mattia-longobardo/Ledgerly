"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { notify } from "@ledgerly/ui/toast";
import { restoreCategoryAction } from "../../../settings/categories/actions";

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
          const result = await restoreCategoryAction(id);
          notify(result.ok ? t("restoredToast") : t("errors.failed"), result.ok ? "success" : "error");
        })
      }
    >
      {t("restore")}
    </Button>
  );
}

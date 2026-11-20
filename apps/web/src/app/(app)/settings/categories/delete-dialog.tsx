"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { deleteCategory } from "@/modules/transactions";

/**
 * "Delete" of a category for good, here and on Wallet (owner, 2026-09-21), from the page of the
 * categories: the dialog says everything it takes before it takes it, and each of the two
 * stories — here and on Wallet — ends in a toast of its own.
 */
export function DeleteCategoryDialog({
  category,
  subCategories,
  onClose,
}: {
  category: { id: string; name: string; usage: number } | null;
  /** How many sub-categories go with it. */
  subCategories: number;
  onClose: () => void;
}) {
  const t = useTranslations("settings.categories");
  const [pending, startTransition] = useTransition();

  function onDelete(id: string, name: string) {
    startTransition(async () => {
      const result = await deleteCategory(id);
      onClose();
      if (!result.ok) {
        notify(t("errors.failed"), "error");
        return;
      }
      notify(t("deletedToast", { name, count: result.uncategorised }));
      const wallet = result.external;
      if (wallet.state === "deleted") notify(t("wallet.deleted", { count: wallet.count }));
      if (wallet.state === "refused") notify(t("wallet.refused", { reason: wallet.reasons[0] }), "error");
      if (wallet.state === "failed") notify(t("wallet.failed", { reason: wallet.reason }), "error");
    });
  }

  return (
    <Modal
      open={category !== null}
      onOpenChange={(next) => !next && onClose()}
      title={t("deleteTitle")}
      description={category ? t("deleteWarning", { name: category.name }) : undefined}
      width={460}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            aria-busy={pending}
            onClick={() => category && onDelete(category.id, category.name)}
          >
            {t("delete")}
          </Button>
        </>
      }
    >
      {category && (
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted">
          <li>{t("deleteMovements", { count: category.usage })}</li>
          <li>{t("deleteBudgets")}</li>
          {subCategories > 0 && <li>{t("deleteChildren")}</li>}
          <li className="font-medium text-neg">{t("deleteWallet")}</li>
        </ul>
      )}
    </Modal>
  );
}

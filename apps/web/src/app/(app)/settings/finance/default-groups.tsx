"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDefaultGroups } from "@/modules/transactions";
import { defaultGroupViews, DefaultGroupsForm } from "@/modules/transactions/ui/default-groups-form";
import type { UiLocale } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";

/**
 * "Use the default groups", for a person with no category who connects no bank
 * (ux/n3-categories-manual.md §7.1): the same form as the guided review, in a dialog.
 */
export function DefaultGroupsButton({ locale }: { locale: UiLocale }) {
  const t = useTranslations("settings.categories.defaults");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("open")}</Button>
      <Modal open={open} onOpenChange={setOpen} title={t("open")} width={520}>
        <DefaultGroupsForm
          groups={defaultGroupViews(locale)}
          onCreate={async (keys) => {
            const result = await createDefaultGroups(keys);
            return result.ok ? result.count : null;
          }}
          onCreated={(count) => {
            setOpen(false);
            notify(t("created", { count }));
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}

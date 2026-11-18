"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type DefaultGroupView, DefaultGroupsForm } from "@/modules/transactions/ui/default-groups-form";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";

/**
 * "Use the default groups", for a person with no category who connects no bank
 * (ux/n3-categories-manual.md §7.1): the same form as the guided review, in a dialog.
 */
export function DefaultGroupsButton({
  groups,
  create,
}: {
  groups: readonly DefaultGroupView[];
  create: (keys: string[]) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
}) {
  const t = useTranslations("settings.categories.defaults");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("open")}</Button>
      <Modal open={open} onOpenChange={setOpen} title={t("open")} width={520}>
        <DefaultGroupsForm
          groups={groups}
          onCreate={async (keys) => {
            const result = await create(keys);
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

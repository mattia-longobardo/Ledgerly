import { getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { Card } from "@/ui/card";
import { Kbd } from "@/ui/kbd";

/**
 * The prototype's "Shortcuts" card. It lists what the table really answers to (spec §8.4 point 2)
 * and nothing else: E opens the category editor of the row under the cursor, Space selects it,
 * J and K move the cursor. Hidden below 768 px, where there is no keyboard to speak of and the
 * table is a list.
 */
export async function ShortcutsCard() {
  const t = await getTranslations("expenses.shortcuts");
  const rows: { key: string; label: string }[] = [
    { key: "E", label: t("editCategory") },
    { key: "Space", label: t("selectRow") },
    { key: "J / K", label: t("nextPrevious") },
  ];

  return (
    <Card className="flex flex-col gap-2 max-md:hidden">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm text-muted">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <dt>{row.label}</dt>
            <dd className="text-right">
              <Kbd>{row.key}</Kbd>
            </dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  );
}

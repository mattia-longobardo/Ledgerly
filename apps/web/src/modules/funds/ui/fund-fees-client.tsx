"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import type { NumberFormat, UiLocale } from "@ledgerly/domain/platform/format";
import { notify } from "@/ui/toast";
import { removeFeeAction, saveFeeAction } from "../actions";
import type { FeeForm } from "@ledgerly/domain/funds/client";
import { CompactEmpty } from "./compact-empty";
import { FeeManager } from "./fee-list";
import type { FeeScopeOption } from "./fee-text";

/**
 * The fees of a fund in Settings: the list and the dialog of the form that creates a fund, with each
 * fee saved as it is written. "Remove" takes the row away at once and offers "Undo" in the toast,
 * which puts the fee back with the id it had.
 */
export function FundFeesList({
  fundId,
  fees,
  scopes,
  todayOn,
  format,
  locale,
  currency,
  readOnly,
  children,
}: {
  fundId: string;
  fees: readonly FeeForm[];
  scopes: readonly FeeScopeOption[];
  todayOn: CivilDate;
  format: NumberFormat;
  locale: UiLocale;
  currency: string;
  /** An archived fund. */
  readOnly: boolean;
  /** The line under the list: the estimated yearly cost. */
  children?: ReactNode;
}) {
  const t = useTranslations("funds.fees");
  const router = useRouter();
  // The fees being removed: gone from the list before the server answers, back if it says no.
  const [gone, setGone] = useState<readonly string[]>([]);
  const shown = fees.filter((fee) => fee.id === null || !gone.includes(fee.id));
  const back = (id: string) => setGone((ids) => ids.filter((one) => one !== id));

  async function save(fee: FeeForm): Promise<string | null> {
    const result = await saveFeeAction(fundId, fee);
    if (!result.ok) return t(result.error === "archived" ? "errors.archived" : "errors.failed");
    notify(t("saved"));
    router.refresh();
    return null;
  }

  function remove(fee: FeeForm) {
    const { id } = fee;
    if (id === null) return;
    setGone((ids) => [...ids, id]);
    void removeFeeAction(fundId, id).then((result) => {
      if (!result.ok) {
        back(id);
        notify(t(result.error === "archived" ? "errors.archived" : "errors.failed"), "error");
        return;
      }
      router.refresh();
      notify(t("removed"), "success", {
        label: t("undo"),
        onClick: () => {
          void saveFeeAction(fundId, fee, { keepId: true }).then((restored) => {
            if (!restored.ok) {
              notify(t("undoFailed"), "error");
              return;
            }
            back(id);
            router.refresh();
          });
        },
      });
    });
  }

  return (
    <FeeManager
      fees={shown}
      scopes={scopes}
      todayOn={todayOn}
      format={format}
      locale={locale}
      currency={currency}
      readOnly={readOnly}
      onSave={save}
      onRemove={remove}
      empty={(add) => <CompactEmpty title={t("empty.title")} description={t("empty.text")} actions={add} />}
    >
      {children}
    </FeeManager>
  );
}

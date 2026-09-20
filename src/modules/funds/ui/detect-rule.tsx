"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { CivilDate } from "@/platform/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@/platform/format";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Modal } from "@/ui/modal";
import { Select } from "@/ui/input";
import { notify } from "@/ui/toast";
import { proposeDepositRuleAction, saveDepositRuleAction } from "../actions";

type Found = NonNullable<Awaited<ReturnType<typeof proposeDepositRuleAction>> & { ok: true }>["found"];

/**
 * "Find this charge everywhere" (owner, 2026-09-20): pick one of the fund's debits and the app
 * works out what makes it recognisable — the creditor identifier of the direct debit, its mandate
 * reference, or its payee — then says how many charges carry the same name, from when, and what
 * they usually cost.
 *
 * Nothing is written until that answer has been read: the found text becomes the fund's deposit
 * rule only when the person presses the second button, and from then on the past charges are
 * deposits and the future ones join them by themselves.
 *
 * No model is asked anything: the identifiers have a shape the SEPA rulebook fixes, and
 * `funds/detect.ts` reads it.
 */
export function DetectRuleButton({
  fundId,
  movements,
  accountId,
  format,
  locale,
  label,
}: {
  fundId: string;
  movements: readonly { id: string; label: string }[];
  /** The account the rule keeps watching; the fund's debit account, or every account. */
  accountId: string;
  format: NumberFormat;
  locale: UiLocale;
  label: string;
}) {
  const t = useTranslations("funds.detect");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [found, setFound] = useState<Found | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const day = (on: string | null) => (on === null ? "" : formatDate(on as CivilDate, "long", locale));

  function look(transactionId: string) {
    setChosen(transactionId);
    setFound(undefined);
    if (transactionId === "") return;
    startTransition(async () => {
      const result = await proposeDepositRuleAction(fundId, transactionId);
      if (!result.ok) {
        notify(t("failed"), "error");
        return;
      }
      setFound(result.found);
    });
  }

  function use() {
    if (!found) return;
    startTransition(async () => {
      const result = await saveDepositRuleAction(fundId, {
        payeeMatch: found.text,
        accountId,
        active: true,
      });
      if (!result.ok) {
        notify(t("failed"), "error");
        return;
      }
      notify(t("saved", { count: found.count }));
      setOpen(false);
      setChosen("");
      setFound(undefined);
    });
  }

  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setChosen("");
            setFound(undefined);
          }
        }}
        title={t("title")}
        description={t("description")}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button variant="primary" onClick={use} disabled={pending || !found || found.count === 0}>
              {t("use")}
            </Button>
          </>
        }
      >
        <Field label={t("movement")} htmlFor={`${id}-movement`}>
          <Select
            id={`${id}-movement`}
            value={chosen}
            disabled={pending}
            onChange={(event) => look(event.currentTarget.value)}
          >
            <option value="">{t("pick")}</option>
            {movements.map((movement) => (
              <option key={movement.id} value={movement.id}>
                {movement.label}
              </option>
            ))}
          </Select>
        </Field>
        {found === undefined ? (
          <p className="text-sm text-muted">{chosen === "" ? t("hint") : t("looking")}</p>
        ) : found === null ? (
          <p className="text-sm text-muted">{t("nothing")}</p>
        ) : (
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{t(`kinds.${found.kind}` as "kinds.creditor")}</dt>
              <dd className="font-medium break-all">{found.text}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{t("charges")}</dt>
              <dd className="font-medium tabular-nums">
                {found.first === null
                  ? found.count
                  : t("chargesValue", {
                      count: found.count,
                      from: day(found.first),
                      to: day(found.last),
                    })}
              </dd>
            </div>
            {found.medianCents !== null && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">{t("usual")}</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(BigInt(found.medianCents), format)}
                  {found.intervalDays !== null && ` · ${t("every", { days: found.intervalDays })}`}
                </dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </>
  );
}

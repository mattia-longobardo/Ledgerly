"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { type CategoryOption, CategoryPicker } from "@/ui/category-picker";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { setBudgetLimitAction } from "../actions";

/**
 * "Add budget" (plan F3 §3.6.2: the design only shows a toast here): a monthly limit on a spending
 * category, an account, or both (F3), from the month on screen onwards. The same scope again
 * replaces its limit rather than adding a second one.
 */
export function AddBudget({
  month,
  monthLabel,
  categories,
  accounts,
  variant = "primary",
  label,
}: {
  month: string;
  monthLabel: string;
  categories: readonly CategoryOption[];
  accounts: readonly { id: string; name: string }[];
  variant?: "primary" | "secondary";
  label: string;
}) {
  const t = useTranslations("budgets");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = categories.find((option) => option.id === categoryId) ?? null;

  function change(next: boolean) {
    if (next) {
      setCategoryId(null);
      setError(null);
    }
    setOpen(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const accountId = String(data.get("account") ?? "") || null;
    if (categoryId === null && accountId === null) return setError(t("form.needScope"));
    const amount = String(data.get("amount") ?? "");
    startTransition(async () => {
      const result = await setBudgetLimitAction({ categoryId, accountId }, month, amount);
      if (!result.ok) return setError(t(`errors.${result.error === "not_found" ? "not_found" : "invalid"}`));
      notify(t("toasts.added"));
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => change(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={change}
        title={t("form.title")}
        description={t("form.description", { month: monthLabel })}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t("form.category")} htmlFor={`${id}-category`}>
              <CategoryPicker
                categories={categories}
                currentId={categoryId}
                open={picking}
                onOpenChange={setPicking}
                onPick={(picked) => {
                  setCategoryId(picked);
                  setError(null);
                }}
                uncategorisedLabel={t("form.anyCategory")}
                searchLabel={t("form.search")}
                noMatchLabel={t("form.noMatch")}
                triggerLabel={t("form.category")}
                triggerId={`${id}-category`}
                triggerClassName="focus-ring flex h-8 w-full items-center gap-2 rounded-ctl border border-border bg-card px-2.5 text-left text-base"
              >
                {chosen ? (
                  <>
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: chosen.color }} />
                    <span className="truncate">{chosen.name}</span>
                  </>
                ) : (
                  <span className="text-muted">{t("form.anyCategory")}</span>
                )}
              </CategoryPicker>
            </Field>
            <Field label={t("form.account")} htmlFor={`${id}-account`}>
              <Select id={`${id}-account`} name="account" defaultValue="" onChange={() => setError(null)}>
                <option value="">{t("form.anyAccount")}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("form.amount")} htmlFor={`${id}-amount`}>
            <InputGroup suffix="€">
              <Input
                id={`${id}-amount`}
                name="amount"
                inputMode="decimal"
                numeric
                required
                autoComplete="off"
              />
            </InputGroup>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("form.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

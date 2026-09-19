"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { type CategoryOption, CategoryPicker } from "@/ui/category-picker";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  createSubscriptionAction,
  setSubscriptionStateAction,
  updateSubscriptionAction,
} from "../actions";
import { CYCLES, type Cycle, type SubscriptionState } from "../rules";

/** What the dialog starts from: an existing subscription, a suggestion, or nothing. */
export interface SubscriptionDraft {
  id: string | null;
  state: SubscriptionState;
  name: string;
  categoryId: string | null;
  paymentAccountId: string | null;
  priceInput: string;
  cycle: Cycle;
  nextChargeOn: string;
  payeeMatch: string;
  toleranceInput: string;
  utility: number;
  /** "Last match: …", already written; `null` for a new one. */
  lastMatch: string | null;
}

export interface DialogOptions {
  categories: readonly CategoryOption[];
  accounts: readonly { id: string; name: string }[];
}

const KNOWN_ERRORS = ["invalid", "not_found", "invalid_account", "invalid_category"];

/** The design's caption under the utility scale. */
function utilityCaption(t: ReturnType<typeof useTranslations<"subscriptions">>, value: number): string {
  if (value <= 3) return t("form.utilityRare", { value });
  if (value <= 6) return t("form.utilityNice", { value });
  return t("form.utilityEssential", { value });
}

export function SubscriptionDialog({
  draft,
  options,
  onClose,
}: {
  draft: SubscriptionDraft;
  options: DialogOptions;
  onClose: () => void;
}) {
  const t = useTranslations("subscriptions");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [utility, setUtility] = useState(draft.utility);
  const [categoryId, setCategoryId] = useState(draft.categoryId);
  const [picking, setPicking] = useState(false);
  const category = options.categories.find((option) => option.id === categoryId) ?? null;

  function report(result: ActionResult, toast: string): void {
    if (!result.ok) {
      setError(
        t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
      );
      return;
    }
    notify(toast);
    onClose();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      name: text("name"),
      categoryId,
      paymentAccountId: text("account") || null,
      price: text("price"),
      cycle: text("cycle"),
      nextChargeOn: text("next"),
      payeeMatch: text("match"),
      tolerance: text("tolerance"),
      utility,
    };
    startTransition(async () => {
      const result = draft.id
        ? await updateSubscriptionAction(draft.id, input)
        : await createSubscriptionAction(input);
      report(result, t("toasts.saved"));
    });
  }

  function setState(state: SubscriptionState, toast: string) {
    if (!draft.id) return;
    const subscriptionId = draft.id;
    startTransition(async () => report(await setSubscriptionStateAction(subscriptionId, state), toast));
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={draft.id ? t("form.editTitle") : t("form.newTitle")}
      description={t("form.description")}
      width={520}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="col-span-full">
          <Field label={t("form.name")} htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" defaultValue={draft.name} required maxLength={80} />
          </Field>
        </div>
        <Field label={t("form.category")} htmlFor={`${id}-category`}>
          <CategoryPicker
            categories={options.categories}
            currentId={categoryId}
            open={picking}
            onOpenChange={setPicking}
            onPick={setCategoryId}
            uncategorisedLabel={t("form.pickCategory")}
            searchLabel={t("form.search")}
            noMatchLabel={t("form.noMatch")}
            triggerLabel={t("form.category")}
            triggerId={`${id}-category`}
            triggerClassName="focus-ring flex h-8 w-full items-center gap-2 rounded-ctl border border-border bg-card px-2.5 text-left text-base"
          >
            {category ? (
              <>
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: category.color }} />
                <span className="truncate">{category.name}</span>
              </>
            ) : (
              <span className="text-faint">{t("form.pickCategory")}</span>
            )}
          </CategoryPicker>
        </Field>
        <Field label={t("form.paidFrom")} htmlFor={`${id}-account`}>
          <Select id={`${id}-account`} name="account" defaultValue={draft.paymentAccountId ?? ""}>
            <option value="">{t("form.anyAccount")}</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("form.price")} htmlFor={`${id}-price`}>
          <Input
            id={`${id}-price`}
            name="price"
            inputMode="decimal"
            numeric
            required
            defaultValue={draft.priceInput}
          />
        </Field>
        <Field label={t("form.billing")} htmlFor={`${id}-cycle`}>
          <Select id={`${id}-cycle`} name="cycle" defaultValue={draft.cycle}>
            {CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>
                {t(`cycles.${cycle}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("form.nextCharge")} htmlFor={`${id}-next`}>
          <Input id={`${id}-next`} name="next" type="date" required defaultValue={draft.nextChargeOn} />
        </Field>

        <fieldset className="col-span-full flex flex-col gap-3 rounded-card border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t("form.check")}</legend>
          <p className="text-sm text-muted">{t("form.checkDescription")}</p>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
            <Field label={t("form.match")} htmlFor={`${id}-match`}>
              <Input id={`${id}-match`} name="match" defaultValue={draft.payeeMatch} maxLength={80} />
            </Field>
            <Field label={t("form.tolerance")} htmlFor={`${id}-tolerance`}>
              <InputGroup suffix="%">
                <Input
                  id={`${id}-tolerance`}
                  name="tolerance"
                  inputMode="decimal"
                  numeric
                  defaultValue={draft.toleranceInput}
                />
              </InputGroup>
            </Field>
          </div>
          <p className="text-xs text-faint">{draft.lastMatch ?? t("form.never")}</p>
        </fieldset>

        <div className="col-span-full flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span id={`${id}-utility`} className="text-sm font-medium">
              {t("form.utility")}
            </span>
            <span className="text-sm text-muted">{utilityCaption(t, utility)}</span>
          </div>
          <div role="radiogroup" aria-labelledby={`${id}-utility`} className="grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={value === utility}
                onClick={() => setUtility(value)}
                className={cn(
                  "focus-ring h-7 rounded-[5px] border text-sm tabular-nums",
                  value <= utility
                    ? utility <= 5
                      ? "border-warn bg-warn-bg text-warn"
                      : "border-primary bg-primary text-primary-fg"
                    : "border-border bg-card text-muted hover:bg-hover",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="col-span-full text-sm text-neg">
            {error}
          </p>
        )}
        <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {draft.id && draft.state !== "cancelled" && (
              <Button variant="danger" size="sm" onClick={() => setState("cancelled", t("toasts.cancelled"))}>
                {t("form.cancelSubscription")}
              </Button>
            )}
            {draft.id && draft.state === "active" && (
              <Button variant="ghost" size="sm" onClick={() => setState("paused", t("toasts.paused"))}>
                {t("form.pause")}
              </Button>
            )}
            {draft.id && draft.state !== "active" && (
              <Button variant="ghost" size="sm" onClick={() => setState("active", t("toasts.resumed"))}>
                {draft.state === "paused" ? t("form.resume") : t("form.reactivate")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("form.close")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("form.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** A button that opens the dialog on `draft`. */
export function AddSubscription({
  draft,
  options,
  label,
  variant = "primary",
  size = "sm",
}: {
  draft: SubscriptionDraft;
  options: DialogOptions;
  label: string;
  variant?: "primary" | "secondary";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <SubscriptionDialog draft={draft} options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

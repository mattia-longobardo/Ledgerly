"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { type CategoryOption, CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { Input, InputGroup, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { RecurrenceField } from "@ledgerly/ui/recurrence-field";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";
import { type ActionResult, createSubscription, setSubscriptionState, updateSubscription } from "../calls";
import { CYCLES, type Cycle, type SubscriptionState } from "@ledgerly/domain/subscriptions/client";

/** «Every N weeks or months» as the form holds it (R5a, D4). */
export interface EveryDraft {
  unit: EveryUnit;
  count: number;
}

type EveryUnit = "week" | "month";
const EVERY_UNITS: readonly EveryUnit[] = ["week", "month"];
/** The largest N of each unit (D4); the contract's `MAX_EVERY`, which its entry does not export. */
const MAX_EVERY: Record<EveryUnit, number> = { week: 12, month: 24 };
const CUSTOM = "custom";
const FREQUENCIES: readonly (Cycle | typeof CUSTOM)[] = [...CYCLES, CUSTOM];

/** What the dialog starts from: an existing subscription, a suggestion, or nothing. */
export interface SubscriptionDraft {
  id: string | null;
  state: SubscriptionState;
  name: string;
  categoryId: string | null;
  paymentAccountId: string | null;
  priceInput: string;
  /** One of the 4 cycles, or `custom`: then `every` is the frequency. */
  cycle: Cycle | typeof CUSTOM;
  every: EveryDraft;
  nextChargeOn: string;
  payeeMatch: string;
  toleranceInput: string;
  utility: number;
  /** The person gave no vote (R5a, D5). */
  noVote: boolean;
  /** "Last match: …", already written; `null` for a new one. */
  lastMatch: string | null;
}

export interface DialogOptions {
  categories: readonly CategoryOption[];
  accounts: readonly { id: string; name: string }[];
}

const KNOWN_ERRORS = ["invalid", "not_found", "invalid_account", "invalid_category"];

/** The design's caption under the utility scale. */
function utilityCaption(
  t: ReturnType<typeof useTranslations<"subscriptions">>,
  value: number | null,
): string {
  if (value === null) return t("form.noVote");
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
  const [noVote, setNoVote] = useState(draft.noVote);
  const [cycle, setCycle] = useState(draft.cycle);
  const [unit, setUnit] = useState(draft.every.unit);
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
    const every = cycle === CUSTOM ? { unit, count: Number(text("everyCount")) } : null;
    if (every && !(Number.isInteger(every.count) && every.count >= 1 && every.count <= MAX_EVERY[unit])) {
      setError(t("errors.every"));
      return;
    }
    const input = {
      name: text("name"),
      categoryId,
      paymentAccountId: text("account") || null,
      price: text("price"),
      cycle: CYCLES.find((one) => one === cycle) ?? null,
      every,
      nextChargeOn: text("next"),
      payeeMatch: text("match"),
      tolerance: text("tolerance"),
      utility,
      noVote,
    };
    startTransition(async () => {
      const result = draft.id ? await updateSubscription(draft.id, input) : await createSubscription(input);
      report(result, t("toasts.saved"));
    });
  }

  function setState(state: SubscriptionState, toast: string) {
    if (!draft.id) return;
    const subscriptionId = draft.id;
    startTransition(async () => report(await setSubscriptionState(subscriptionId, state), toast));
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
                <span aria-hidden className="size-2 rounded-xs" style={{ background: category.color }} />
                <span className="truncate">{category.name}</span>
              </>
            ) : (
              <span className="text-faint">{t("form.pickCategory")}</span>
            )}
          </CategoryPicker>
        </Field>
        <Field label={t("form.paidFrom")} htmlFor={`${id}-account`}>
          <AccountSelect
            id={`${id}-account`}
            name="account"
            defaultValue={draft.paymentAccountId ?? ""}
            accounts={options.accounts}
            none={t("form.anyAccount")}
          />
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
        <RecurrenceField
          id={`${id}-cycle`}
          name="cycle"
          label={t("form.billing")}
          value={cycle}
          onChange={setCycle}
          options={FREQUENCIES.map((value) => ({ value, label: t(`cycles.${value}`) }))}
        />
        <Field label={t("form.nextCharge")} htmlFor={`${id}-next`}>
          <Input id={`${id}-next`} name="next" type="date" required defaultValue={draft.nextChargeOn} />
        </Field>
        {cycle === CUSTOM && (
          <>
            <Field label={t("form.everyCount")} htmlFor={`${id}-every`} hint={t("form.everyHint")}>
              <Input
                id={`${id}-every`}
                name="everyCount"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_EVERY[unit]}
                required
                defaultValue={draft.every.count}
              />
            </Field>
            <Field label={t("form.everyUnit")} htmlFor={`${id}-unit`}>
              <Select
                id={`${id}-unit`}
                name="everyUnit"
                value={unit}
                onChange={(event) => setUnit(EVERY_UNITS.find((one) => one === event.target.value) ?? unit)}
              >
                {EVERY_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {t(`form.units.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

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
            <span className="text-sm text-muted">{utilityCaption(t, noVote ? null : utility)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={noVote} onCheckedChange={setNoVote} labelledBy={`${id}-no-vote`} />
            <span id={`${id}-no-vote`}>{t("form.noVote")}</span>
          </div>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-utility`}
            aria-disabled={noVote || undefined}
            className={cn("grid grid-cols-10 gap-1", noVote && "opacity-50")}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={!noVote && value === utility}
                disabled={noVote}
                onClick={() => setUtility(value)}
                className={cn(
                  "focus-ring h-7 rounded-tag border text-sm tabular-nums",
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

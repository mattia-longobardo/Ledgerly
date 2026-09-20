"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button, LinkButton } from "@/ui/button";
import { type CategoryOption, CategoryPicker } from "@/ui/category-picker";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { type ActionResult, createRuleAction, setRuleStateAction, updateRuleAction } from "../actions";
import { DEFAULT_RUN_HOUR, formatRunHour, RUN_HOURS } from "../rules";

/** What the dialog starts from, every value already written the way the person types it. */
export interface RuleDraft {
  id: string | null;
  accountId: string;
  accountName: string;
  validFrom: string;
  validTo: string;
  /** The hour the rule accrues at, "0"–"23"; empty is the default hour. */
  runHour: string;
  tiers: { upTo: string; rate: string }[];
  tax: string;
  dayBasis: "365" | "360";
  settlement: "daily" | "monthly" | "quarterly" | "annual";
  payeeMatch: string;
  publish: boolean;
  /** The category a published settlement is filed under in Wallet; `null` is none. */
  categoryId: string | null;
  active: boolean;
}

const KNOWN = ["invalid", "not_found", "invalid_account", "invalid_tiers", "not_synced", "invalid_category"];

/**
 * The design's interest rule dialog, with what spec §7.6 adds (plan F4 §3.6.2): an end date, the
 * day basis, the hour of the person's own day the rule accrues at, the text that recognises the
 * bank's payment, and publishing to Wallet. The last tier is always "above": only the tiers before
 * it have a threshold.
 */
export function RuleDialog({
  draft,
  accounts,
  categories,
  onClose,
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
  /** The income categories a published settlement may be filed under (spec §7.6). */
  categories: readonly CategoryOption[];
  onClose: () => void;
}) {
  const t = useTranslations("interests");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState(draft.tiers);
  const [categoryId, setCategoryId] = useState<string | null>(draft.categoryId);
  const [picking, setPicking] = useState(false);
  const chosen = categories.find((option) => option.id === categoryId) ?? null;

  function setTier(index: number, field: "upTo" | "rate", value: string) {
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      accountId: text("account"),
      validFrom: text("from"),
      validTo: text("to"),
      runHour: text("runHour"),
      tiers,
      tax: text("tax"),
      dayBasis: text("basis"),
      settlement: text("settlement"),
      payeeMatch: text("match"),
      publish: data.get("publish") === "on",
      categoryId: categoryId ?? "",
      active: data.get("active") === "on",
    };
    startTransition(async () => {
      const result: ActionResult = draft.id
        ? await updateRuleAction(draft.id, input)
        : await createRuleAction(input);
      if (!result.ok) {
        setError(t(`errors.${KNOWN.includes(result.error) ? result.error : "failed"}` as "errors.failed"));
        return;
      }
      notify(t("toasts.saved"));
      onClose();
      if (!draft.id && result.id) router.push(`/interests/${result.id}`);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={draft.id ? t("form.editTitle", { account: draft.accountName }) : t("form.newTitle")}
      description={t("form.description")}
      width={520}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="col-span-full">
          <Field label={t("form.account")} htmlFor={`${id}-account`}>
            <Select id={`${id}-account`} name="account" defaultValue={draft.accountId}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("form.validFrom")} htmlFor={`${id}-from`}>
          <Input id={`${id}-from`} name="from" type="date" required defaultValue={draft.validFrom} />
        </Field>
        <Field label={t("form.validTo")} htmlFor={`${id}-to`}>
          <Input id={`${id}-to`} name="to" type="date" defaultValue={draft.validTo} />
        </Field>

        {/*
          The tiers sit on the form's own two columns (`grid-cols-2 gap-3`), so "Balance up to" and
          "Gross rate" line up with "Starts on" and "Ends on" above them, and the rate field ends
          exactly where "Ends on", "Day basis" and the rest end: the whole column is the field. The
          button that removes a tier lives inside the rate field, after the "%" — no column of its
          own to shorten the field with; the last tier, which has nothing to remove, keeps an empty
          slot of the same size so every "%" stands at the same place. Two columns at every width,
          as before: a threshold and its rate belong side by side even on a narrow screen.
        */}
        <fieldset className="col-span-full flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("form.tiers")}</legend>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted">
            <span>{t("form.upTo")}</span>
            <span>{t("form.rate")}</span>
          </div>
          {tiers.map((tier, index) => {
            const last = index === tiers.length - 1;
            return (
              <div key={index} className="grid grid-cols-2 items-center gap-3" data-testid="tier">
                {last ? (
                  <span className="flex h-8 items-center rounded-ctl border border-border bg-hover px-2.5 text-muted">
                    {t("form.above")}
                  </span>
                ) : (
                  <InputGroup suffix="€">
                    <Input
                      aria-label={`${t("form.upTo")} ${index + 1}`}
                      inputMode="decimal"
                      numeric
                      value={tier.upTo}
                      onChange={(event) => setTier(index, "upTo", event.target.value)}
                    />
                  </InputGroup>
                )}
                <InputGroup
                  suffix={
                    <span className="-mr-1.5 flex items-center gap-1.5">
                      %
                      {last ? (
                        <span className="size-6 shrink-0" aria-hidden />
                      ) : (
                        <button
                          type="button"
                          aria-label={t("form.removeTier")}
                          onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                          className="focus-ring grid size-6 shrink-0 place-items-center rounded-[5px] text-muted hover:bg-hover hover:text-fg"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  }
                >
                  <Input
                    aria-label={`${t("form.rate")} ${index + 1}`}
                    inputMode="decimal"
                    numeric
                    value={tier.rate}
                    onChange={(event) => setTier(index, "rate", event.target.value)}
                  />
                </InputGroup>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-3">
            <LinkButton
              type="button"
              className="justify-self-start"
              onClick={() =>
                setTiers((current) => [...current.slice(0, -1), { upTo: "", rate: "" }, ...current.slice(-1)])
              }
            >
              {t("form.addTier")}
            </LinkButton>
          </div>
        </fieldset>

        <Field label={t("form.tax")} htmlFor={`${id}-tax`}>
          <InputGroup suffix="%">
            <Input id={`${id}-tax`} name="tax" inputMode="decimal" numeric defaultValue={draft.tax} />
          </InputGroup>
        </Field>
        <Field label={t("form.basis")} htmlFor={`${id}-basis`}>
          <Select id={`${id}-basis`} name="basis" defaultValue={draft.dayBasis}>
            <option value="365">{t("basis.365")}</option>
            <option value="360">{t("basis.360")}</option>
          </Select>
        </Field>
        <Field label={t("form.payout")} htmlFor={`${id}-settlement`}>
          <Select id={`${id}-settlement`} name="settlement" defaultValue={draft.settlement}>
            <option value="daily">{t("settlement.daily")}</option>
            <option value="monthly">{t("settlement.monthly")}</option>
            <option value="quarterly">{t("settlement.quarterly")}</option>
            <option value="annual">{t("settlement.annual")}</option>
          </Select>
        </Field>
        {/* The hour of the person's own day the rule accrues at; empty keeps the default one. */}
        <Field label={t("form.runHour")} htmlFor={`${id}-run-hour`} hint={t("form.runHourHint")}>
          <Select id={`${id}-run-hour`} name="runHour" defaultValue={draft.runHour}>
            <option value="">{t("form.runHourDefault", { time: formatRunHour(DEFAULT_RUN_HOUR) })}</option>
            {RUN_HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {formatRunHour(hour)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-full">
          <Field label={t("form.match")} htmlFor={`${id}-match`} hint={t("form.matchHint")}>
            <Input id={`${id}-match`} name="match" maxLength={80} defaultValue={draft.payeeMatch} />
          </Field>
        </div>
        {/*
          The category the published record is filed under in Wallet (spec §7.6): a local category
          of this user's, which the posting resolves to Wallet's own id through the `category`
          links. A category that has never been linked publishes the record uncategorised and the
          payout says so — the posting is never failed and no category is ever invented.
        */}
        <div className="col-span-full">
          <Field label={t("form.category")} htmlFor={`${id}-category`} hint={t("form.categoryHint")}>
            <CategoryPicker
              categories={categories}
              currentId={categoryId}
              open={picking}
              onOpenChange={setPicking}
              onPick={setCategoryId}
              uncategorisedLabel={t("form.noCategory")}
              searchLabel={t("form.categorySearch")}
              noMatchLabel={t("form.categoryNoMatch")}
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
                <span className="text-muted">{t("form.noCategory")}</span>
              )}
            </CategoryPicker>
          </Field>
        </div>
        <div className="col-span-full flex flex-col gap-2">
          <Checkbox name="publish" defaultChecked={draft.publish} label={t("form.publish")} />
          <p className="text-xs text-faint">{t("form.publishHint")}</p>
          <Checkbox name="active" defaultChecked={draft.active} label={t("form.active")} />
        </div>
        {error && (
          <p role="alert" className="col-span-full text-sm text-neg">
            {error}
          </p>
        )}
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("form.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A button that opens the dialog on `draft`. */
export function RuleButton({
  draft,
  accounts,
  categories,
  label,
  variant = "primary",
  size = "sm",
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
  categories: readonly CategoryOption[];
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <RuleDialog
          draft={draft}
          accounts={accounts}
          categories={categories}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Pause or resume from the rule's page. */
export function RuleStateButton({
  id,
  state,
  label,
  toast,
}: {
  id: string;
  state: "active" | "paused";
  label: string;
  toast: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setRuleStateAction(id, state);
          if (result.ok) notify(toast);
        })
      }
    >
      {label}
    </Button>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button, LinkButton } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { Checkbox, Input, InputGroup, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { RecurrenceField } from "@ledgerly/ui/recurrence-field";
import { notify } from "@ledgerly/ui/toast";
import { type ActionResult, createRuleAction, setRuleStateAction, updateRuleAction } from "../calls";
import { SETTLEMENTS } from "@ledgerly/api-contract/interests";
import { DEFAULT_RUN_HOUR, formatRunHour, RUN_HOURS } from "@ledgerly/domain/interests/client";

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
  /** The rule still has the retired mode «Publish to {source}» (decision H37); saving drops it. */
  retiredMode: boolean;
  /** The category the rule has; kept as it is, the dialog no longer chooses it. */
  categoryId: string | null;
  active: boolean;
}

const KNOWN = [
  "invalid",
  "not_found",
  "invalid_account",
  "invalid_tiers",
  "not_synced",
  "invalid_category",
  "mode_retired",
];

/**
 * The design's interest rule dialog, with what spec §7.6 adds (plan F4 §3.6.2): an end date, the
 * day basis, the hour of the person's own day the rule accrues at and the text that recognises the
 * bank's payment. The last tier is always "above": only the tiers before
 * it have a threshold.
 */
export function RuleDialog({
  draft,
  accounts,
  onClose,
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("interests");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState(draft.tiers);

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
      categoryId: draft.categoryId ?? "",
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
            <AccountSelect
              id={`${id}-account`}
              name="account"
              defaultValue={draft.accountId}
              accounts={accounts}
            />
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
                          className="focus-ring grid size-6 shrink-0 place-items-center rounded-tag text-muted hover:bg-hover hover:text-fg"
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
        <RecurrenceField
          id={`${id}-settlement`}
          name="settlement"
          label={t("form.payout")}
          defaultValue={draft.settlement}
          options={SETTLEMENTS.map((value) => ({ value, label: t(`settlement.${value}`) }))}
        />
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
        <div className="col-span-full flex flex-col gap-2">
          {/* «Publish to {source}» is gone (decision H37): a rule saved with it keeps only the analysis. */}
          {draft.retiredMode && (
            <p role="note" className="text-sm text-muted">
              {t("form.retiredMode")}
            </p>
          )}
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
  label,
  variant = "primary",
  size = "sm",
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
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
      {open && <RuleDialog draft={draft} accounts={accounts} onClose={() => setOpen(false)} />}
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

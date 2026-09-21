"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseAmount } from "@/modules/accounts/rules";
import { formatMoney, type NumberFormat } from "@/platform/format";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  createFundAction,
  deleteDepositAction,
  deleteValuationAction,
  type FundFormInput,
  recordValuationAction,
  saveDepositAction,
  saveDepositRuleAction,
  setFundStateAction,
  updateFundAction,
  updateValuationAction,
  type ValuationFormInput,
} from "../actions";
import { type FundKind, fundFormFields } from "./present";

const KNOWN = [
  "invalid",
  "not_found",
  "invalid_account",
  "duplicate_name",
  "archived",
  "linked",
  "future_date",
];

function useResult() {
  const t = useTranslations("funds");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    setError,
    ok(result: ActionResult): boolean {
      if (result.ok) {
        setError(null);
        return true;
      }
      setError(t(`errors.${KNOWN.includes(result.error) ? result.error : "failed"}` as "errors.failed"));
      return false;
    },
  };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="col-span-full text-sm text-neg">
      {error}
    </p>
  ) : null;
}

type Accounts = readonly { id: string; name: string }[];

/** The fund's fields, as the person types them; the dialog adds where the value lives. */
export type FundDraft = FundFormInput;

/**
 * The design's "Fund kind" (Settings › General, and the same control in "New fund"): a segmented
 * control with a line underneath saying what the choice means. `onChange` missing means an
 * existing fund, whose kind is settled: the other option is disabled and the line says why.
 */
/**
 * The design's «Fund kind» (Settings › General): a two-option segmented control. Without
 * `onChange` it is the read-only form the pension fund's own settings show — the kind is chosen
 * when the fund is created, because the two keep different data.
 */
export function KindField({ kind, onChange }: { kind: FundKind; onChange?: (kind: FundKind) => void }) {
  const t = useTranslations("funds.settings.general");
  const locked = onChange === undefined;
  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="text-sm font-medium">{t("kind")}</span>
      <Segmented
        label={t("kind")}
        value={kind}
        onChange={onChange ?? (() => {})}
        options={[
          { value: "pac", label: t("kindPac"), disabled: locked && kind !== "pac" },
          { value: "pension", label: t("kindPension"), disabled: locked && kind !== "pension" },
        ]}
      />
      <p className="text-sm text-muted">{t(locked ? "kindFixed" : "kindHelp")}</p>
    </div>
  );
}

/**
 * The fund's fields for the kind it is (`fundFormFields`): a PAC's whole plan, or a pension fund's
 * four — a pension fund's money comes from the payslips, not from a monthly debit of its own.
 */
function FundFields({
  draft,
  accounts,
  id,
  kind,
  onKindChange,
}: {
  draft: FundDraft;
  accounts: Accounts;
  id: string;
  kind: FundKind;
  onKindChange?: (kind: FundKind) => void;
}) {
  const t = useTranslations("funds.settings");
  const shows = fundFormFields(kind);
  return (
    <>
      <div className="col-span-full">
        <Field label={t("general.name")} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required maxLength={80} defaultValue={draft.name} />
        </Field>
      </div>
      <Field label={t("general.provider")} htmlFor={`${id}-provider`}>
        <Input id={`${id}-provider`} name="provider" maxLength={80} defaultValue={draft.provider} />
      </Field>
      <Field label={t("general.compartment")} htmlFor={`${id}-compartment`}>
        <Input id={`${id}-compartment`} name="compartment" maxLength={80} defaultValue={draft.compartment} />
      </Field>
      <KindField kind={kind} onChange={onKindChange} />
      {shows.has("isin") && (
        <Field label={t("general.isin")} htmlFor={`${id}-isin`}>
          <Input
            id={`${id}-isin`}
            name="isin"
            maxLength={12}
            className="font-mono"
            defaultValue={draft.isin}
          />
        </Field>
      )}
      <Field label={t(kind === "pension" ? "general.memberSince" : "general.start")} htmlFor={`${id}-start`}>
        <Input id={`${id}-start`} name="start" type="date" required defaultValue={draft.startOn} />
      </Field>
      {shows.has("monthly") && (
        <Field label={t("plan.monthly")} htmlFor={`${id}-monthly`}>
          <Input
            id={`${id}-monthly`}
            name="monthly"
            inputMode="decimal"
            numeric
            defaultValue={draft.monthly}
          />
        </Field>
      )}
      {shows.has("fee") && (
        <Field label={t("plan.fee")} htmlFor={`${id}-fee`}>
          <Input id={`${id}-fee`} name="fee" inputMode="decimal" numeric defaultValue={draft.fee} />
        </Field>
      )}
      {shows.has("debit") && (
        <Field label={t("plan.debitAccount")} htmlFor={`${id}-debit`}>
          <Select id={`${id}-debit`} name="debit" defaultValue={draft.debitAccountId}>
            <option value="">{t("plan.noAccount")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {shows.has("day") && (
        <Field label={t("plan.debitDay")} htmlFor={`${id}-day`}>
          <Input id={`${id}-day`} name="day" type="number" min={1} max={31} defaultValue={draft.debitDay} />
        </Field>
      )}
      {shows.has("ter") && (
        <Field label={t("plan.ter")} htmlFor={`${id}-ter`}>
          <InputGroup suffix="%">
            <Input id={`${id}-ter`} name="ter" inputMode="decimal" numeric defaultValue={draft.ter} />
          </InputGroup>
        </Field>
      )}
    </>
  );
}

function readFund(data: FormData): FundFormInput {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return {
    name: text("name"),
    provider: text("provider"),
    isin: text("isin"),
    compartment: text("compartment"),
    debitAccountId: text("debit"),
    debitDay: text("day"),
    ter: text("ter"),
    startOn: text("start"),
    monthly: text("monthly"),
    fee: text("fee"),
  };
}

/**
 * Creating a pension fund needs both modules at once, so the action lives in the app layer
 * (`app/(app)/funds/pension-setup.ts`) and reaches the dialog as a prop: `count` is how many
 * already-applied payslips it published to the new fund.
 */
export type CreatePensionFund = (input: {
  name: string;
  provider: string;
  compartment: string;
  startOn: string;
}) => Promise<{ ok: true; id?: string; count?: number } | { ok: false; error: string }>;

/**
 * "Add fund" (design: the Fund settings modal in "New fund" mode). One button for both kinds: the
 * design's "Fund kind" chooses which, the fields follow it, and so does the action that saves.
 */
export function NewFundButton({
  draft,
  accounts,
  valuationAccounts,
  createPension,
  label,
  size = "sm",
}: {
  draft: FundDraft;
  accounts: Accounts;
  valuationAccounts: Accounts;
  createPension: CreatePensionFund;
  label: string;
  size?: "sm" | "md";
}) {
  const t = useTranslations("funds");
  const tp = useTranslations("funds.pension.create");
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FundKind>("pac");
  const [pending, startTransition] = useTransition();
  const { error, setError, ok } = useResult();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fund = readFund(data);
    startTransition(async () => {
      if (kind === "pension") {
        const result = await createPension({
          name: fund.name,
          provider: fund.provider,
          compartment: fund.compartment,
          startOn: fund.startOn,
        });
        if (!ok(result)) return;
        notify(result.ok && result.count ? tp("published", { count: result.count }) : tp("created"));
        setOpen(false);
        if (result.ok && result.id) router.push(`/funds/${result.id}`);
        else router.refresh();
        return;
      }
      const result = await createFundAction({
        ...fund,
        valuationAccountId: String(data.get("valuation") ?? ""),
        initial: String(data.get("initial") ?? ""),
      });
      if (!ok(result)) return;
      notify(t("toasts.saved"));
      setOpen(false);
      if (result.ok && result.id) router.push(`/funds/${result.id}`);
    });
  }

  return (
    <>
      <Button variant="primary" size={size} onClick={() => (setError(null), setKind("pac"), setOpen(true))}>
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("form.newTitle")}
        description={t("form.description")}
        width={520}
      >
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <FundFields draft={draft} accounts={accounts} id={id} kind={kind} onKindChange={setKind} />
          {kind === "pac" && (
            <>
              <Field label={t("form.valuationAccount")} htmlFor={`${id}-valuation`}>
                <Select id={`${id}-valuation`} name="valuation" defaultValue="">
                  <option value="">{t("form.newAccount")}</option>
                  {valuationAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("form.initial")} htmlFor={`${id}-initial`}>
                <Input id={`${id}-initial`} name="initial" inputMode="decimal" numeric />
              </Field>
            </>
          )}
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
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

/**
 * Settings › General and Contributions of an existing fund, saved together. The kind is shown but
 * not editable: a PAC has deposits, a pension fund has competences and operations, so there
 * is nothing honest to turn one into the other — it is chosen when the fund is created.
 */
export function FundSettingsForm({
  fundId,
  draft,
  accounts,
  kind = "pac",
}: {
  fundId: string;
  draft: FundDraft;
  accounts: Accounts;
  kind?: FundKind;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readFund(new FormData(event.currentTarget));
    startTransition(async () => {
      if (ok(await updateFundAction(fundId, input))) notify(t("toasts.saved"));
    });
  }
  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <FundFields draft={draft} accounts={accounts} id={id} kind={kind} />
      <ErrorLine error={error} />
      <div className="col-span-full flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {t("settings.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Where a valuation command sits, and so which button it is: the page header's call to action, a
 * card header beside the other command of that card, or a table row.
 */
export type TriggerPlace = "page" | "card" | "row";

/** One trigger, so "Record valuation" carries the same weight wherever it is offered. */
function Trigger({ place, label, onClick }: { place: TriggerPlace; label: string; onClick: () => void }) {
  if (place === "row")
    return (
      <Button size="xs" variant="ghost" onClick={onClick}>
        {label}
      </Button>
    );
  return (
    <Button variant={place === "page" ? "primary" : "secondary"} size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

export interface ValuationDraft extends ValuationFormInput {
  id: string;
}

/** The valuation fields, shared by "Record valuation" and "Edit" so the two agree. */
function ValuationFields({ id, today, draft }: { id: string; today: string; draft?: ValuationDraft }) {
  const t = useTranslations("funds.valuations.form");
  return (
    <>
      <Field label={t("date")} htmlFor={`${id}-on`}>
        <Input id={`${id}-on`} name="on" type="date" max={today} defaultValue={draft?.on ?? today} required />
      </Field>
      <Field label={t("value")} htmlFor={`${id}-value`}>
        <Input
          id={`${id}-value`}
          name="value"
          inputMode="decimal"
          numeric
          required
          autoFocus
          defaultValue={draft?.value ?? ""}
        />
      </Field>
      <Field label={t("note")} htmlFor={`${id}-note`}>
        <Input id={`${id}-note`} name="note" maxLength={200} defaultValue={draft?.note ?? ""} />
      </Field>
    </>
  );
}

function readValuation(data: FormData): ValuationFormInput {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return { on: text("on"), value: text("value"), note: text("note") };
}

/** "Record valuation" (design modal): the day, the value and a note. */
export function ValuationButton({
  fundId,
  fundName,
  today,
  lastLine,
  label,
  place = "page",
}: {
  fundId: string;
  fundName: string;
  today: string;
  lastLine: string | null;
  label: string;
  place?: TriggerPlace;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { error, setError, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readValuation(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await recordValuationAction(fundId, input))) return;
      notify(t("toasts.valuation"));
      setOpen(false);
    });
  }
  return (
    <>
      <Trigger place={place} label={label} onClick={() => (setError(null), setOpen(true))} />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("valuations.form.title", { name: fundName })}
        description={t("valuations.form.description")}
      >
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
          <ValuationFields id={id} today={today} />
          {lastLine && <p className="col-span-full text-sm text-muted">{lastLine}</p>}
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("valuations.form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("valuations.form.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * "Edit" on a valuation row: the same four fields, already filled. A new day moves the value to
 * that day (service `updateValuation`), it never leaves a second row behind.
 */
export function EditValuationButton({
  fundId,
  draft,
  today,
  label,
}: {
  fundId: string;
  draft: ValuationDraft;
  today: string;
  label: string;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { error, setError, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readValuation(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await updateValuationAction(fundId, draft.id, input))) return;
      notify(t("toasts.valuationUpdated"));
      setOpen(false);
    });
  }
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => (setError(null), setOpen(true))}>
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("valuations.editTitle")}>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
          <ValuationFields id={id} today={today} draft={draft} />
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("valuations.form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("valuations.form.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** A small action that asks the server and says how it went. */
function ActionButton({
  label,
  run,
  toast,
  danger,
}: {
  label: string;
  run: () => Promise<ActionResult>;
  toast: string;
  danger?: boolean;
}) {
  const t = useTranslations("funds");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant={danger ? "danger" : "ghost"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          notify(
            result.ok
              ? toast
              : t(`errors.${KNOWN.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
            result.ok ? "success" : "error",
          );
        })
      }
    >
      {label}
    </Button>
  );
}

export function DeleteValuation({
  fundId,
  valuationId,
  label,
  toast,
}: {
  fundId: string;
  valuationId: string;
  label: string;
  toast: string;
}) {
  return (
    <ActionButton label={label} toast={toast} danger run={() => deleteValuationAction(fundId, valuationId)} />
  );
}

export function DeleteDeposit({
  fundId,
  depositId,
  label,
  toast,
}: {
  fundId: string;
  depositId: string;
  label: string;
  toast: string;
}) {
  return (
    <ActionButton label={label} toast={toast} danger run={() => deleteDepositAction(fundId, depositId)} />
  );
}

export function FundStateButton({
  fundId,
  state,
  label,
  toast,
}: {
  fundId: string;
  state: "active" | "archived";
  label: string;
  toast: string;
}) {
  return (
    <ActionButton
      label={label}
      toast={toast}
      danger={state === "archived"}
      run={() => setFundStateAction(fundId, state)}
    />
  );
}

export interface DepositDraft {
  id: string | null;
  on: string;
  debited: string;
  fee: string;
  note: string;
}

/** The deposit fields, with the invested amount worked out as the person types. */
function DepositFields({ draft, format, id }: { draft: DepositDraft; format: NumberFormat; id: string }) {
  const t = useTranslations("funds.deposits.add");
  const [debited, setDebited] = useState(draft.debited);
  const [fee, setFee] = useState(draft.fee);
  let invested: string = "—";
  try {
    if (debited.trim() !== "")
      invested = formatMoney(
        parseAmount(debited, format) - (fee.trim() === "" ? 0n : parseAmount(fee, format)),
        format,
      );
  } catch {
    invested = "—";
  }
  return (
    <>
      <Field label={t("date")} htmlFor={`${id}-on`}>
        <Input id={`${id}-on`} name="on" type="date" defaultValue={draft.on} required />
      </Field>
      <Field label={t("debited")} htmlFor={`${id}-debited`}>
        <Input
          id={`${id}-debited`}
          name="debited"
          inputMode="decimal"
          numeric
          value={debited}
          onChange={(event) => setDebited(event.target.value)}
        />
      </Field>
      <Field label={t("fee")} htmlFor={`${id}-fee`}>
        <Input
          id={`${id}-fee`}
          name="fee"
          inputMode="decimal"
          numeric
          value={fee}
          onChange={(event) => setFee(event.target.value)}
        />
      </Field>
      <Field label={t("invested")} htmlFor={`${id}-invested`}>
        <Input id={`${id}-invested`} readOnly value={invested} numeric />
      </Field>
      <div className="col-span-full">
        <Field label={t("note")} htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} name="note" maxLength={200} defaultValue={draft.note} />
        </Field>
      </div>
    </>
  );
}

function readDeposit(data: FormData) {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return { on: text("on"), debited: text("debited"), fee: text("fee"), note: text("note") };
}

/** The design's inline "Add deposit" card. */
export function AddDepositCard({
  fundId,
  draft,
  format,
}: {
  fundId: string;
  draft: DepositDraft;
  format: NumberFormat;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [key, setKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const { error, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readDeposit(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await saveDepositAction(fundId, null, input))) return;
      notify(t("toasts.deposit"));
      setKey((current) => current + 1);
    });
  }
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t("deposits.add.title")}</h2>
        <p className="text-sm text-muted">{t("deposits.add.hint")}</p>
      </div>
      <form key={key} onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
        <DepositFields draft={draft} format={format} id={id} />
        <ErrorLine error={error} />
        <div className="col-span-full flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            {t("deposits.add.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** "Edit" on a deposit row: the same fields in a dialog. */
export function EditDepositButton({
  fundId,
  draft,
  format,
  label,
}: {
  fundId: string;
  draft: DepositDraft;
  format: NumberFormat;
  label: string;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { error, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readDeposit(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await saveDepositAction(fundId, draft.id, input))) return;
      notify(t("toasts.deposit"));
      setOpen(false);
    });
  }
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("deposits.editTitle")}>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
          <DepositFields draft={draft} format={format} id={id} />
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("deposits.add.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Settings › Linked expense: the rule, switched on or off. */
export function DepositRuleForm({
  fundId,
  draft,
  accounts,
}: {
  fundId: string;
  draft: { payeeMatch: string; accountId: string; active: boolean };
  accounts: Accounts;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveDepositRuleAction(fundId, {
        payeeMatch: String(data.get("match") ?? ""),
        accountId: String(data.get("account") ?? ""),
        active: data.get("active") === "on",
      });
      if (ok(result)) notify(t("toasts.rule"));
    });
  }
  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <div className="col-span-full">
        <Checkbox name="active" defaultChecked={draft.active} label={t("settings.rule.active")} />
      </div>
      <Field label={t("settings.rule.match")} htmlFor={`${id}-match`}>
        <Input
          id={`${id}-match`}
          name="match"
          maxLength={80}
          className="font-mono"
          defaultValue={draft.payeeMatch}
        />
      </Field>
      <Field label={t("settings.rule.account")} htmlFor={`${id}-account`}>
        <Select id={`${id}-account`} name="account" defaultValue={draft.accountId}>
          <option value="">{t("settings.rule.anyAccount")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorLine error={error} />
      <div className="col-span-full flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {t("settings.rule.save")}
        </Button>
      </div>
    </form>
  );
}

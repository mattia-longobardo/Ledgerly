"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseAmount } from "@/modules/accounts/rules";
import { formatMoney, type NumberFormat } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  addToPocketAction,
  createPocketAction,
  recordWithdrawalAction,
  setPocketStateAction,
  updatePocketAction,
} from "../actions";

/** A pocket as the dialogs need it; amounts stay cents so the dialogs can add to them. */
export interface PocketSummary {
  id: string;
  name: string;
  state: "active" | "paused" | "archived";
  backingAccountId: string | null;
  accountName: string | null;
  balanceCents: Cents;
  /** What is free on the backing account, `null` when unknown or standalone. */
  freeCents: Cents | null;
  /** The amounts as the person would type them back, for the edit dialog. */
  targetInput: string;
  monthlyInput: string;
  startMonth: string;
}

export interface DialogContext {
  accounts: readonly { id: string; name: string }[];
  numberFormat: NumberFormat;
  today: string;
  thisMonth: string;
}

function useErrors() {
  const t = useTranslations("pockets");
  const [error, setError] = useState<string | null>(null);
  const known = [
    "invalid",
    "not_found",
    "invalid_account",
    "duplicate_name",
    "archived",
    "future_date",
    "insufficient",
  ];
  return {
    error,
    clear: () => setError(null),
    report: (result: ActionResult) => {
      if (result.ok) return true;
      setError(t(`errors.${known.includes(result.error) ? result.error : "failed"}` as "errors.failed"));
      return false;
    },
  };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  ) : null;
}

/** New pocket, or edit one (design modal "New pocket" / "Edit pocket"). */
export function PocketDialog({
  open,
  onOpenChange,
  pocket,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pocket: PocketSummary | null;
  context: DialogContext;
}) {
  const t = useTranslations("pockets");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState(pocket !== null && pocket.monthlyInput === "");
  const { error, clear, report } = useErrors();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      name: text("name"),
      color: null,
      backingAccountId: text("account") || null,
      target: text("target"),
      monthly: manual ? "" : text("monthly"),
      startMonth: `${text("start")}-01`,
    };
    startTransition(async () => {
      const result = pocket ? await updatePocketAction(pocket.id, input) : await createPocketAction(input);
      if (!report(result)) return;
      notify(t("toasts.saved"));
      onOpenChange(false);
      if (!pocket && result.ok && "id" in result) router.push(`/pockets?pocket=${result.id}`);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        clear();
        onOpenChange(next);
      }}
      title={pocket ? t("form.editTitle") : t("form.newTitle")}
      description={t("form.description")}
      width={520}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="col-span-full">
          <Field label={t("form.name")} htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" defaultValue={pocket?.name ?? ""} required maxLength={60} />
          </Field>
        </div>
        <Field label={t("form.account")} htmlFor={`${id}-account`}>
          <Select id={`${id}-account`} name="account" defaultValue={pocket?.backingAccountId ?? ""}>
            <option value="">{t("form.none")}</option>
            {context.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("form.target")} htmlFor={`${id}-target`}>
          <InputGroup suffix="€">
            <Input
              id={`${id}-target`}
              name="target"
              inputMode="decimal"
              numeric
              placeholder={t("form.targetPlaceholder")}
              defaultValue={pocket?.targetInput ?? ""}
            />
          </InputGroup>
        </Field>
        <Field label={t("form.accrues")} htmlFor={`${id}-accrues`}>
          <Select
            id={`${id}-accrues`}
            value={manual ? "manual" : "first"}
            onChange={(event) => setManual(event.target.value === "manual")}
          >
            <option value="first">{t("form.firstOfMonth")}</option>
            <option value="manual">{t("form.manually")}</option>
          </Select>
        </Field>
        <Field label={t("form.monthly")} htmlFor={`${id}-monthly`}>
          <InputGroup suffix="€">
            <Input
              id={`${id}-monthly`}
              name="monthly"
              inputMode="decimal"
              numeric
              disabled={manual}
              defaultValue={pocket?.monthlyInput ?? ""}
            />
          </InputGroup>
        </Field>
        <Field label={t("form.startMonth")} htmlFor={`${id}-start`}>
          <Input
            id={`${id}-start`}
            name="start"
            type="month"
            required
            defaultValue={(pocket?.startMonth ?? context.thisMonth).slice(0, 7)}
          />
        </Field>
        <p className="col-span-full text-sm text-muted">{t("form.note")}</p>
        <div className="col-span-full">
          <ErrorLine error={error} />
        </div>
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("form.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Add to <pocket>" (design Move modal): a deposit, with what is free and what the pocket becomes. */
export function AddToPocketDialog({
  open,
  onOpenChange,
  pocket,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pocket: PocketSummary;
  context: DialogContext;
}) {
  const t = useTranslations("pockets");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const { error, clear, report } = useErrors();
  const money = (cents: Cents | null) => formatMoney(cents, context.numberFormat);
  let typed: Cents = 0n;
  try {
    typed = amount.trim() === "" ? 0n : parseAmount(amount, context.numberFormat);
  } catch {
    typed = 0n;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const on = String(new FormData(event.currentTarget).get("on") ?? "");
    startTransition(async () => {
      if (!report(await addToPocketAction(pocket.id, { amount, on }))) return;
      notify(t("toasts.added", { amount: money(typed) }));
      setAmount("");
      onOpenChange(false);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        clear();
        onOpenChange(next);
      }}
      title={t("move.title", { name: pocket.name })}
      description={
        pocket.accountName
          ? t("move.descriptionAccount", { account: pocket.accountName })
          : t("move.descriptionStandalone")
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("move.amount")} htmlFor={`${id}-amount`}>
            <InputGroup suffix="€">
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                numeric
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </InputGroup>
          </Field>
          <Field label={t("move.date")} htmlFor={`${id}-on`}>
            <Input
              id={`${id}-on`}
              name="on"
              type="date"
              max={context.today}
              defaultValue={context.today}
              required
            />
          </Field>
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-sm text-muted tabular-nums">
          {pocket.accountName && (
            <span>
              {t("move.free", {
                account: pocket.accountName,
                amount: money(pocket.freeCents === null ? null : pocket.freeCents - typed),
              })}
            </span>
          )}
          <span>{t("move.after", { amount: money(pocket.balanceCents + typed) })}</span>
        </div>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("move.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Record withdrawal" (design): money spent from the pocket, with its purpose. */
export function WithdrawalDialog({
  open,
  onOpenChange,
  pocket,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pocket: PocketSummary;
  context: DialogContext;
}) {
  const t = useTranslations("pockets");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      const result = await recordWithdrawalAction(pocket.id, {
        amount: text("amount"),
        on: text("on"),
        reason: text("reason"),
      });
      if (!report(result)) return;
      notify(t("toasts.withdrawn"));
      onOpenChange(false);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        clear();
        onOpenChange(next);
      }}
      title={t("withdraw.title")}
      description={t("withdraw.description", { name: pocket.name })}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("withdraw.amount")} htmlFor={`${id}-amount`}>
            <Input id={`${id}-amount`} name="amount" inputMode="decimal" numeric autoFocus required />
          </Field>
          <Field label={t("withdraw.date")} htmlFor={`${id}-on`}>
            <Input
              id={`${id}-on`}
              name="on"
              type="date"
              max={context.today}
              defaultValue={context.today}
              required
            />
          </Field>
        </div>
        <Field label={t("withdraw.purpose")} htmlFor={`${id}-reason`}>
          <Input
            id={`${id}-reason`}
            name="reason"
            required
            maxLength={200}
            placeholder={t("withdraw.purposePlaceholder")}
          />
        </Field>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("withdraw.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Dialog = "add" | "withdraw" | "edit" | "new" | null;

/**
 * The pocket's buttons and the dialogs they open. `place` decides which: the top bar has the
 * design's primary and secondary action, the detail card all three plus the state menu, the list a
 * single "New pocket".
 */
export function PocketActions({
  place,
  pocket,
  context,
}: {
  place: "topbar" | "detail" | "new" | "empty";
  pocket: PocketSummary | null;
  context: DialogContext;
}) {
  const t = useTranslations("pockets");
  const [open, setOpen] = useState<Dialog>(null);
  const [, startTransition] = useTransition();
  const change = (dialog: Dialog) => (next: boolean) => setOpen(next ? dialog : null);

  function setState(state: "active" | "paused" | "archived", toast: string) {
    if (!pocket) return;
    startTransition(async () => {
      const result = await setPocketStateAction(pocket.id, state);
      notify(result.ok ? toast : t("errors.failed"), result.ok ? "success" : "error");
    });
  }

  const movable = pocket !== null && pocket.state !== "archived";
  return (
    <>
      {place === "new" && (
        <button
          type="button"
          onClick={() => setOpen("new")}
          className="focus-ring flex h-10 items-center justify-center rounded-card border border-dashed border-border2 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
        >
          + {t("list.new")}
        </button>
      )}
      {place === "empty" && (
        <Button variant="primary" onClick={() => setOpen("new")}>
          {t("empty.cta")}
        </Button>
      )}
      {place === "topbar" && movable && (
        <>
          <Button size="sm" onClick={() => setOpen("withdraw")}>
            {t("actions.withdraw")}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setOpen("add")}>
            {t("actions.add")}
          </Button>
        </>
      )}
      {place === "topbar" && !movable && (
        <Button size="sm" variant="primary" onClick={() => setOpen("new")}>
          {t("list.new")}
        </Button>
      )}
      {place === "detail" && pocket && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setOpen("add")} disabled={!movable}>
            {t("actions.add")}
          </Button>
          <Button size="sm" onClick={() => setOpen("withdraw")} disabled={!movable}>
            {t("actions.withdraw")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen("edit")}>
            {t("actions.edit")}
          </Button>
          <ActionMenu
            label={t("actions.more")}
            items={[
              pocket.state === "paused"
                ? { label: t("actions.resume"), onSelect: () => setState("active", t("toasts.resumed")) }
                : { label: t("actions.pause"), onSelect: () => setState("paused", t("toasts.paused")) },
              {
                label: t("actions.archive"),
                onSelect: () => setState("archived", t("toasts.archived")),
                danger: true,
              },
            ]}
          />
        </div>
      )}

      {(open === "new" || open === "edit") && (
        <PocketDialog
          open
          onOpenChange={change(open)}
          pocket={open === "edit" ? pocket : null}
          context={context}
        />
      )}
      {open === "add" && pocket && (
        <AddToPocketDialog open onOpenChange={change("add")} pocket={pocket} context={context} />
      )}
      {open === "withdraw" && pocket && (
        <WithdrawalDialog open onOpenChange={change("withdraw")} pocket={pocket} context={context} />
      )}
    </>
  );
}

/** "Restore" on an archived pocket. */
export function RestorePocket({ id, label, toast }: { id: string; label: string; toast: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setPocketStateAction(id, "active");
          if (result.ok) notify(toast);
        })
      }
    >
      {label}
    </Button>
  );
}

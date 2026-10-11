"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseAmount } from "@/modules/accounts/rules";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  addPlannedExpenseAction,
  addToPocketAction,
  createPocketAction,
  linkExpenseAction,
  removePlannedExpenseAction,
  setPocketStateAction,
  unlinkExpenseAction,
  updatePocketAction,
} from "../actions";
import type { LinkCandidate } from "../queries";

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
  locale: UiLocale;
  today: string;
  thisMonth: string;
  /** What "Link an expense" offers; only a standalone pocket's page reads them. */
  candidates?: readonly LinkCandidate[];
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
    "past_date",
    "backed",
    "not_expense",
    "already_linked",
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
      if (!pocket && result.ok && "id" in result) router.push(`/pockets/${result.id}`);
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

/** "Plan an expense": one expected on a day to come, which only lowers what the pocket would have left. */
export function PlannedExpenseDialog({
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
      const result = await addPlannedExpenseAction(pocket.id, {
        amount: text("amount"),
        dueOn: text("due"),
        description: text("description"),
      });
      if (!report(result)) return;
      notify(t("toasts.planned"));
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
      title={t("plan.title")}
      description={t("plan.description", { name: pocket.name })}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <Field label={t("plan.what")} htmlFor={`${id}-description`}>
          <Input
            id={`${id}-description`}
            name="description"
            required
            maxLength={200}
            autoFocus
            placeholder={t("plan.whatPlaceholder")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("plan.amount")} htmlFor={`${id}-amount`}>
            <InputGroup suffix="€">
              <Input id={`${id}-amount`} name="amount" inputMode="decimal" numeric required />
            </InputGroup>
          </Field>
          <Field label={t("plan.due")} htmlFor={`${id}-due`}>
            <Input
              id={`${id}-due`}
              name="due"
              type="date"
              min={context.today}
              defaultValue={context.today}
              required
            />
          </Field>
        </div>
        <p className="text-sm text-muted">{t("plan.note")}</p>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("plan.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Link an expense": files one of the recent expenses under a standalone pocket. */
export function LinkExpenseDialog({
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
  const candidates = context.candidates ?? [];
  const money = (cents: Cents) => formatMoney(-cents, context.numberFormat);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const transactionId = String(new FormData(event.currentTarget).get("expense") ?? "");
    startTransition(async () => {
      if (!report(await linkExpenseAction(pocket.id, transactionId))) return;
      notify(t("toasts.linked"));
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
      title={t("link.title")}
      description={t("link.description", { name: pocket.name })}
      width={520}
    >
      {candidates.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("link.empty")}</p>
          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <Field label={t("link.expense")} htmlFor={`${id}-expense`}>
            <Select id={`${id}-expense`} name="expense" required defaultValue={candidates[0].id}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {[
                    formatDate(candidate.on, "dayMonth", context.locale),
                    candidate.payee ?? t("expenses.noPayee"),
                    money(candidate.cents),
                    candidate.accountName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("link.submit")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Asks before something goes, and says afterwards that it went. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<boolean>;
}) {
  const t = useTranslations("pockets");
  const [pending, startTransition] = useTransition();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width={420}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("form.cancel")}</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (await onConfirm()) onOpenChange(false);
              })
            }
          >
            {confirm}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

/** "Remove" on a planned expense. */
export function RemovePlannedButton({ id, description }: { id: string; description: string }) {
  const t = useTranslations("pockets");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {t("planned.remove")}
        <span className="sr-only"> {description}</span>
      </Button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("planned.confirmTitle")}
          description={t("planned.confirmDescription", { description })}
          confirm={t("planned.remove")}
          onConfirm={async () => {
            const result = await removePlannedExpenseAction(id);
            notify(
              result.ok ? t("toasts.plannedRemoved", { description }) : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            return result.ok;
          }}
        />
      )}
    </>
  );
}

/** "Unlink" on an expense filed under a standalone pocket by hand. */
export function UnlinkExpenseButton({
  pocketId,
  transactionId,
  label,
}: {
  pocketId: string;
  transactionId: string;
  label: string;
}) {
  const t = useTranslations("pockets");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {t("expenses.unlink")}
        <span className="sr-only"> {label}</span>
      </Button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("expenses.confirmTitle")}
          description={t("expenses.confirmDescription", { label })}
          confirm={t("expenses.unlink")}
          onConfirm={async () => {
            const result = await unlinkExpenseAction(pocketId, transactionId);
            notify(
              result.ok ? t("toasts.unlinked", { label }) : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            return result.ok;
          }}
        />
      )}
    </>
  );
}

type Dialog = "add" | "plan" | "link" | "edit" | "new" | null;

/**
 * The pocket's buttons and the dialogs they open. `place` decides which: the top bar of a pocket's
 * page has its two main actions (of the list, "New pocket"), the detail card every action plus the
 * state menu, the list a single "New pocket".
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
  const router = useRouter();
  const [open, setOpen] = useState<Dialog>(null);
  const [, startTransition] = useTransition();
  const change = (dialog: Dialog) => (next: boolean) => setOpen(next ? dialog : null);

  function setState(state: "active" | "paused" | "archived", toast: string) {
    if (!pocket) return;
    startTransition(async () => {
      const result = await setPocketStateAction(pocket.id, state);
      notify(result.ok ? toast : t("errors.failed"), result.ok ? "success" : "error");
      if (result.ok && state === "archived") router.push("/pockets");
    });
  }

  const movable = pocket !== null && pocket.state !== "archived";
  const standalone = pocket !== null && pocket.backingAccountId === null;
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
          <Button size="sm" onClick={() => setOpen("plan")}>
            {t("actions.plan")}
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
          <Button size="sm" onClick={() => setOpen("plan")} disabled={!movable}>
            {t("actions.plan")}
          </Button>
          {standalone && (
            <Button size="sm" onClick={() => setOpen("link")} disabled={!movable}>
              {t("actions.link")}
            </Button>
          )}
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
      {open === "plan" && pocket && (
        <PlannedExpenseDialog open onOpenChange={change("plan")} pocket={pocket} context={context} />
      )}
      {open === "link" && pocket && (
        <LinkExpenseDialog open onOpenChange={change("link")} pocket={pocket} context={context} />
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

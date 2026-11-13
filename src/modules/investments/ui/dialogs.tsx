"use client";

import { useTranslations } from "next-intl";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { parseAmount } from "@/modules/accounts/rules";
import {
  formatDate,
  formatMoney,
  type NumberFormat,
  numberSeparators,
  type UiLocale,
} from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import {
  confirmKeyRevokedAction,
  confirmZeroAction,
  connectProviderAction,
  createManualServiceAction,
  deleteOperationAction,
  disconnectProviderAction,
  linkTransferAction,
  unlinkTransferAction,
  replaceKeyAction,
  syncNowAction,
  verifyKeyAction,
  recordOperationAction,
  reconcileAction,
  updateServiceUrlAction,
  updateServiceValueAction,
} from "../actions";
import { type AdjustmentClass, PRODUCTS, type InvestmentCategory } from "../rules";
import type { AssetChoice, LinkChoice } from "./dialog-rules";

export type { AssetChoice, LinkChoice } from "./dialog-rules";

// ——— Shared ——————————————————————————————————————————————————————————————————————————————

/** What every dialog of a service page needs to know about it. */
export interface ServiceContext {
  accountId: string;
  name: string;
  category: InvestmentCategory;
  /** The provider that syncs the service, by name; `null` for a manual one. */
  providerName: string | null;
  currency: string;
  numberFormat: NumberFormat;
  locale: UiLocale;
  today: string;
  mode: "assets" | "total" | null;
  synced: boolean;
  /** A manual service on an account typed by hand: "Update value" writes its balance (PERS-342). */
  valueEditable: boolean;
  valueCents: Cents | null;
  assets: readonly AssetChoice[];
  coveredProducts: readonly string[];
  linkOptions: { out: readonly LinkChoice[]; in: readonly LinkChoice[] };
}

const KNOWN_ERRORS = [
  "invalid",
  "not_found",
  "future_date",
  "not_eligible",
  "wrong_mode",
  "negative_cash",
  "no_value",
  "duplicate_asset",
  "duplicate_holding",
  "invalid_transaction",
  "already_linked",
  "not_editable",
  "before_period",
  "managed_locked",
  "unknown_provider",
  "invalid_credentials",
  "not_read_only",
  "provider_auth",
  "provider_unavailable",
  "rate_limited",
  "unsupported_currency",
  "already_connected",
  "not_connected",
  "cooldown",
  "different_account",
  "sync_failed",
  "sync_refused",
  "not_a_transfer",
];

function useErrors() {
  const t = useTranslations("investments");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    report: (result: { ok: true } | { ok: false; error: string }) => {
      if (result.ok) return true;
      setError(
        t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
      );
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

function Actions({ onCancel, pending, submit }: { onCancel: () => void; pending: boolean; submit: string }) {
  const t = useTranslations("investments");
  return (
    <div className="col-span-full flex justify-end gap-2">
      <Button onClick={onCancel}>{t("form.cancel")}</Button>
      <Button type="submit" variant="primary" disabled={pending}>
        {submit}
      </Button>
    </div>
  );
}

function Dialog({
  open,
  onOpenChange,
  title,
  description,
  width,
  onSubmit,
  clear,
  finalFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: 420 | 440 | 460 | 520;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  clear: () => void;
  /** The opener, when the dialog is mounted apart from it (a header command). */
  finalFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        clear();
        onOpenChange(next);
      }}
      title={title}
      description={description}
      width={width ?? 520}
      finalFocus={finalFocus}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {children}
      </form>
    </Modal>
  );
}

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
  const t = useTranslations("investments");
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

/** A dialog opened by a button, mounted only while open (its state starts fresh every time). */
function Opener({
  label,
  variant = "secondary",
  size = "sm",
  children,
}: {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  children: (close: (open: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && children(setOpen)}
    </>
  );
}

function tryAmount(input: string, format: NumberFormat): Cents | null {
  try {
    return input.trim() === "" ? null : parseAmount(input, format);
  } catch {
    return null;
  }
}

function DateField({
  id,
  label,
  value,
  onChange,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="date"
        required
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  currency,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <InputGroup suffix={currency}>
        <Input
          id={id}
          inputMode="decimal"
          numeric
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
    </Field>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="decimal"
        numeric
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

// ——— Catalog: the manual account —————————————————————————————————————————————————————————

export interface ExistingChoice {
  id: string;
  name: string;
  currency: string;
  type: string;
  balanceCents: Cents | null;
  reason: string | null;
  /** A manual service a provider can be connected to (manual → synced, §2.5). */
  manualService?: boolean;
  /** Read by Wallet: a manual service may show it, a provider may not write it (PERS-342). */
  synced?: boolean;
}

export function CreateManualServiceButton({
  existing,
  numberFormat,
  variant = "primary",
}: {
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("investments");
  return (
    <Opener label={t("actions.createManual")} variant={variant}>
      {(close) => (
        <ManualServiceDialog onOpenChange={close} existing={existing} numberFormat={numberFormat} />
      )}
    </Opener>
  );
}

function ManualServiceDialog({
  onOpenChange,
  existing,
  numberFormat,
}: {
  onOpenChange: (open: boolean) => void;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const eligible = existing.filter((one) => one.reason === null);
  const [accountId, setAccountId] = useState(eligible[0]?.id ?? "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");
    const category = text("category") as "accounts" | "broker" | "crypto";
    const name = existing.find((one) => one.id === accountId)?.name ?? "";
    startTransition(async () => {
      const result = await createManualServiceAction({ accountId, category, url: text("url") });
      if (!report(result)) return;
      notify(t("toasts.serviceCreated", { name }));
      onOpenChange(false);
      if (result.ok) router.push(`/investments/${result.accountId}` as Route);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t("manualForm.title")}
      description={t("manualForm.description")}
      onSubmit={onSubmit}
    >
      <div className="col-span-full">
        <Field label={t("manualForm.existing")} htmlFor={`${id}-account`} hint={t("manualForm.existingHint")}>
          {existing.length === 0 ? (
            <p className="text-sm text-muted">{t("manualForm.noExisting")}</p>
          ) : (
            <Select
              id={`${id}-account`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {existing.map((one) => (
                <option key={one.id} value={one.id} disabled={one.reason !== null}>
                  {t("manualForm.option", {
                    name: one.name,
                    balance: formatMoney(one.balanceCents, numberFormat, { currency: one.currency }),
                  })}
                  {one.reason !== null &&
                    ` — ${t(`manualForm.reasons.${one.reason}` as "manualForm.reasons.managed")}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t("manualForm.category")} htmlFor={`${id}-category`}>
        <Select id={`${id}-category`} name="category" defaultValue="broker">
          {(["accounts", "broker", "crypto"] as const).map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("manualForm.url")} htmlFor={`${id}-url`} hint={t("manualForm.urlHint")}>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          inputMode="url"
          maxLength={500}
          placeholder="https://www.directa.it"
        />
      </Field>
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || accountId === ""}
        submit={t("manualForm.submit")}
      />
    </Dialog>
  );
}

// ——— Operations recorded before (PERS-342: none is typed in the module any more) ————————————————

export interface OperationSummary {
  id: string;
  kind: string;
  on: string;
  origin: string;
  note: string | null;
  amountCents: Cents;
  validUntil: string | null;
  transactionId: string | null;
  holdingId: string | null;
  holdingName: string | null;
  unitPriceText: string | null;
  /** A correction's class (§4.9 of the UX design); `null` = `data`. */
  adjustmentClass?: AdjustmentClass | null;
}

/**
 * An operation's command: delete, only for one the person typed before (PERS-342). Nothing is
 * edited or added here any more: a manual service's money in and out are its account's movements.
 */
export function OperationMenu({
  operation,
  context,
}: {
  operation: OperationSummary;
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState(false);
  if (operation.origin !== "manual") return null;
  const date = formatDate(operation.on, "long", context.locale);
  const kind = t(`kinds.${operation.kind}` as "kinds.deposit");
  return (
    <>
      <ActionMenu
        label={t("actions.operationMenu", { date })}
        items={[{ label: t("actions.delete"), onSelect: () => setOpen(true), danger: true }]}
      />
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("confirm.deleteTitle")}
          description={t("confirm.deleteDescription", {
            kind,
            date,
            amount: formatMoney(operation.amountCents, context.numberFormat, { currency: context.currency }),
          })}
          confirm={t("actions.delete")}
          onConfirm={async () => {
            const result = await deleteOperationAction(context.accountId, operation.id);
            if (!result.ok) {
              notify(
                t(
                  `errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed",
                ),
                "error",
              );
              return false;
            }
            notify(t("toasts.deleted", { kind, date }));
            return true;
          }}
        />
      )}
    </>
  );
}

// ——— Positions: value, sell, close, reconcile ——————————————————————————————————————————————

export interface HoldingSummary {
  id: string;
  name: string;
  currency: string;
  origin: "manual" | "provider";
  product: string;
  byValue: boolean;
  quantityText: string | null;
  conflict: boolean;
  readingId: string | null;
  readingOn: string | null;
}

type HoldingKind = "valuation" | "sell" | "close";

export function HoldingMenu({ holding, context }: { holding: HoldingSummary; context: ServiceContext }) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState<HoldingKind | "reconcile" | null>(null);
  if (holding.origin !== "manual") return null;
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const items = [
    ...(context.mode === "assets"
      ? [
          { label: t("actions.value"), onSelect: () => setOpen("valuation") },
          { label: t("actions.sell"), onSelect: () => setOpen("sell") },
          { label: t("actions.close"), onSelect: () => setOpen("close") },
        ]
      : []),
    ...(holding.conflict ? [{ label: t("actions.reconcile"), onSelect: () => setOpen("reconcile") }] : []),
  ];
  if (items.length === 0) return null;
  return (
    <>
      <ActionMenu label={t("actions.holdingMenu", { name: holding.name })} items={items} />
      {open !== null && open !== "reconcile" && (
        <HoldingDialog onOpenChange={close} kind={open} holding={holding} context={context} />
      )}
      {open === "reconcile" && <ReconcileDialog onOpenChange={close} holding={holding} context={context} />}
    </>
  );
}

function HoldingDialog({
  onOpenChange,
  kind,
  holding,
  context,
}: {
  onOpenChange: (open: boolean) => void;
  kind: HoldingKind;
  holding: HoldingSummary;
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [how, setHow] = useState<"price" | "amount">(holding.byValue ? "amount" : "price");
  const separators = numberSeparators(context.numberFormat);
  const [quantity, setQuantity] = useState(
    kind === "close" && holding.quantityText ? holding.quantityText.replace(".", separators.decimal) : "",
  );
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [on, setOn] = useState(context.today);
  const [note, setNote] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const byPrice = how === "price";
    startTransition(async () => {
      const result = await recordOperationAction(context.accountId, {
        kind,
        on,
        holdingId: holding.id,
        amount: byPrice ? "" : amount,
        unitPrice: byPrice ? unitPrice : "",
        quantity: kind === "valuation" || !byPrice ? "" : quantity,
        fee: kind === "valuation" ? "" : fee,
        note,
      });
      if (!report(result)) return;
      notify(t("toasts.saved"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t(`holdingForm.${kind}`, { name: holding.name })}
      description={t(`holdingForm.${kind}Description`)}
      onSubmit={onSubmit}
    >
      {!holding.byValue && (
        <div className="col-span-full">
          <Segmented
            label={t("holdingForm.how")}
            value={how}
            onChange={setHow}
            options={[
              { value: "price", label: t("holdingForm.byPrice") },
              { value: "amount", label: t("holdingForm.byAmount") },
            ]}
          />
        </div>
      )}
      {how === "price" ? (
        <>
          {kind !== "valuation" && (
            <NumberField
              id={`${id}-quantity`}
              label={t("holdingForm.quantity")}
              value={quantity}
              onChange={setQuantity}
            />
          )}
          <MoneyField
            id={`${id}-price`}
            label={t("holdingForm.unitPrice")}
            value={unitPrice}
            onChange={setUnitPrice}
            currency={holding.currency}
            autoFocus
          />
        </>
      ) : (
        <MoneyField
          id={`${id}-amount`}
          label={kind === "valuation" ? t("holdingForm.value") : t("holdingForm.proceeds")}
          value={amount}
          onChange={setAmount}
          currency={holding.currency}
          autoFocus
        />
      )}
      {kind !== "valuation" && (
        <MoneyField
          id={`${id}-fee`}
          label={t("holdingForm.fee")}
          value={fee}
          onChange={setFee}
          currency={holding.currency}
        />
      )}
      <DateField id={`${id}-on`} label={t("form.date")} value={on} onChange={setOn} max={context.today} />
      <Field label={t("form.note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("form.save")} />
    </Dialog>
  );
}

export function ReconcileButton({ holding, context }: { holding: HoldingSummary; context: ServiceContext }) {
  const t = useTranslations("investments");
  return (
    <Opener label={t("actions.reconcile")} size="xs">
      {(close) => <ReconcileDialog onOpenChange={close} holding={holding} context={context} />}
    </Opener>
  );
}

function ReconcileDialog({
  onOpenChange,
  holding,
  context,
}: {
  onOpenChange: (open: boolean) => void;
  holding: HoldingSummary;
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [kind, setKind] = useState<"covered_by_provider" | "partial" | "outside_scope">(
    "covered_by_provider",
  );
  const [effectiveOn, setEffectiveOn] = useState(holding.readingOn ?? context.today);
  const [quantity, setQuantity] = useState("");
  const [product, setProduct] = useState(PRODUCTS.find((one) => one !== holding.product) ?? "custody");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await reconcileAction(context.accountId, {
        holdingId: holding.id,
        kind,
        effectiveOn,
        quantity,
        product,
        readingId: holding.readingId,
      });
      if (!report(result)) return;
      notify(t("toasts.reconciled"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t("reconcileForm.title", { name: holding.name })}
      description={t("reconcileForm.description")}
      onSubmit={onSubmit}
    >
      <div className="col-span-full">
        <Segmented
          label={t("reconcileForm.choice")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "covered_by_provider", label: t("reconcileForm.covered") },
            { value: "partial", label: t("reconcileForm.partial") },
            { value: "outside_scope", label: t("reconcileForm.outside") },
          ]}
        />
      </div>
      <DateField
        id={`${id}-on`}
        label={t("reconcileForm.effectiveOn")}
        value={effectiveOn}
        onChange={setEffectiveOn}
        max={context.today}
      />
      {kind === "partial" && (
        <NumberField
          id={`${id}-quantity`}
          label={t("reconcileForm.quantity")}
          value={quantity}
          onChange={setQuantity}
        />
      )}
      {kind === "outside_scope" && (
        <Field label={t("reconcileForm.product")} htmlFor={`${id}-product`}>
          <Select
            id={`${id}-product`}
            value={product}
            onChange={(event) => setProduct(event.target.value as typeof product)}
          >
            {PRODUCTS.filter((one) => one !== holding.product).map((one) => (
              <option key={one} value={one}>
                {t(`products.${one}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ErrorLine error={error} />
      <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("reconcileForm.submit")} />
    </Dialog>
  );
}

// ——— Small forms ————————————————————————————————————————————————————————————————————————————

export function ServiceUrlForm({ accountId, url }: { accountId: string; url: string | null }) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("url") ?? "");
        clear();
        startTransition(async () => {
          if (report(await updateServiceUrlAction(accountId, value))) notify(t("toasts.urlSaved"));
        });
      }}
    >
      <Field label={t("settings.url")} htmlFor={`${id}-url`} hint={t("manualForm.urlHint")}>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          inputMode="url"
          maxLength={500}
          defaultValue={url ?? ""}
        />
      </Field>
      <ErrorLine error={error} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {t("actions.saveUrl")}
      </Button>
    </form>
  );
}

export function ConfirmZeroButton({
  accountId,
  readingId,
  dateLabel,
}: {
  accountId: string;
  readingId: string;
  dateLabel: string;
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
        {t("actions.confirmZero")}
      </Button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("confirm.zeroTitle")}
          description={t("confirm.zeroDescription", { date: dateLabel })}
          confirm={t("actions.confirmZero")}
          onConfirm={async () => {
            const result = await confirmZeroAction(accountId, readingId);
            notify(
              result.ok ? t("toasts.zeroConfirmed") : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            return result.ok;
          }}
        />
      )}
    </>
  );
}

// ——— Transfers between the person's services (§2.4) ——————————————————————————————————————————

function useTransferAction() {
  const t = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    startTransition(async () => {
      const result = await action();
      notify(
        result.ok
          ? done
          : t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
        result.ok ? "success" : "error",
      );
      router.refresh();
    });
  return { pending, run, t };
}

/** "Link as transfer" on a proposal: both legs get one transfer group, nothing else changes. */
export function LinkTransferButton({
  accountId,
  withdrawalId,
  depositId,
  label,
}: {
  accountId: string;
  withdrawalId: string;
  depositId: string;
  /** What the proposal says, for the button's accessible name. */
  label: string;
}) {
  const { pending, run, t } = useTransferAction();
  return (
    <Button
      size="xs"
      variant="secondary"
      disabled={pending}
      aria-label={`${t("actions.linkTransfer")}: ${label}`}
      onClick={() =>
        run(() => linkTransferAction(accountId, withdrawalId, depositId), t("toasts.transferLinked"))
      }
    >
      {t("actions.linkTransfer")}
    </Button>
  );
}

/** "Unlink transfer" on a linked leg: both legs are plain deposits and withdrawals again. */
export function UnlinkTransferButton({
  accountId,
  eventId,
  label,
}: {
  accountId: string;
  eventId: string;
  label: string;
}) {
  const { pending, run, t } = useTransferAction();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      aria-label={`${t("actions.unlinkTransfer")}: ${label}`}
      onClick={() => run(() => unlinkTransferAction(accountId, eventId), t("toasts.transferUnlinked"))}
    >
      {t("actions.unlinkTransfer")}
    </Button>
  );
}

// ——— Connected services (§4.2, §4.3, §5) ——————————————————————————————————————————————————————

export interface ConnectableProvider {
  id: string;
  name: string;
  /** The account type its service is (D13): an exchange is `crypto`, a broker `investment`. */
  accountType: "investment" | "crypto";
  ipWhitelist: "supported" | "unsupported" | null;
  credentialFields: readonly string[];
  currencies: readonly string[] | null;
  defaultCurrency: string;
  url: string | null;
  revokeUrl: string | null;
}

/** The key fields of a provider: write only, never filled back, never kept by the browser. */
function KeyFields({ provider, id }: { provider: ConnectableProvider; id: string }) {
  const t = useTranslations("investments");
  return (
    <>
      {provider.credentialFields.map((field) => (
        <Field
          key={field}
          label={t(`connect.fields.${field}` as "connect.fields.api_key")}
          htmlFor={`${id}-${field}`}
        >
          <Input
            id={`${id}-${field}`}
            name={field}
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
          />
        </Field>
      ))}
    </>
  );
}

function keysOf(provider: ConnectableProvider, data: FormData): Record<string, string> {
  return Object.fromEntries(
    provider.credentialFields.map((field) => [field, String(data.get(field) ?? "").trim()]),
  );
}

export function ConnectProviderButton({
  provider,
  existing,
  numberFormat,
}: {
  provider: ConnectableProvider;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
}) {
  const t = useTranslations("investments");
  return (
    <Opener label={t("connect.open")} variant="primary">
      {(close) => (
        <ConnectDialog
          onOpenChange={close}
          provider={provider}
          existing={existing}
          numberFormat={numberFormat}
        />
      )}
    </Opener>
  );
}

function ConnectDialog({
  onOpenChange,
  provider,
  existing,
  numberFormat,
}: {
  onOpenChange: (open: boolean) => void;
  provider: ConnectableProvider;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const currencies = provider.currencies ?? [provider.defaultCurrency];
  const choices = existing.filter((one) => one.type === provider.accountType);
  // Message keys cannot hold a colon: `ccxt:binance` → `ccxt_binance`.
  const slug = provider.id.replace(/[^a-z0-9]/g, "_");
  // A provider writes the account: never one Wallet reads (PERS-342), which would have two writers.
  const usable = (one: ExistingChoice) =>
    (one.reason === null || one.manualService) && !one.synced && currencies.includes(one.currency);
  const [accountId, setAccountId] = useState(choices.find(usable)?.id ?? "");
  // Connected with a key that works from any IP (PERS-87 SEC-02): said here before the page opens.
  const [unrestricted, setUnrestricted] = useState<string | null>(null);

  if (unrestricted !== null) {
    const open = () => {
      onOpenChange(false);
      router.push(`/investments/${unrestricted}` as Route);
    };
    return (
      <Dialog
        open
        onOpenChange={open}
        clear={clear}
        title={t("connect.ipUnrestrictedTitle", { name: provider.name })}
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <p role="status" className="col-span-full text-sm text-warn">
          {t("connect.ipUnrestricted", { name: provider.name })}
        </p>
        <div className="col-span-full flex justify-end gap-2">
          <Button type="submit" variant="primary">
            {t("connect.openService")}
          </Button>
        </div>
      </Dialog>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const keys = keysOf(provider, data);
    startTransition(async () => {
      const result = await connectProviderAction(provider.id, keys, { kind: "existing", accountId });
      // The fields are cleared whatever happened: a key stays in the page no longer than needed.
      for (const field of provider.credentialFields) {
        const input = form.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      if (!report(result) || !result.ok) return;
      notify(t("toasts.connected", { name: provider.name }));
      if (result.ipRestricted === false) {
        setUnrestricted(result.accountId);
        return;
      }
      onOpenChange(false);
      router.push(`/investments/${result.accountId}` as Route);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t("connect.title", { name: provider.name })}
      description={t("connect.description")}
      onSubmit={onSubmit}
    >
      <ol className="col-span-full flex list-decimal flex-col gap-1 pl-5 text-sm">
        {(["1", "2", "3", "4"] as const).map((step) => (
          <li key={step}>{t(`connect.steps.${slug}.${step}` as "connect.steps.etoro.1")}</li>
        ))}
      </ol>
      <p className="col-span-full text-sm text-muted">
        {t("connect.readOnlyNote")}{" "}
        {t(provider.ipWhitelist === "supported" ? "connect.ipSuggested" : "connect.ipUnsupported", {
          name: provider.name,
        })}
      </p>
      <KeyFields provider={provider} id={id} />
      <div className="col-span-full">
        <Field
          label={t("manualForm.existing")}
          htmlFor={`${id}-account`}
          hint={t("connect.existingHint", { name: provider.name })}
        >
          {choices.length === 0 ? (
            <p className="text-sm text-muted">{t("manualForm.noExisting")}</p>
          ) : (
            <Select
              id={`${id}-account`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {choices.map((one) => (
                <option key={one.id} value={one.id} disabled={!usable(one)}>
                  {t("manualForm.option", {
                    name: one.name,
                    balance: formatMoney(one.balanceCents, numberFormat, { currency: one.currency }),
                  })}
                  {!currencies.includes(one.currency)
                    ? ` — ${t("connect.currencyNotSupported")}`
                    : one.synced
                      ? ` — ${t("manualForm.reasons.synced")}`
                      : !usable(one) && one.reason !== null
                        ? ` — ${t(`manualForm.reasons.${one.reason}` as "manualForm.reasons.managed")}`
                        : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || accountId === ""}
        submit={pending ? t("connect.checking") : t("connect.submit")}
      />
    </Dialog>
  );
}

/** "Sync now" (§4.3): a minute apart at least, which the service enforces (SEC-09). */
export function SyncNowButton({
  accountId,
  size = "sm",
  variant = "primary",
}: {
  accountId: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size={size}
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await syncNowAction(accountId);
          notifyOutcome(result, t("toasts.synced"), t);
          router.refresh();
        })
      }
    >
      {t("sync.now")}
    </Button>
  );
}

/** "Sync now" and "Verify" (§4.3): a minute apart at least, which the service enforces (SEC-09). */
export function SyncButtons({ accountId }: { accountId: string }) {
  const t = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-wrap gap-2">
      <SyncNowButton accountId={accountId} />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await verifyKeyAction(accountId);
            notifyOutcome(result, t("toasts.verified"), t);
            router.refresh();
          })
        }
      >
        {t("sync.verify")}
      </Button>
    </span>
  );
}

function notifyOutcome(
  result: { ok: true } | { ok: false; error: string },
  done: string,
  t: ReturnType<typeof useTranslations<"investments">>,
): void {
  notify(
    result.ok
      ? done
      : t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
    result.ok ? "success" : "error",
  );
}

export function ReplaceKeyButton({
  accountId,
  provider,
}: {
  accountId: string;
  provider: ConnectableProvider;
}) {
  const t = useTranslations("investments");
  return (
    <Opener label={t("sync.replace")}>
      {(close) => <ReplaceKeyDialog onOpenChange={close} accountId={accountId} provider={provider} />}
    </Opener>
  );
}

function ReplaceKeyDialog({
  onOpenChange,
  accountId,
  provider,
}: {
  onOpenChange: (open: boolean) => void;
  accountId: string;
  provider: ConnectableProvider;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const keys = keysOf(provider, new FormData(form));
    startTransition(async () => {
      const result = await replaceKeyAction(accountId, keys);
      for (const field of provider.credentialFields) {
        const input = form.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      if (!report(result)) return;
      notify(t("toasts.keyReplaced"));
      onOpenChange(false);
      router.refresh();
    });
  }
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      width={460}
      title={t("sync.replaceTitle", { name: provider.name })}
      description={t("sync.replaceDescription")}
      onSubmit={onSubmit}
    >
      <KeyFields provider={provider} id={id} />
      <ErrorLine error={error} />
      <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("connect.submit")} />
    </Dialog>
  );
}

export function DisconnectButton({ accountId, name }: { accountId: string; name: string }) {
  const t = useTranslations("investments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        {t("sync.disconnect")}
      </Button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("confirm.disconnectTitle", { name })}
          description={t("confirm.disconnectDescription")}
          confirm={t("sync.disconnect")}
          onConfirm={async () => {
            const result = await disconnectProviderAction(accountId);
            notify(
              result.ok ? t("toasts.disconnected", { name }) : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            if (result.ok) router.refresh();
            return result.ok;
          }}
        />
      )}
    </>
  );
}

export function ConfirmRevokedButton({ accountId }: { accountId: string }) {
  const t = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await confirmKeyRevokedAction(accountId);
          notify(result.ok ? t("toasts.revoked") : t("errors.failed"), result.ok ? "success" : "error");
          router.refresh();
        })
      }
    >
      {t("sync.revokedConfirm")}
    </Button>
  );
}

// ——— The service's header (docs/design/investments-ux.md §3.2, U3) ———————————————————————————

type HeaderDialog = "value" | "replace" | "disconnect";

/** The dialog a header command opens; one at a time, mounted only while open. */
function HeaderDialogs({
  open,
  setOpen,
  context,
  provider,
  opener,
}: {
  open: HeaderDialog | null;
  setOpen: (open: HeaderDialog | null) => void;
  context: ServiceContext;
  provider: ConnectableProvider | null;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("investments");
  const router = useRouter();
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  if (open === null) return null;
  if (open === "value") return <UpdateValueDialog onOpenChange={close} context={context} opener={opener} />;
  if (open === "replace")
    return provider ? (
      <ReplaceKeyDialog onOpenChange={close} accountId={context.accountId} provider={provider} />
    ) : null;
  return (
    <ConfirmDialog
      open
      onOpenChange={close}
      title={t("confirm.disconnectTitle", { name: context.name })}
      description={t("confirm.disconnectDescription")}
      confirm={t("sync.disconnect")}
      onConfirm={async () => {
        const result = await disconnectProviderAction(context.accountId);
        notify(
          result.ok ? t("toasts.disconnected", { name: context.name }) : t("errors.failed"),
          result.ok ? "success" : "error",
        );
        if (result.ok) router.refresh();
        return result.ok;
      }}
    />
  );
}

/**
 * "Update value" of a manual service (PERS-342): the value read at the broker on a day, saved as
 * the account's balance in Accounts — the one source of the value.
 */
function UpdateValueDialog({
  onOpenChange,
  context,
  opener,
}: {
  onOpenChange: (open: boolean) => void;
  context: ServiceContext;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [on, setOn] = useState(context.today);
  const [amount, setAmount] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateServiceValueAction(context.accountId, { on, amount });
      if (!report(result)) return;
      notify(t("toasts.valueUpdated", { name: context.name }));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t("valueForm.title", { name: context.name })}
      description={t("valueForm.description")}
      onSubmit={onSubmit}
      finalFocus={opener}
    >
      <MoneyField
        id={`${id}-amount`}
        label={t("valueForm.amount")}
        value={amount}
        onChange={setAmount}
        currency={context.currency}
        autoFocus
      />
      <DateField id={`${id}-on`} label={t("form.date")} value={on} onChange={setOn} max={context.today} />
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || tryAmount(amount, context.numberFormat) === null}
        submit={t("valueForm.submit")}
      />
    </Dialog>
  );
}

/**
 * The commands of a service (§3.2, PERS-342). A synced one: "Sync", and the key in `⋯` — nothing
 * that moves its value. A manual one on an account typed by hand: "Update value", the only
 * command. A manual one on an account Wallet reads: none, the value is Wallet's.
 */
export function ServiceActions({
  context,
  provider,
  connected,
}: {
  context: ServiceContext;
  provider: ConnectableProvider | null;
  connected: boolean;
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState<HeaderDialog | null>(null);
  const valueButton = useRef<HTMLButtonElement>(null);
  const more = [
    ...(connected && provider
      ? [{ label: t("sync.replace"), onSelect: () => setOpen("replace" as const) }]
      : []),
    ...(connected
      ? [{ label: t("sync.disconnect"), onSelect: () => setOpen("disconnect" as const), danger: true }]
      : []),
  ];
  return (
    <span className="flex flex-wrap items-center gap-2">
      {context.synced
        ? connected && <SyncNowButton accountId={context.accountId} />
        : context.valueEditable && (
            <Button ref={valueButton} variant="primary" onClick={() => setOpen("value")}>
              {t("header.updateValue")}
            </Button>
          )}
      {more.length > 0 && <ActionMenu label={t("actions.more")} items={more} />}
      <HeaderDialogs
        open={open}
        setOpen={setOpen}
        context={context}
        provider={provider}
        opener={valueButton}
      />
    </span>
  );
}

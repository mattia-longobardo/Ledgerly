"use client";

import { useTranslations } from "next-intl";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useMemo, useState, useTransition } from "react";
import { parseAmount } from "@/modules/accounts/rules";
import { daysBetween, isCivilDate } from "@/platform/dates";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  type NumberFormat,
  numberSeparators,
  type UiLocale,
} from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import {
  addAssetAction,
  confirmKeyRevokedAction,
  confirmZeroAction,
  connectProviderAction,
  convertModeAction,
  createManualServiceAction,
  deleteOperationAction,
  disconnectProviderAction,
  replaceKeyAction,
  syncNowAction,
  verifyKeyAction,
  type OperationFormInput,
  recordOperationAction,
  reconcileAction,
  updateOperationAction,
  updateServiceUrlAction,
} from "../actions";
import {
  ASSET_CLASSES,
  type AssetClass,
  parseDecimal,
  plainDecimal,
  positionCents,
  PRICE_SCALE,
  PRODUCTS,
  QUANTITY_SCALE,
} from "../rules";
import { productLabel } from "./labels";

// ——— Shared ——————————————————————————————————————————————————————————————————————————————

export interface LinkChoice {
  id: string;
  on: string;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

export interface AssetChoice {
  id: string;
  name: string;
  class: AssetClass;
  symbol: string | null;
  isin: string | null;
  currency: string;
}

/** What every dialog of a service page needs to know about it. */
export interface ServiceContext {
  accountId: string;
  name: string;
  currency: string;
  numberFormat: NumberFormat;
  locale: UiLocale;
  today: string;
  mode: "assets" | "total" | null;
  synced: boolean;
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
  "sync_failed",
  "sync_refused",
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
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: 420 | 440 | 460 | 520;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  clear: () => void;
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

function tryDecimal(input: string, format: NumberFormat, scale: number): bigint | null {
  try {
    return input.trim() === "" ? null : parseDecimal(plainDecimal(input, numberSeparators(format)), scale);
  } catch {
    return null;
  }
}

function linkLabel(choice: LinkChoice, context: ServiceContext): string {
  return [
    formatDate(choice.on, "long", context.locale),
    choice.payee,
    choice.accountName,
    formatMoney(choice.cents, context.numberFormat),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** How far a bank movement is from the date being typed; a half-typed date is no date. */
function daysApart(choice: string, on: string): number {
  return isCivilDate(on) ? Math.abs(daysBetween(choice, on)) : 0;
}

/** The bank movements worth offering: the same amount first, then the nearest to the date. */
function rankedChoices(
  choices: readonly LinkChoice[],
  on: string,
  cents: Cents | null,
  keep: string | null,
): LinkChoice[] {
  const ranked = [...choices]
    .sort((a, b) => {
      const sameA = cents !== null && a.cents === cents ? 0 : 1;
      const sameB = cents !== null && b.cents === cents ? 0 : 1;
      return (
        sameA - sameB ||
        daysApart(a.on, on) - daysApart(b.on, on) ||
        (a.on > b.on ? -1 : a.on < b.on ? 1 : a.id < b.id ? -1 : 1)
      );
    })
    .slice(0, 40);
  const kept = keep ? choices.find((choice) => choice.id === keep) : undefined;
  return kept && !ranked.some((choice) => choice.id === kept.id) ? [kept, ...ranked] : ranked;
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
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [mode, setMode] = useState<"assets" | "total">("assets");
  const eligible = existing.filter((one) => one.reason === null);
  const [accountId, setAccountId] = useState(eligible[0]?.id ?? "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");
    const category = text("category") as "accounts" | "broker" | "crypto";
    const name =
      target === "new" ? text("name").trim() : (existing.find((one) => one.id === accountId)?.name ?? "");
    startTransition(async () => {
      const result = await createManualServiceAction(
        target === "new"
          ? {
              target,
              name,
              category,
              currency: text("currency").trim().toUpperCase(),
              mode,
              url: text("url"),
            }
          : { target, accountId, category, mode, url: text("url") },
      );
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
        <Segmented
          label={t("manualForm.destination")}
          value={target}
          onChange={setTarget}
          options={[
            { value: "new", label: t("manualForm.newAccount") },
            { value: "existing", label: t("manualForm.existingAccount") },
          ]}
        />
      </div>
      {target === "new" ? (
        <>
          <Field label={t("manualForm.name")} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={80}
              autoFocus
              placeholder={t("manualForm.namePlaceholder")}
            />
          </Field>
          <Field
            label={t("manualForm.currency")}
            htmlFor={`${id}-currency`}
            hint={t("manualForm.currencyHint")}
          >
            <Input
              id={`${id}-currency`}
              name="currency"
              required
              maxLength={3}
              defaultValue="EUR"
              className="uppercase"
              autoCapitalize="characters"
            />
          </Field>
        </>
      ) : (
        <div className="col-span-full">
          <Field
            label={t("manualForm.existing")}
            htmlFor={`${id}-account`}
            hint={t("manualForm.existingHint")}
          >
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
                      ` — ${t(`manualForm.reasons.${one.reason}` as "manualForm.reasons.synced")}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
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
      <div className="col-span-full flex flex-col gap-1.5">
        <Segmented
          label={t("manualForm.mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "assets", label: t("modes.assets") },
            { value: "total", label: t("modes.total") },
          ]}
        />
        <p className="text-sm text-muted">{t("manualForm.modeHint")}</p>
      </div>
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || (target === "existing" && accountId === "")}
        submit={t("manualForm.submit")}
      />
    </Dialog>
  );
}

// ——— Asset picker ————————————————————————————————————————————————————————————————————————

type AssetPick =
  | { id: string }
  | { create: { class: AssetClass; name: string; isin: string; symbol: string; currency: string } };

function AssetPicker({
  prefix,
  assets,
  onChange,
  defaultCurrency,
}: {
  prefix: string;
  assets: readonly AssetChoice[];
  onChange: (pick: AssetPick | null, currency: string) => void;
  defaultCurrency: string;
}) {
  const t = useTranslations("investments");
  const [source, setSource] = useState<"existing" | "create">(assets.length > 0 ? "existing" : "create");
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState<string>("");
  const [selected, setSelected] = useState(assets[0]?.id ?? "");
  const [draft, setDraft] = useState({
    class: "etf" as AssetClass,
    name: "",
    isin: "",
    symbol: "",
    currency: defaultCurrency,
  });
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (klass === "" || asset.class === klass) &&
        (needle === "" ||
          asset.name.toLowerCase().includes(needle) ||
          (asset.isin ?? "").toLowerCase().includes(needle) ||
          (asset.symbol ?? "").toLowerCase().includes(needle)),
    );
  }, [assets, query, klass]);

  const emit = (nextSource: "existing" | "create", id: string, nextDraft: typeof draft) => {
    if (nextSource === "existing") {
      const asset = assets.find((one) => one.id === id);
      onChange(asset ? { id: asset.id } : null, asset?.currency ?? defaultCurrency);
    } else {
      onChange(nextDraft.name.trim() === "" ? null : { create: nextDraft }, nextDraft.currency.toUpperCase());
    }
  };
  const pickFirst = (list: readonly AssetChoice[]) => {
    const keep = list.some((one) => one.id === selected) ? selected : (list[0]?.id ?? "");
    setSelected(keep);
    emit("existing", keep, draft);
  };
  const editDraft = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    emit("create", "", next);
  };

  return (
    <>
      <div className="col-span-full">
        <Segmented
          label={t("assetForm.source")}
          value={source}
          onChange={(next) => {
            setSource(next);
            emit(next, selected, draft);
          }}
          options={[
            { value: "existing", label: t("assetForm.existing"), disabled: assets.length === 0 },
            { value: "create", label: t("assetForm.create") },
          ]}
        />
      </div>
      {source === "existing" ? (
        <>
          <Field label={t("assetForm.search")} htmlFor={`${prefix}-search`}>
            <Input
              id={`${prefix}-search`}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                const needle = event.target.value.trim().toLowerCase();
                pickFirst(
                  assets.filter(
                    (asset) =>
                      (klass === "" || asset.class === klass) &&
                      (needle === "" ||
                        asset.name.toLowerCase().includes(needle) ||
                        (asset.isin ?? "").toLowerCase().includes(needle) ||
                        (asset.symbol ?? "").toLowerCase().includes(needle)),
                  ),
                );
              }}
            />
          </Field>
          <Field label={t("assetForm.classFilter")} htmlFor={`${prefix}-filter`}>
            <Select
              id={`${prefix}-filter`}
              value={klass}
              onChange={(event) => {
                setKlass(event.target.value);
                pickFirst(
                  assets.filter((asset) => event.target.value === "" || asset.class === event.target.value),
                );
              }}
            >
              <option value="">{t("assetForm.allClasses")}</option>
              {ASSET_CLASSES.map((one) => (
                <option key={one} value={one}>
                  {t(`classes.${one}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-full">
            <Field label={t("assetForm.asset")} htmlFor={`${prefix}-asset`}>
              {filtered.length === 0 ? (
                <p className="text-sm text-muted">{t("assetForm.noMatch")}</p>
              ) : (
                <Select
                  id={`${prefix}-asset`}
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    emit("existing", event.target.value, draft);
                  }}
                >
                  {filtered.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {[asset.name, asset.symbol, asset.isin, asset.currency].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label={t("assetForm.class")} htmlFor={`${prefix}-class`}>
            <Select
              id={`${prefix}-class`}
              value={draft.class}
              onChange={(event) => editDraft({ class: event.target.value as AssetClass })}
            >
              {ASSET_CLASSES.map((one) => (
                <option key={one} value={one}>
                  {t(`classes.${one}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("assetForm.name")} htmlFor={`${prefix}-name`}>
            <Input
              id={`${prefix}-name`}
              maxLength={120}
              value={draft.name}
              onChange={(event) => editDraft({ name: event.target.value })}
            />
          </Field>
          <Field label={t("assetForm.isin")} htmlFor={`${prefix}-isin`}>
            <Input
              id={`${prefix}-isin`}
              maxLength={12}
              className="uppercase"
              value={draft.isin}
              onChange={(event) => editDraft({ isin: event.target.value })}
            />
          </Field>
          <Field label={t("assetForm.symbol")} htmlFor={`${prefix}-symbol`}>
            <Input
              id={`${prefix}-symbol`}
              maxLength={20}
              className="uppercase"
              value={draft.symbol}
              onChange={(event) => editDraft({ symbol: event.target.value })}
            />
          </Field>
          <Field label={t("assetForm.currency")} htmlFor={`${prefix}-currency`}>
            <Input
              id={`${prefix}-currency`}
              maxLength={3}
              className="uppercase"
              value={draft.currency}
              onChange={(event) => editDraft({ currency: event.target.value.toUpperCase() })}
            />
          </Field>
        </>
      )}
    </>
  );
}

function ProductSelect({
  id,
  value,
  onChange,
  covered,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  covered: readonly string[];
}) {
  const t = useTranslations("investments");
  return (
    <Field
      label={t("assetForm.product")}
      htmlFor={id}
      hint={
        covered.length > 0
          ? t("assetForm.covered", { products: covered.map((one) => productLabel(one, t)).join(", ") })
          : undefined
      }
    >
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {PRODUCTS.map((product) => (
          <option key={product} value={product}>
            {t(`products.${product}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// ——— Add asset (§4.4) ——————————————————————————————————————————————————————————————————————

export function AddAssetButton({
  context,
  variant = "primary",
}: {
  context: ServiceContext;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("investments");
  return (
    <Opener label={t("actions.addAsset")} variant={variant}>
      {(close) => <AddAssetDialog onOpenChange={close} context={context} />}
    </Opener>
  );
}

function AddAssetDialog({
  onOpenChange,
  context,
}: {
  onOpenChange: (open: boolean) => void;
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [pick, setPick] = useState<AssetPick | null>(context.assets[0] ? { id: context.assets[0].id } : null);
  const [currency, setCurrency] = useState(context.assets[0]?.currency ?? context.currency);
  const [product, setProduct] = useState(context.synced ? "earn" : "custody");
  const [on, setOn] = useState(context.today);
  const [how, setHow] = useState<"quantity" | "total">("quantity");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [total, setTotal] = useState("");
  const [fee, setFee] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [note, setNote] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pick === null) {
      report({ ok: false, error: "invalid" });
      return;
    }
    startTransition(async () => {
      const result = await addAssetAction(context.accountId, {
        asset: pick,
        product,
        on,
        quantity: how === "quantity" ? quantity : "",
        unitPrice: how === "quantity" ? unitPrice : "",
        total: how === "total" ? total : "",
        fee,
        fxRate: currency === context.currency ? "" : fxRate,
        note,
      });
      if (!report(result)) return;
      notify(t("toasts.assetAdded"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={t("assetForm.title")}
      description={t("assetForm.description")}
      onSubmit={onSubmit}
    >
      <AssetPicker
        prefix={id}
        assets={context.assets}
        defaultCurrency={context.currency}
        onChange={(next, nextCurrency) => {
          setPick(next);
          setCurrency(nextCurrency);
        }}
      />
      <ProductSelect
        id={`${id}-product`}
        value={product}
        onChange={setProduct}
        covered={context.coveredProducts}
      />
      <DateField id={`${id}-on`} label={t("form.date")} value={on} onChange={setOn} max={context.today} />
      <div className="col-span-full">
        <Segmented
          label={t("assetForm.priceMode")}
          value={how}
          onChange={setHow}
          options={[
            { value: "quantity", label: t("assetForm.byQuantity") },
            { value: "total", label: t("assetForm.byTotal") },
          ]}
        />
      </div>
      {how === "quantity" ? (
        <>
          <NumberField
            id={`${id}-quantity`}
            label={t("assetForm.quantity")}
            value={quantity}
            onChange={setQuantity}
          />
          <MoneyField
            id={`${id}-price`}
            label={t("assetForm.unitPrice")}
            value={unitPrice}
            onChange={setUnitPrice}
            currency={currency}
          />
        </>
      ) : (
        <MoneyField
          id={`${id}-total`}
          label={t("assetForm.total")}
          value={total}
          onChange={setTotal}
          currency={currency}
        />
      )}
      <MoneyField
        id={`${id}-fee`}
        label={t("assetForm.fee")}
        value={fee}
        onChange={setFee}
        currency={currency}
      />
      {currency !== context.currency && (
        <Field
          label={t("assetForm.fxRate")}
          htmlFor={`${id}-fx`}
          hint={t("assetForm.fxHint", { account: context.currency, asset: currency })}
        >
          <Input
            id={`${id}-fx`}
            inputMode="decimal"
            numeric
            value={fxRate}
            onChange={(event) => setFxRate(event.target.value)}
          />
        </Field>
      )}
      <Field label={t("form.note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("assetForm.submit")} />
    </Dialog>
  );
}

// ——— Account operations: deposit, withdrawal, account value, adjustment ———————————————————————

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
}

type AccountKind = "deposit" | "withdrawal" | "account_valuation" | "adjustment";

export function OperationButton({
  kind,
  context,
  variant = "secondary",
  label,
}: {
  kind: AccountKind;
  context: ServiceContext;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const t = useTranslations("investments");
  return (
    <Opener label={label ?? t(`operationForm.titles.${kind}`)} variant={variant}>
      {(close) => <OperationDialog onOpenChange={close} kind={kind} context={context} operation={null} />}
    </Opener>
  );
}

function OperationDialog({
  onOpenChange,
  kind,
  context,
  operation,
}: {
  onOpenChange: (open: boolean) => void;
  kind: AccountKind | "valuation";
  context: ServiceContext;
  operation: OperationSummary | null;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const absolute = operation
    ? operation.amountCents < 0n && kind !== "adjustment"
      ? -operation.amountCents
      : operation.amountCents
    : null;
  const [amount, setAmount] = useState(
    absolute === null ? "" : formatAmountInput(absolute, context.numberFormat),
  );
  const [unitPrice, setUnitPrice] = useState(
    operation?.unitPriceText?.replace(".", numberSeparators(context.numberFormat).decimal) ?? "",
  );
  const [on, setOn] = useState(operation?.on ?? context.today);
  const [validUntil, setValidUntil] = useState(operation?.validUntil ?? "");
  const [note, setNote] = useState(operation?.note ?? "");
  const [link, setLink] = useState(operation?.transactionId ?? "");
  const linkable = kind === "deposit" || kind === "withdrawal";
  const choices = linkable
    ? rankedChoices(
        kind === "deposit" ? context.linkOptions.out : context.linkOptions.in,
        on,
        tryAmount(amount, context.numberFormat),
        operation?.transactionId ?? null,
      )
    : [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: OperationFormInput = {
      kind,
      on,
      amount: kind === "valuation" && unitPrice.trim() !== "" ? "" : amount,
      unitPrice: kind === "valuation" ? unitPrice : undefined,
      holdingId: operation?.holdingId ?? null,
      validUntil: kind === "adjustment" ? validUntil || null : null,
      transactionId: linkable && choices.some((choice) => choice.id === link) ? link : null,
      note,
    };
    startTransition(async () => {
      const result = operation
        ? await updateOperationAction(context.accountId, operation.id, input)
        : await recordOperationAction(context.accountId, input);
      if (!report(result)) return;
      notify(t("toasts.saved"));
      onOpenChange(false);
    });
  }

  const title = operation
    ? t("operationForm.editTitle", { kind: t(`kinds.${kind}`) })
    : t(`operationForm.titles.${kind}`);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={title}
      description={t(`operationForm.descriptions.${kind}`)}
      onSubmit={onSubmit}
    >
      {kind === "valuation" && operation?.unitPriceText !== null && operation?.unitPriceText !== undefined ? (
        <MoneyField
          id={`${id}-price`}
          label={t("holdingForm.unitPrice")}
          value={unitPrice}
          onChange={setUnitPrice}
          currency={context.currency}
          autoFocus
        />
      ) : (
        <MoneyField
          id={`${id}-amount`}
          label={
            kind === "adjustment"
              ? t("operationForm.delta")
              : kind === "account_valuation" || kind === "valuation"
                ? t("operationForm.value")
                : t("form.amount")
          }
          hint={kind === "adjustment" ? t("operationForm.deltaHint") : undefined}
          value={amount}
          onChange={setAmount}
          currency={context.currency}
          autoFocus
        />
      )}
      <DateField
        id={`${id}-on`}
        label={kind === "adjustment" ? t("adjustments.from") : t("form.date")}
        value={on}
        onChange={setOn}
        max={context.today}
      />
      {kind === "adjustment" && (
        <Field
          label={t("operationForm.validUntil")}
          htmlFor={`${id}-until`}
          hint={t("operationForm.validUntilHint")}
        >
          <Input
            id={`${id}-until`}
            type="date"
            min={on}
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </Field>
      )}
      <Field
        label={kind === "adjustment" ? t("operationForm.reason") : t("form.note")}
        htmlFor={`${id}-note`}
      >
        <Input
          id={`${id}-note`}
          maxLength={200}
          required={kind === "adjustment"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      {linkable && (
        <div className="col-span-full">
          <Field
            label={kind === "deposit" ? t("operationForm.linkOut") : t("operationForm.linkIn")}
            htmlFor={`${id}-link`}
            hint={t("operationForm.linkHint")}
          >
            <Select id={`${id}-link`} value={link} onChange={(event) => setLink(event.target.value)}>
              <option value="">{t("operationForm.noLink")}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {linkLabel(choice, context)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <ErrorLine error={error} />
      <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("form.save")} />
    </Dialog>
  );
}

const EDITABLE = new Set(["deposit", "withdrawal", "account_valuation", "valuation", "adjustment"]);

/** An operation's commands: edit (single-leg kinds) and delete, only for the person's own. */
export function OperationMenu({
  operation,
  context,
}: {
  operation: OperationSummary;
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  if (operation.origin !== "manual") return null;
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const date = formatDate(operation.on, "long", context.locale);
  const kind = t(`kinds.${operation.kind}` as "kinds.deposit");
  const items = [
    ...(EDITABLE.has(operation.kind) ? [{ label: t("actions.edit"), onSelect: () => setOpen("edit") }] : []),
    { label: t("actions.delete"), onSelect: () => setOpen("delete"), danger: true },
  ];
  return (
    <>
      <ActionMenu label={t("actions.operationMenu", { date })} items={items} />
      {open === "edit" && (
        <OperationDialog
          onOpenChange={close}
          kind={operation.kind as AccountKind}
          context={context}
          operation={operation}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={close}
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

// ——— Conversion (§2.5) ——————————————————————————————————————————————————————————————————————

interface PositionDraft {
  key: number;
  pick: AssetPick | null;
  currency: string;
  product: string;
  how: "quantity" | "total";
  quantity: string;
  unitPrice: string;
  total: string;
}

export function ConversionButton({
  context,
  variant = "secondary",
}: {
  context: ServiceContext;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("investments");
  if (context.mode === null || context.synced) return null;
  const to = context.mode === "total" ? "assets" : "total";
  return (
    <Opener label={to === "assets" ? t("actions.toAssets") : t("actions.toTotal")} variant={variant}>
      {(close) => <ConversionDialog onOpenChange={close} to={to} context={context} />}
    </Opener>
  );
}

function ConversionDialog({
  onOpenChange,
  to,
  context,
}: {
  onOpenChange: (open: boolean) => void;
  to: "assets" | "total";
  context: ServiceContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [accept, setAccept] = useState(false);
  const [nextKey, setNextKey] = useState(1);
  const money = (cents: Cents | null) =>
    formatMoney(cents, context.numberFormat, { currency: context.currency });

  const declared = positions.reduce<{ cents: Cents; foreign: boolean }>(
    (sum, position) => {
      if (position.currency !== context.currency) return { ...sum, foreign: true };
      const value =
        position.how === "quantity"
          ? (() => {
              const quantity = tryDecimal(position.quantity, context.numberFormat, QUANTITY_SCALE);
              const price = tryDecimal(position.unitPrice, context.numberFormat, PRICE_SCALE);
              return quantity === null || price === null ? 0n : positionCents(quantity, price);
            })()
          : (tryAmount(position.total, context.numberFormat) ?? 0n);
      return { ...sum, cents: sum.cents + value };
    },
    { cents: 0n, foreign: false },
  );
  const openingCash = context.valueCents === null ? null : context.valueCents - declared.cents;
  const negative = openingCash !== null && openingCash < 0n;

  const update = (key: number, patch: Partial<PositionDraft>) =>
    setPositions((list) => list.map((one) => (one.key === key ? { ...one, ...patch } : one)));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (to === "assets" && positions.some((one) => one.pick === null)) {
      report({ ok: false, error: "invalid" });
      return;
    }
    startTransition(async () => {
      const result = await convertModeAction(context.accountId, {
        to,
        acceptNegativeCash: accept,
        positions: positions.map((one) => ({
          asset: one.pick as { id: string },
          product: one.product,
          quantity: one.how === "quantity" ? one.quantity : "",
          unitPrice: one.how === "quantity" ? one.unitPrice : "",
          total: one.how === "total" ? one.total : "",
        })),
      });
      if (!report(result)) return;
      notify(t("toasts.converted"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      clear={clear}
      title={to === "assets" ? t("conversionForm.toAssetsTitle") : t("conversionForm.toTotalTitle")}
      description={
        context.valueCents === null
          ? t("conversionForm.noValue")
          : to === "assets"
            ? t("conversionForm.toAssetsDescription", { value: money(context.valueCents) })
            : t("conversionForm.toTotalDescription", { value: money(context.valueCents) })
      }
      onSubmit={onSubmit}
    >
      {to === "assets" && (
        <>
          {positions.map((position, index) => (
            <fieldset
              key={position.key}
              className="col-span-full grid grid-cols-2 gap-3 rounded-card border border-border p-3 max-sm:grid-cols-1"
            >
              <legend className="px-1 text-sm font-medium">
                {t("conversionForm.position", { n: index + 1 })}
              </legend>
              <AssetPicker
                prefix={`${id}-${position.key}`}
                assets={context.assets}
                defaultCurrency={context.currency}
                onChange={(pick, currency) => update(position.key, { pick, currency })}
              />
              <ProductSelect
                id={`${id}-${position.key}-product`}
                value={position.product}
                onChange={(product) => update(position.key, { product })}
                covered={[]}
              />
              <div className="col-span-full">
                <Segmented
                  label={t("assetForm.priceMode")}
                  value={position.how}
                  onChange={(how) => update(position.key, { how })}
                  options={[
                    { value: "quantity", label: t("assetForm.byQuantity") },
                    { value: "total", label: t("assetForm.byTotal") },
                  ]}
                />
              </div>
              {position.how === "quantity" ? (
                <>
                  <NumberField
                    id={`${id}-${position.key}-quantity`}
                    label={t("assetForm.quantity")}
                    value={position.quantity}
                    onChange={(quantity) => update(position.key, { quantity })}
                  />
                  <MoneyField
                    id={`${id}-${position.key}-price`}
                    label={t("assetForm.unitPrice")}
                    value={position.unitPrice}
                    onChange={(unitPrice) => update(position.key, { unitPrice })}
                    currency={position.currency}
                  />
                </>
              ) : (
                <MoneyField
                  id={`${id}-${position.key}-total`}
                  label={t("assetForm.total")}
                  value={position.total}
                  onChange={(total) => update(position.key, { total })}
                  currency={position.currency}
                />
              )}
              <div className="col-span-full flex justify-end">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setPositions((list) => list.filter((one) => one.key !== position.key))}
                >
                  {t("conversionForm.removePosition", { n: index + 1 })}
                </Button>
              </div>
            </fieldset>
          ))}
          <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={() => {
                const first = context.assets[0];
                setPositions((list) => [
                  ...list,
                  {
                    key: nextKey,
                    pick: first ? { id: first.id } : null,
                    currency: first?.currency ?? context.currency,
                    product: "custody",
                    how: "quantity",
                    quantity: "",
                    unitPrice: "",
                    total: "",
                  },
                ]);
                setNextKey((key) => key + 1);
              }}
            >
              {t("conversionForm.addPosition")}
            </Button>
            <p role="status" className={negative ? "text-sm font-medium text-warn" : "text-sm font-medium"}>
              {t("conversionForm.openingCash", { amount: money(openingCash) })}
            </p>
          </div>
          {declared.foreign && (
            <p className="col-span-full text-sm text-muted">{t("conversionForm.otherCurrency")}</p>
          )}
          {negative && (
            <div className="col-span-full flex flex-col gap-1">
              <p className="text-sm text-warn">{t("conversionForm.negative")}</p>
              <Checkbox
                label={t("conversionForm.acceptNegative")}
                checked={accept}
                onChange={(event) => setAccept(event.target.checked)}
              />
            </div>
          )}
        </>
      )}
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || context.valueCents === null}
        submit={t("conversionForm.submit")}
      />
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

// ——— Connected services (§4.2, §4.3, §5) ——————————————————————————————————————————————————————

export interface ConnectableProvider {
  id: string;
  name: string;
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
  const [target, setTarget] = useState<"new" | "existing">("new");
  const currencies = provider.currencies ?? [provider.defaultCurrency];
  const choices = existing.filter((one) => one.type === "investment");
  const usable = (one: ExistingChoice) =>
    (one.reason === null || one.manualService) && currencies.includes(one.currency);
  const [accountId, setAccountId] = useState(choices.find(usable)?.id ?? "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const keys = keysOf(provider, data);
    const name = String(data.get("name") ?? "").trim();
    const currency = String(data.get("currency") ?? provider.defaultCurrency);
    startTransition(async () => {
      const result = await connectProviderAction(
        provider.id,
        keys,
        target === "new" ? { kind: "new", name, currency } : { kind: "existing", accountId },
      );
      // The fields are cleared whatever happened: a key stays in the page no longer than needed.
      for (const field of provider.credentialFields) {
        const input = form.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      if (!report(result)) return;
      notify(t("toasts.connected", { name: provider.name }));
      onOpenChange(false);
      if (result.ok) router.push(`/investments/${result.accountId}` as Route);
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
          <li key={step}>{t(`connect.steps.${provider.id}.${step}` as "connect.steps.etoro.1")}</li>
        ))}
      </ol>
      <p className="col-span-full text-sm text-muted">{t("connect.readOnlyNote")}</p>
      <KeyFields provider={provider} id={id} />
      <div className="col-span-full">
        <Segmented
          label={t("manualForm.destination")}
          value={target}
          onChange={setTarget}
          options={[
            { value: "new", label: t("manualForm.newAccount") },
            { value: "existing", label: t("manualForm.existingAccount") },
          ]}
        />
      </div>
      {target === "new" ? (
        <>
          <Field label={t("manualForm.name")} htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" required maxLength={80} defaultValue={provider.name} />
          </Field>
          <Field label={t("manualForm.currency")} htmlFor={`${id}-currency`} hint={t("connect.currencyHint")}>
            <Select id={`${id}-currency`} name="currency" defaultValue={provider.defaultCurrency}>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <div className="col-span-full">
          <Field label={t("manualForm.existing")} htmlFor={`${id}-account`} hint={t("connect.existingHint")}>
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
                      : !usable(one) && one.reason !== null
                        ? ` — ${t(`manualForm.reasons.${one.reason}` as "manualForm.reasons.synced")}`
                        : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <ErrorLine error={error} />
      <Actions
        onCancel={() => onOpenChange(false)}
        pending={pending || (target === "existing" && accountId === "")}
        submit={pending ? t("connect.checking") : t("connect.submit")}
      />
    </Dialog>
  );
}

/** "Sync now" and "Verify" (§4.3): a minute apart at least, which the service enforces (SEC-09). */
export function SyncButtons({ accountId }: { accountId: string }) {
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
  return (
    <span className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={pending}
        onClick={() => run(() => syncNowAction(accountId), t("toasts.synced"))}
      >
        {t("sync.now")}
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => run(() => verifyKeyAction(accountId), t("toasts.verified"))}
      >
        {t("sync.verify")}
      </Button>
    </span>
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

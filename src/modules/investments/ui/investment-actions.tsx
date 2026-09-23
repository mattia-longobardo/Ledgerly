"use client";

import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseAmount } from "@/modules/accounts/rules";
import { daysBetween } from "@/platform/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, InputGroup, Select } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import {
  type ActionResult,
  deleteMovementAction,
  deletePlatformAction,
  deleteValuationAction,
  importSheetAction,
  saveMovementAction,
  savePlatformAction,
  setValuationAction,
} from "../actions";

/** What every dialog needs to know about the page it opens on. */
export interface DialogContext {
  platforms: readonly { id: string; name: string }[];
  numberFormat: NumberFormat;
  locale: UiLocale;
  today: string;
  /** Bank movements that may document a platform movement, positive amounts. */
  linkOptions: { out: readonly LinkChoice[]; in: readonly LinkChoice[] };
}

export interface LinkChoice {
  id: string;
  on: string;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

export interface PlatformSummary {
  id: string;
  name: string;
  url: string | null;
  movementCount: number;
  /** The value as it would be typed back, for "Update value". */
  valueInput: string;
}

export interface MovementSummary {
  id: string;
  platformId: string;
  kind: "deposit" | "withdrawal";
  amountInput: string;
  amountCents: Cents;
  on: string;
  note: string | null;
  linked: LinkChoice | null;
}

const KNOWN_ERRORS = [
  "invalid",
  "not_found",
  "duplicate_name",
  "future_date",
  "invalid_transaction",
  "already_linked",
  "empty_sheet",
  "too_large",
];

function useErrors() {
  const t = useTranslations("investments");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    report: (result: ActionResult | { ok: false; error: string } | { ok: true }) => {
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
    <p role="alert" className="text-sm text-neg">
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

// ——— Platform —————————————————————————————————————————————————————————————————————————————

export function PlatformDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformSummary | null;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name") ?? ""), url: String(data.get("url") ?? "") };
    startTransition(async () => {
      const result = await savePlatformAction(platform?.id ?? null, input);
      if (!report(result)) return;
      notify(t(platform ? "toasts.platformSaved" : "toasts.platformCreated", { name: input.name.trim() }));
      onOpenChange(false);
      if (!platform && result.ok) router.push(`/investments?platform=${result.id}`);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        clear();
        onOpenChange(next);
      }}
      title={platform ? t("platformForm.editTitle") : t("platformForm.newTitle")}
      description={t("platformForm.description")}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <Field label={t("platformForm.name")} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            name="name"
            required
            maxLength={60}
            autoFocus
            defaultValue={platform?.name ?? ""}
            placeholder={t("platformForm.namePlaceholder")}
          />
        </Field>
        <Field label={t("platformForm.url")} htmlFor={`${id}-url`} hint={t("platformForm.urlHint")}>
          <Input
            id={`${id}-url`}
            name="url"
            type="url"
            inputMode="url"
            maxLength={500}
            defaultValue={platform?.url ?? ""}
            placeholder="https://www.etoro.com"
          />
        </Field>
        <ErrorLine error={error} />
        <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("form.save")} />
      </form>
    </Modal>
  );
}

// ——— Movement —————————————————————————————————————————————————————————————————————————————

function linkLabel(choice: LinkChoice, context: DialogContext): string {
  return [
    formatDate(choice.on, "long", context.locale),
    choice.payee,
    choice.accountName,
    formatMoney(choice.cents, context.numberFormat),
  ]
    .filter(Boolean)
    .join(" · ");
}

function daysApart(a: string, b: string): number {
  return Math.abs(daysBetween(a, b));
}

/**
 * The bank movements worth offering: the ones going the right way, the same amount first, then the
 * nearest to the movement's date. A long list of a year's payments would hide the right one.
 */
function rankedChoices(
  choices: readonly LinkChoice[],
  on: string,
  cents: Cents | null,
  keep: LinkChoice | null,
): LinkChoice[] {
  const ranked = [...choices]
    .sort((a, b) => {
      const sameA = cents !== null && a.cents === cents ? 0 : 1;
      const sameB = cents !== null && b.cents === cents ? 0 : 1;
      return sameA - sameB || daysApart(a.on, on) - daysApart(b.on, on) || (a.id < b.id ? -1 : 1);
    })
    .slice(0, 40);
  return keep && !ranked.some((choice) => choice.id === keep.id) ? [keep, ...ranked] : ranked;
}

export function MovementDialog({
  open,
  onOpenChange,
  movement,
  platformId,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movement: MovementSummary | null;
  /** The platform to preselect for a new movement. */
  platformId: string | null;
  context: DialogContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();
  const [kind, setKind] = useState<"deposit" | "withdrawal">(movement?.kind ?? "deposit");
  const [amount, setAmount] = useState(movement?.amountInput ?? "");
  const [on, setOn] = useState(movement?.on ?? context.today);
  const [link, setLink] = useState(movement?.linked?.id ?? "");
  let cents: Cents | null = null;
  try {
    cents = amount.trim() === "" ? null : parseAmount(amount, context.numberFormat);
  } catch {
    cents = null;
  }
  const keep = movement?.linked && movement.kind === kind ? movement.linked : null;
  const choices = rankedChoices(
    kind === "deposit" ? context.linkOptions.out : context.linkOptions.in,
    on,
    cents,
    keep,
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      platformId: String(data.get("platform") ?? ""),
      kind,
      amount,
      on,
      transactionId: choices.some((choice) => choice.id === link) ? link : null,
      note: String(data.get("note") ?? ""),
    };
    startTransition(async () => {
      if (!report(await saveMovementAction(movement?.id ?? null, input))) return;
      notify(
        t(movement ? "toasts.movementSaved" : kind === "deposit" ? "toasts.deposited" : "toasts.withdrawn"),
      );
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
      title={movement ? t("movementForm.editTitle") : t("movementForm.newTitle")}
      description={t("movementForm.description")}
      width={520}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="col-span-full">
          <Segmented
            label={t("movementForm.kind")}
            value={kind}
            onChange={(next) => {
              setKind(next);
              setLink("");
            }}
            options={[
              { value: "deposit", label: t("kinds.deposit") },
              { value: "withdrawal", label: t("kinds.withdrawal") },
            ]}
          />
        </div>
        <Field label={t("movementForm.platform")} htmlFor={`${id}-platform`}>
          <Select
            id={`${id}-platform`}
            name="platform"
            required
            defaultValue={movement?.platformId ?? platformId ?? context.platforms[0]?.id ?? ""}
          >
            {context.platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("movementForm.amount")} htmlFor={`${id}-amount`}>
          <InputGroup suffix="€">
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              numeric
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </InputGroup>
        </Field>
        <Field label={t("movementForm.date")} htmlFor={`${id}-on`}>
          <Input
            id={`${id}-on`}
            type="date"
            required
            max={context.today}
            value={on}
            onChange={(event) => setOn(event.target.value)}
          />
        </Field>
        <Field label={t("movementForm.note")} htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} name="note" maxLength={200} defaultValue={movement?.note ?? ""} />
        </Field>
        <div className="col-span-full">
          <Field
            label={kind === "deposit" ? t("movementForm.linkOut") : t("movementForm.linkIn")}
            htmlFor={`${id}-link`}
            hint={t("movementForm.linkHint")}
          >
            <Select id={`${id}-link`} value={link} onChange={(event) => setLink(event.target.value)}>
              <option value="">{t("movementForm.noLink")}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {linkLabel(choice, context)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="col-span-full">
          <ErrorLine error={error} />
        </div>
        <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("form.save")} />
      </form>
    </Modal>
  );
}

// ——— Valuation ————————————————————————————————————————————————————————————————————————————

export function ValuationDialog({
  open,
  onOpenChange,
  platform,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformSummary;
  context: DialogContext;
}) {
  const t = useTranslations("investments");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { value: String(data.get("value") ?? ""), on: String(data.get("on") ?? "") };
    startTransition(async () => {
      if (!report(await setValuationAction(platform.id, input))) return;
      notify(t("toasts.valued", { name: platform.name }));
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
      title={t("valuationForm.title", { name: platform.name })}
      description={t("valuationForm.description")}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label={t("valuationForm.value")} htmlFor={`${id}-value`}>
          <InputGroup suffix="€">
            <Input
              id={`${id}-value`}
              name="value"
              inputMode="decimal"
              numeric
              required
              autoFocus
              defaultValue={platform.valueInput}
            />
          </InputGroup>
        </Field>
        <Field label={t("valuationForm.date")} htmlFor={`${id}-on`}>
          <Input
            id={`${id}-on`}
            name="on"
            type="date"
            required
            max={context.today}
            defaultValue={context.today}
          />
        </Field>
        <div className="col-span-full">
          <ErrorLine error={error} />
        </div>
        <Actions onCancel={() => onOpenChange(false)} pending={pending} submit={t("form.save")} />
      </form>
    </Modal>
  );
}

// ——— Confirmation ————————————————————————————————————————————————————————————————————————————

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

// ——— Import ———————————————————————————————————————————————————————————————————————————————

export function ImportButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const t = useTranslations("investments");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const { error, clear, report } = useErrors();

  function reset(next: boolean) {
    clear();
    setFile(null);
    setOpen(next);
  }

  function onSubmit() {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await importSheetAction(data);
      if (!report(result) || !result.ok) return;
      notify(
        t("toasts.imported", {
          imported: result.imported,
          skipped: result.skipped,
          platforms: result.platformsCreated,
        }),
      );
      if (result.invalid.length > 0 || result.future > 0) {
        notify(
          t("toasts.importSkippedLines", {
            lines: result.invalid.join(", ") || "—",
            future: result.future,
          }),
          "error",
        );
      }
      reset(false);
    });
  }

  return (
    <>
      <Button size={size} onClick={() => reset(true)} icon={<FileUp aria-hidden className="size-3.5" />}>
        {t("actions.import")}
      </Button>
      {open && (
        <Modal
          open
          onOpenChange={reset}
          title={t("import.title")}
          description={t("import.description")}
          width={520}
          footer={
            <>
              <Button onClick={() => reset(false)}>{t("form.cancel")}</Button>
              <Button variant="primary" onClick={onSubmit} disabled={pending || file === null}>
                {t("import.submit")}
              </Button>
            </>
          }
        >
          <label
            htmlFor={`${id}-file`}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center hover:bg-hover"
          >
            <FileUp size={20} className="text-muted" aria-hidden />
            <span className="font-medium text-accent">{t("import.choose")}</span>
            <span className="text-sm text-muted">{file ? file.name : t("import.columns")}</span>
            <input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <ErrorLine error={error} />
        </Modal>
      )}
    </>
  );
}

// ——— Buttons and menus the page places ———————————————————————————————————————————————————————

/** The top bar's "New movement"; before any platform exists, "New platform" instead. */
export function NewMovementButton({
  context,
  platformId,
  size = "sm",
}: {
  context: DialogContext;
  platformId: string | null;
  size?: "sm" | "md";
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState(false);
  if (context.platforms.length === 0) return <NewPlatformButton variant="primary" size={size} />;
  return (
    <>
      <Button size={size} variant="primary" onClick={() => setOpen(true)}>
        {t("actions.newMovement")}
      </Button>
      {open && (
        <MovementDialog
          open
          onOpenChange={setOpen}
          movement={null}
          platformId={platformId}
          context={context}
        />
      )}
    </>
  );
}

export function NewPlatformButton({
  variant = "secondary",
  size = "sm",
}: {
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {t("actions.newPlatform")}
      </Button>
      {open && <PlatformDialog open onOpenChange={setOpen} platform={null} />}
    </>
  );
}

type PlatformDialogKind = "value" | "edit" | "delete" | "movement" | null;

/** A platform row's commands: update its value, add a movement, edit it, delete it. */
export function PlatformMenu({ platform, context }: { platform: PlatformSummary; context: DialogContext }) {
  const t = useTranslations("investments");
  const router = useRouter();
  const [open, setOpen] = useState<PlatformDialogKind>(null);
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <>
      <ActionMenu
        label={t("actions.platformMenu", { name: platform.name })}
        items={[
          { label: t("actions.updateValue"), onSelect: () => setOpen("value") },
          { label: t("actions.newMovement"), onSelect: () => setOpen("movement") },
          { label: t("actions.editPlatform"), onSelect: () => setOpen("edit") },
          { label: t("actions.deletePlatform"), onSelect: () => setOpen("delete"), danger: true },
        ]}
      />
      {open === "value" && (
        <ValuationDialog open onOpenChange={close} platform={platform} context={context} />
      )}
      {open === "edit" && <PlatformDialog open onOpenChange={close} platform={platform} />}
      {open === "movement" && (
        <MovementDialog
          open
          onOpenChange={close}
          movement={null}
          platformId={platform.id}
          context={context}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={t("confirm.platformTitle", { name: platform.name })}
          description={t("confirm.platformDescription", { count: platform.movementCount })}
          confirm={t("actions.deletePlatform")}
          onConfirm={async () => {
            const result = await deletePlatformAction(platform.id);
            if (!result.ok) {
              notify(t("errors.failed"), "error");
              return false;
            }
            notify(t("toasts.platformDeleted", { name: platform.name, count: result.movements }));
            router.push("/investments");
            return true;
          }}
        />
      )}
    </>
  );
}

/** A movement row's commands: edit it or delete it. */
export function MovementMenu({ movement, context }: { movement: MovementSummary; context: DialogContext }) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  return (
    <>
      <ActionMenu
        label={t("actions.movementMenu")}
        items={[
          { label: t("actions.editMovement"), onSelect: () => setOpen("edit") },
          { label: t("actions.deleteMovement"), onSelect: () => setOpen("delete"), danger: true },
        ]}
      />
      {open === "edit" && (
        <MovementDialog open onOpenChange={close} movement={movement} platformId={null} context={context} />
      )}
      {open === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={t("confirm.movementTitle")}
          description={t("confirm.movementDescription", {
            kind: movement.kind,
            amount: formatMoney(movement.amountCents, context.numberFormat),
            date: formatDate(movement.on, "long", context.locale),
          })}
          confirm={t("actions.deleteMovement")}
          onConfirm={async () => {
            const result = await deleteMovementAction(movement.id);
            notify(
              result.ok ? t("toasts.movementDeleted") : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            return result.ok;
          }}
        />
      )}
    </>
  );
}

/** "Remove" on a valuation row: asks first, like every deletion on the page. */
export function DeleteValuationButton({ id, description }: { id: string; description: string }) {
  const t = useTranslations("investments");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="danger" onClick={() => setOpen(true)}>
        {t("actions.deleteValuation")}
      </Button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={t("confirm.valuationTitle")}
          description={description}
          confirm={t("actions.deleteValuation")}
          onConfirm={async () => {
            const result = await deleteValuationAction(id);
            notify(
              result.ok ? t("toasts.valuationDeleted") : t("errors.failed"),
              result.ok ? "success" : "error",
            );
            return result.ok;
          }}
        />
      )}
    </>
  );
}

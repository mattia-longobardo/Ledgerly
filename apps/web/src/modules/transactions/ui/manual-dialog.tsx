"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Select, Textarea } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { Segmented } from "@ledgerly/ui/segmented";
import { useRouter } from "@ledgerly/ui/router";
import { setLabels } from "./commands";
import type {
  ManualAccountView,
  ManualCommands,
  ManualForm,
  ManualKind,
  ManualPreviewView,
  ManualSaveResult,
} from "./manual-types";
import type { CategoryOption, LabelOption, RowView } from "./view";

const FORM_ID = "manual-transaction";
/** The account the dialog was last used with, kept in this browser only. */
const LAST_ACCOUNT = "ledgerly.manual.account";
/** How long the dialog waits after the last key before it asks for the balance line. */
const PREVIEW_DELAY_MS = 400;

/** A category the dialog offers: the kind chosen decides which ones. */
export interface ManualCategoryOption extends CategoryOption {
  type: "income" | "expense" | "transfer";
}

function lastAccount(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}

function rememberAccount(id: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT, id);
  } catch {
    // A browser that keeps nothing: the dialog starts from the first account next time.
  }
}

function sameLabels(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && next.every((id) => current.includes(id));
}

/**
 * The dialog that writes and changes a manual movement (ux/n3-categories-manual.md §9.3).
 *
 * It reads the accounts it may offer when it opens and the balance line while the person types,
 * both through the commands the page hands in; it works no number out itself. The key that makes
 * a double send one row is made once for each opening, by the caller.
 */
export function ManualTransactionDialog({
  row,
  idempotencyKey,
  commands,
  categories,
  labels,
  finalFocus,
  onClose,
  onSaved,
}: {
  /** The movement being changed; `null` to write a new one. */
  row: RowView | null;
  idempotencyKey: string;
  commands: ManualCommands;
  categories: readonly ManualCategoryOption[];
  labels: readonly LabelOption[];
  finalFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSaved: (result: Extract<ManualSaveResult, { ok: true }>, categoryChanged: boolean) => void;
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const ids = useId();
  const editing = row?.manual ?? null;
  const [accounts, setAccounts] = useState<readonly ManualAccountView[] | null>(null);
  const [today, setToday] = useState("");
  const [form, setForm] = useState<ManualForm>({
    kind: editing?.kind ?? "expense",
    amount: editing?.amount ?? "",
    on: editing?.on ?? "",
    accountId: editing?.accountId ?? "",
    categoryId: row?.categoryId ?? null,
    payee: editing?.payee ?? "",
    note: row?.note ?? "",
  });
  const [chosenLabels, setChosenLabels] = useState<readonly string[]>(row?.labelIds ?? []);
  const [picking, setPicking] = useState(false);
  /** The category Ledgerly suggests while the person has chosen none; theirs once they save. */
  const [suggestedId, setSuggestedId] = useState<string | null>(null);
  /** The person touched the category: from then on the dialog asks for no suggestion. */
  const [categoryChosen, setCategoryChosen] = useState(row !== null);
  const [preview, setPreview] = useState<ManualPreviewView>(null);
  const [fieldError, setFieldError] = useState<"amount" | "date" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Set before the first render that shows `pending`: a second click in the same instant sends nothing. */
  const sending = useRef(false);

  // What the dialog may offer is read once, when it opens.
  useEffect(() => {
    let live = true;
    commands
      .form()
      .then((data) => {
        if (!live) return;
        setAccounts(data.accounts);
        setToday(data.today);
        setForm((current) => {
          const remembered = lastAccount();
          const known = (id: string | null) => data.accounts.some((account) => account.id === id);
          const accountId = known(current.accountId)
            ? current.accountId
            : known(remembered)
              ? (remembered as string)
              : (data.accounts.find((account) => account.mode === "manual")?.id ??
                data.accounts[0]?.id ??
                "");
          return { ...current, accountId, on: current.on === "" ? data.today : current.on };
        });
      })
      .catch(() => {
        if (live) setAccounts([]);
      });
    return () => {
      live = false;
    };
  }, [commands]);

  const { kind, amount, on, accountId } = form;
  const editingId = row?.id;
  // The balance line: asked for a little after the last change, and never for an empty amount.
  useEffect(() => {
    if (amount.trim() === "" || on === "" || accountId === "") return;
    let live = true;
    const timer = window.setTimeout(() => {
      commands
        .preview({ kind, amount, on, accountId, editingId })
        .then((answer) => {
          if (live) setPreview(answer);
        })
        .catch(() => {
          if (live) setPreview(null);
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [commands, kind, amount, on, accountId, editingId]);

  const { payee, note } = form;
  const suggest = commands.suggest;
  // The suggestion: asked for a little after the last key, while the person has chosen nothing.
  useEffect(() => {
    if (!suggest || categoryChosen || amount.trim() === "" || accountId === "") return;
    let live = true;
    const timer = window.setTimeout(() => {
      suggest({ kind, amount, accountId, payee, note })
        .then((answer) => {
          if (live) setSuggestedId(answer?.categoryId ?? null);
        })
        // A suggestion is a help: a failed request shows nothing.
        .catch(() => undefined);
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [suggest, categoryChosen, kind, amount, accountId, payee, note]);

  function change(patch: Partial<ManualForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setFieldError(null);
  }

  function changeKind(next: ManualKind) {
    const category = categories.find((one) => one.id === form.categoryId);
    // A category of the other kind does not follow the movement to the new one.
    change({ kind: next, categoryId: category && category.type !== next ? null : form.categoryId });
    if (category && category.type !== next) setCategoryChosen(false);
  }

  function focusAmount() {
    document.getElementById(`${ids}-amount`)?.focus();
  }

  function messageFor(error: Extract<ManualSaveResult, { ok: false }>["error"]): string {
    if (error === "account") return t("manual.errors.account");
    if (error === "notFound") return t("errors.notFound");
    return t("manual.errors.failed");
  }

  async function save(): Promise<void> {
    // A suggestion left in the field is saved as the person's choice: they saw it in the form
    // they are sending (ux §9.3).
    const sent = { ...form, categoryId: form.categoryId ?? suggested?.id ?? null };
    const result =
      row === null ? await commands.create(sent, idempotencyKey) : await commands.update(row.id, sent);
    if (!result.ok) {
      if (result.error === "amount" || result.error === "date") {
        setFieldError(result.error);
        if (result.error === "amount") focusAmount();
      } else {
        setFormError(messageFor(result.error));
      }
      return;
    }
    if (row !== null && !sameLabels(row.labelIds, chosenLabels)) {
      const saved = await setLabels(row.id, chosenLabels);
      if (!saved.ok) {
        setFormError(t("manual.errors.failed"));
        return;
      }
      // shortcut: the rows are still drawn by a server page; this goes when the page reads them itself.
      router.refresh();
    }
    rememberAccount(form.accountId);
    onSaved(result, row !== null && row.categoryId !== form.categoryId);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    if (form.amount.trim() === "") {
      setFieldError("amount");
      focusAmount();
      return;
    }
    if (form.on === "" || (today !== "" && form.on > today)) {
      setFieldError("date");
      return;
    }
    sending.current = true;
    setPending(true);
    setFormError(null);
    save()
      .catch(() => setFormError(t("manual.errors.failed")))
      .finally(() => {
        sending.current = false;
        setPending(false);
      });
  }

  const account = accounts?.find((one) => one.id === form.accountId) ?? null;
  // Its own macro or Transfers (categories-and-rules.md §3.2, QC2).
  const offered = categories.filter(
    (category) => category.type === form.kind || category.type === "transfer",
  );
  const category = offered.find((one) => one.id === form.categoryId) ?? null;
  const suggested =
    category === null && !categoryChosen ? (offered.find((one) => one.id === suggestedId) ?? null) : null;
  // One group for each way an account is kept; the accounts of a source that takes the movements
  // written here are grouped by that source, under its name (ux §9.3, §9.8).
  const sourceNames = [
    ...new Set(
      (accounts ?? []).flatMap((one) => (one.mode === "two_way" && one.source ? [one.source.name] : [])),
    ),
  ];
  const groups = [
    {
      key: "manual",
      label: t("manual.accounts.manual"),
      accounts: (accounts ?? []).filter((one) => one.mode === "manual"),
    },
    ...sourceNames.map((name) => ({
      key: `source:${name}`,
      label: t("manual.accounts.twoWay", { provider: name }),
      accounts: (accounts ?? []).filter((one) => one.mode === "two_way" && one.source?.name === name),
    })),
    {
      key: "bank",
      label: t("manual.accounts.bank"),
      accounts: (accounts ?? []).filter((one) => one.mode === "read_only"),
    },
  ].filter((group) => group.accounts.length > 0);
  const shownPreview = amount.trim() === "" ? null : preview;

  const title = row === null ? t("manual.add") : t("manual.editTitle");

  if (accounts !== null && accounts.length === 0) {
    return (
      <Modal
        open
        onOpenChange={(open) => !open && onClose()}
        title={title}
        finalFocus={finalFocus}
        footer={
          <>
            <Button size="sm" onClick={onClose}>
              {t("row.cancel")}
            </Button>
            <ButtonLink href="/accounts/new" variant="primary" size="sm">
              {t("manual.noAccount.action")}
            </ButtonLink>
          </>
        }
      >
        <div data-testid="manual-dialog" className="flex flex-col gap-1">
          <p className="font-medium">{t("manual.noAccount.title")}</p>
          <p className="text-sm text-muted">{t("manual.noAccount.description")}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      finalFocus={finalFocus}
      footer={
        <div className="flex w-full justify-end gap-2 max-sm:flex-col-reverse">
          <Button size="sm" onClick={onClose}>
            {t("row.cancel")}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            size="sm"
            disabled={pending || accounts === null}
          >
            {pending ? t("manual.saving") : row === null ? t("manual.add") : t("row.save")}
          </Button>
        </div>
      }
    >
      <form
        id={FORM_ID}
        data-testid="manual-dialog"
        onSubmit={onSubmit}
        aria-busy={pending || accounts === null}
        noValidate
        className="flex flex-col gap-3"
      >
        {formError && (
          <p role="alert" className="text-sm text-neg">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id={`${ids}-kind`}>
            {t("manual.type")}
          </span>
          <Segmented
            label={t("manual.type")}
            value={form.kind}
            onChange={changeKind}
            options={[
              { value: "expense", label: t("manual.types.expense") },
              { value: "income", label: t("manual.types.income") },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={t("manual.amount")}
            htmlFor={`${ids}-amount`}
            hint={t("manual.amountHint")}
            error={fieldError === "amount" ? t("manual.errors.amount") : undefined}
          >
            <span className="flex items-center gap-2">
              <Input
                id={`${ids}-amount`}
                value={form.amount}
                onChange={(event) => change({ amount: event.currentTarget.value })}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                required
                numeric
              />
              {account && <span className="shrink-0 text-sm text-muted">{account.currency}</span>}
            </span>
          </Field>
          <Field
            label={t("manual.date")}
            htmlFor={`${ids}-date`}
            error={fieldError === "date" ? t("manual.errors.date") : undefined}
          >
            <Input
              id={`${ids}-date`}
              type="date"
              value={form.on}
              max={today === "" ? undefined : today}
              onChange={(event) => change({ on: event.currentTarget.value })}
              required
            />
          </Field>
        </div>

        <Field label={t("manual.account")} htmlFor={`${ids}-account`}>
          <Select
            id={`${ids}-account`}
            value={form.accountId}
            onChange={(event) => change({ accountId: event.currentTarget.value })}
            disabled={accounts === null}
            required
          >
            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.accounts.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {/* One live region for what the chosen account says: the balance, and the bank's warning. */}
        <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
          {account?.mode === "read_only" && (
            <p
              data-testid="manual-bank-warning"
              className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn"
            >
              {t("manual.bankWarning")} {t("manual.bankBalance")}
            </p>
          )}
          {account?.mode === "two_way" && account.source && (
            <p data-testid="manual-send-note" className="rounded-ctl bg-hover px-3 py-2 text-sm text-muted">
              {account.source.waiting
                ? t("manual.twoWayPaused", { provider: account.source.name })
                : t("manual.twoWayNote", { provider: account.source.name })}
            </p>
          )}
          {shownPreview && (
            <p data-testid="manual-balance-line" className="text-sm text-muted tabular-nums">
              {shownPreview.kind === "change"
                ? t("manual.balance.change", {
                    account: shownPreview.account,
                    before: shownPreview.before,
                    after: shownPreview.after,
                  })
                : t("manual.balance.unchanged", { account: shownPreview.account, date: shownPreview.date })}
            </p>
          )}
        </div>

        <Field label={t("manual.payee")} htmlFor={`${ids}-payee`}>
          <Input
            id={`${ids}-payee`}
            value={form.payee}
            onChange={(event) => change({ payee: event.currentTarget.value })}
            maxLength={255}
            autoComplete="off"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-category`} className="text-sm font-medium">
            {t("manual.category")}
          </label>
          <CategoryPicker
            categories={offered}
            currentId={category?.id ?? null}
            open={picking}
            onOpenChange={setPicking}
            onPick={(categoryId) => {
              setCategoryChosen(true);
              change({ categoryId });
            }}
            uncategorisedLabel={t("row.uncategorised")}
            searchLabel={t("row.searchCategory")}
            noMatchLabel={t("row.noCategoryMatch")}
            triggerLabel={t("manual.category")}
            triggerId={`${ids}-category`}
            disabled={pending}
            triggerClassName={cn(
              "focus-ring flex h-8 w-full items-center gap-1.5 rounded-ctl border bg-card px-2.5 text-left text-base hover:bg-hover",
              suggested ? "border-dashed border-muted text-muted" : "border-border",
            )}
          >
            {suggested ? (
              <>
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-xs border"
                  style={{ borderColor: suggested.color }}
                />
                <span data-testid="manual-suggestion" className="min-w-0 truncate">
                  {t("auto.suggestion.chip", { category: suggested.name })}
                </span>
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className={cn("size-[7px] shrink-0 rounded-xs", category === null && "bg-faint")}
                  style={category === null ? undefined : { background: category.color }}
                />
                <span className="min-w-0 truncate">{category?.name ?? t("row.uncategorised")}</span>
              </>
            )}
          </CategoryPicker>
          {suggested && <p className="text-sm text-muted">{t("manual.categoryHint")}</p>}
          {offered.length === 0 && (
            <Link href="/settings/categories" className="focus-ring self-start text-sm text-accent underline">
              {t("manual.noCategories")}
            </Link>
          )}
        </div>

        <Field label={t("manual.note")} htmlFor={`${ids}-note`}>
          <Textarea
            id={`${ids}-note`}
            value={form.note}
            onChange={(event) => change({ note: event.currentTarget.value })}
            rows={2}
            maxLength={2000}
            className="min-h-14"
          />
        </Field>

        {row !== null && labels.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-sm font-medium">{t("row.labels")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {labels.map((label) => (
                <Checkbox
                  key={label.id}
                  label={label.name}
                  checked={chosenLabels.includes(label.id)}
                  disabled={pending}
                  onChange={() =>
                    setChosenLabels((current) =>
                      current.includes(label.id)
                        ? current.filter((one) => one !== label.id)
                        : [...current, label.id],
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

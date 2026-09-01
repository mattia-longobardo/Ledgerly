"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { clearPoisonedSnapshot, runSnapshotNow } from "@/app/actions/jobs";
import { setAccrualRate, setInitialValue } from "@/app/actions/vacation";
import {
  clearLlmApiKey,
  deleteAccount,
  setAccountVisible,
  setHoursPerDay,
  setLlmSettings,
} from "@/app/actions/settings";
import { formatEur } from "@/lib/format";

const FIELD =
  "num min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg";
/**
 * Amounts, hour counts and months are all short. `w-full` keeps the mobile
 * behaviour (the cap is never reached inside a 360 px gutter) while stopping
 * the field from stretching across a desktop column. `w-full` also pins the
 * used width of `input[type=month]`, whose native control otherwise reports a
 * wide intrinsic size on some mobile browsers.
 */
const FIELD_NARROW = `${FIELD} max-w-48`;
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";
const PRIMARY =
  "inline-flex min-h-11 self-start items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-40";
const SECONDARY =
  "inline-flex min-h-11 self-start items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
    />
  );
}

export interface VacationSetupFormProps {
  monthlyAmount: string;
  effectiveFrom: string;
  hasInitialValue: boolean;
  currentMonth: string;
  balance: number;
}

/**
 * §9 item 10: the monthly amount and the opening value are configured here at
 * first run — there is deliberately no preset to inherit.
 */
export function VacationSetupForm(props: VacationSetupFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(props.monthlyAmount);
  const [from, setFrom] = useState(props.effectiveFrom);
  const [initial, setInitial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function saveRate() {
    setError(null);
    startTransition(async () => {
      const result = await setAccrualRate({ monthlyAmount: amount, effectiveFrom: from });
      if (result.ok) {
        setToast("Accrual rule saved");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function saveInitial() {
    setError(null);
    startTransition(async () => {
      const result = await setInitialValue({ amount: initial, month: from });
      if (result.ok) {
        setInitial("");
        setToast("Opening value saved");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorInline message={error} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveRate();
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Monthly amount</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="120,00"
            className={FIELD_NARROW}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Effective from</span>
          <input
            type="month"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={FIELD_NARROW}
          />
          <span className="text-body-sm text-fg-muted">
            Changing the amount only affects months from here on; past accruals stay as they were.
          </span>
        </label>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending && <Spinner />}
          Save accrual rule
        </button>
      </form>

      {props.hasInitialValue ? (
        <p className="num text-body-sm text-fg-muted hairline-t pt-4">
          Opening value already set. Current balance {formatEur(props.balance)}.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveInitial();
          }}
          className="flex flex-col gap-3 hairline-t pt-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Opening value</span>
            <input
              value={initial}
              onChange={(event) => setInitial(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className={FIELD_NARROW}
            />
            <span className="text-body-sm text-fg-muted">
              What is already set aside today. This can only be entered once.
            </span>
          </label>
          <button type="submit" disabled={pending || initial.trim() === ""} className={SECONDARY}>
            Set opening value
          </button>
        </form>
      )}

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        duration={4000}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}

export function HoursPerDayForm({ hoursPerDay }: { hoursPerDay: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(hoursPerDay));
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await setHoursPerDay(value.replace(",", "."));
            if (result.ok) {
              setToast(true);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="flex flex-col gap-3"
      >
        {error !== null && <ErrorInline message={error} />}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Hours per day</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className={FIELD_NARROW}
          />
          <span className="text-body-sm text-fg-muted">
            Payslips state ferie and ROL in hours; days are hours ÷ this number.
          </span>
        </label>
        <button type="submit" disabled={pending} className={SECONDARY}>
          Save
        </button>
      </form>
      <Toast
        open={toast}
        message="Hours per day saved"
        duration={4000}
        onOpenChange={setToast}
      />
    </>
  );
}

/**
 * Structurally identical to `LlmConfigStatus`, restated rather than imported so
 * this client module never so much as name-imports from a file that reaches
 * `@/lib/env` or `@/lib/db`. Note what is NOT here: the key itself.
 */
export interface LlmFormProps {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  hasStoredKey: boolean;
}

const KEY_STATUS: Record<string, string> = {
  settings: "Configured here",
  env: "Configured in the environment",
};

/**
 * The API key is write-only in this form: the server never sends its value
 * down, so the field always starts empty and an empty field means "keep the
 * stored key" — saving a new model cannot wipe the credential. Removing one is
 * the separate button below.
 */
export function LlmForm(props: LlmFormProps) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(props.baseUrl);
  const [model, setModel] = useState(props.model);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorInline message={error} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await setLlmSettings({ baseUrl, model, apiKey });
            if (result.ok) {
              setApiKey("");
              setToast("Payslip AI settings saved");
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Base URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.openai.com/v1"
            className={FIELD}
          />
          <span className="text-body-sm text-fg-muted">
            Any OpenAI-compatible endpoint. Plain http:// is accepted only for a host on your own
            network.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="gpt-4.1-mini"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={props.hasKey ? "Leave blank to keep the current key" : "sk-…"}
            className={FIELD}
          />
          <span className="text-body-sm text-fg-muted">
            {props.hasKey
              ? `${KEY_STATUS[props.keySource ?? ""] ?? "Configured"}. The stored key is never sent back to this page; type a new one to replace it.`
              : "Without a key the payslip parser falls back to its deterministic rules alone."}
          </span>
        </label>

        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending && <Spinner />}
          Save
        </button>
      </form>

      {props.hasStoredKey && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await clearLlmApiKey();
              if (result.ok) {
                setToast("Stored key removed");
                router.refresh();
              } else {
                setError(result.error);
              }
            });
          }}
          className="hairline-t pt-4"
        >
          <button type="submit" disabled={pending} className={SECONDARY}>
            Remove stored key
          </button>
        </form>
      )}

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        duration={4000}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}

export function RunSnapshotButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {error !== null && <ErrorInline message={error} className="mb-3" />}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await runSnapshotNow();
            if (result.ok) {
              setToast(true);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className={PRIMARY}
      >
        {pending && <Spinner />}
        Run the snapshot now
      </button>
      <Toast
        open={toast}
        message="Snapshot job triggered"
        detail="Watch the runs below for the result."
        duration={5000}
        onOpenChange={setToast}
      />
    </>
  );
}

export interface TrackedAccountRow {
  slug: string;
  label: string;
  teableColumn: string;
  visible: boolean;
}

const ROW_ACTION =
  "-mr-1 inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium disabled:opacity-40";

/**
 * Settings → Conti. Each hand-tracked account with a hide/show toggle and a
 * delete. Delete is a TWO-STEP confirm in the row — never one click — because it
 * removes the Teable column and the whole history stored there.
 */
export function TrackedAccountsForm({ accounts }: { accounts: TrackedAccountRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(account: TrackedAccountRow) {
    setError(null);
    startTransition(async () => {
      const result = await setAccountVisible({ slug: account.slug, visible: !account.visible });
      if (result.ok) {
        setToast(account.visible ? `${account.label} hidden` : `${account.label} shown`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(account: TrackedAccountRow) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount({ slug: account.slug });
      setConfirming(null);
      if (result.ok) {
        setToast(`${account.label} deleted`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (accounts.length === 0) {
    return (
      <p className="text-body-sm text-fg-muted">
        No hand-tracked accounts. The seed migration registers them on first boot.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}

      <ul className="hairline-t">
        {accounts.map((account) => (
          <li key={account.slug} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-body text-fg">{account.label}</span>
                {!account.visible && (
                  <span className="shrink-0 text-caption text-fg-muted uppercase">hidden</span>
                )}
              </span>
              <span
                title={account.teableColumn}
                className="num block truncate text-caption text-fg-muted"
              >
                Teable column “{account.teableColumn}”
              </span>
            </span>

            {confirming === account.slug ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(account)}
                  className={`${ROW_ACTION} text-negative`}
                >
                  {pending && <Spinner />}
                  Confirm delete
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(null)}
                  className={`${ROW_ACTION} text-fg-muted`}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(account)}
                  className={`${ROW_ACTION} text-accent`}
                >
                  {account.visible ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(account.slug)}
                  className={`${ROW_ACTION} text-negative`}
                >
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="text-body-sm text-fg-muted">
        Hiding removes the row from Home and Finance but keeps the value in the total. Deleting
        also removes the column from Teable, and its history there cannot be recovered.
      </p>

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        duration={4000}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </div>
  );
}

export function ClearPoisonedButton({ month }: { month: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await clearPoisonedSnapshot(month);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
        className="-mr-2 inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium text-accent"
      >
        Clear
      </button>
      {error !== null && <span className="text-caption text-negative">{error}</span>}
    </span>
  );
}

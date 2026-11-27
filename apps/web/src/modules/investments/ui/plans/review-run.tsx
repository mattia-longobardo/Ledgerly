"use client";

// «Review the proposal» of a basket's execution (PERS-681 §2.4, §4.2-4.3): one line per instrument
// with its weight, the close and its day, the shares and what they cost, and its state; the person
// corrects the price, the shares or the fee of a line, and the day. Every correction asks the server
// for a preview (`…/runs/{runId}/preview`, nothing written): the shares of a line whose price changed,
// what is spent and the carry to the next execution are the server's. «Confirm» writes one purchase
// per line with shares, all of them or none; a line with no price goes with 0 shares and no price.
// With no cash the dialog offers «Record a deposit».
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { priceText, quantityText } from "@ledgerly/domain/investments/client";
import { formatDate, formatDecimalText, type NumberFormat } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Field } from "@ledgerly/ui/field";
import { DateField, MoneyField } from "@ledgerly/ui/form-fields";
import { Input } from "@ledgerly/ui/input";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { notify } from "@ledgerly/ui/toast";
import { confirmRun, type LineTyped, previewRun, type RunPreview } from "../../plan-calls";
import { useErrorText } from "../dialog-kit";
import type { ServicePage } from "../service/service-view";
import {
  amountText,
  LINE_TONES,
  noShares,
  type Plan,
  type PlansText,
  type Run,
  typedDecimal,
  wholeShares,
} from "./plan-words";

/** The corrections ask for a preview once the typing stops. */
const PREVIEW_MS = 300;

type Line = Run["lines"][number];
/** A line as typed; `touched` once the person typed its shares, which then win over the preview. */
type Typed = LineTyped & { touched: boolean };
type Shown = Pick<Line, "assetId" | "quantity" | "spent" | "state">;

/** The proposal as the dialog opens: each line's close, no share typed, the plan's fee. */
function typedOf(run: Run, page: ServicePage): Typed[] {
  return run.lines.map((line) => ({
    assetId: line.assetId,
    unitPrice: typedDecimal(line.price, page.say.format),
    quantity: "",
    fee: "",
    touched: false,
  }));
}

/** A line's corrections differ from the proposal: a price changed, or shares typed. */
function corrections(typed: readonly Typed[], initial: readonly Typed[], format: NumberFormat): LineTyped[] {
  return typed.map((line, index) => ({
    assetId: line.assetId,
    unitPrice: line.unitPrice === initial[index].unitPrice ? "" : line.unitPrice,
    // Shares that are not whole stay on their field: the server would refuse them (`invalid`).
    quantity: line.touched && wholeShares(line.quantity, format) ? line.quantity : "",
    fee: line.fee,
  }));
}

/** The server's preview of what was typed, and its refusal; the run's own figures until it answers. */
function usePreview(
  ref: { accountId: string; planId: string; runId: string },
  run: Run,
  typed: Typed[],
  format: NumberFormat,
) {
  const [initial] = useState(typed);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const wanted = corrections(typed, initial, format);
  const asked = JSON.stringify(wanted);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const answer = await previewRun(ref, wanted);
      if (!live) return;
      setRefused(answer.ok ? null : answer.error);
      if (answer.ok) setPreview(answer);
    }, PREVIEW_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The reference is the same run for the dialog's life: only the corrections ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const shown = (assetId: string): Shown =>
    preview?.lines.find((line) => line.assetId === assetId) ??
    run.lines.find((line) => line.assetId === assetId)!;
  return { preview, refused, shown };
}

/** The close of a line and its day, or «Price to type». */
function CloseOf({ line, text, page }: { line: Line; text: PlansText; page: ServicePage }) {
  if (line.price === null || line.priceOn === null) return null;
  return (
    <span className="text-xs text-muted">
      {text("review.close", {
        price: priceText(line.price, line.priceCurrency ?? "", page.say.format),
        date: formatDate(line.priceOn, "long", page.say.locale),
      })}
    </span>
  );
}

/** A line's name, weight and, when it buys nothing, why. */
function LineHead({
  line,
  state,
  weight,
  text,
}: {
  line: Line;
  state: Line["state"];
  weight: string;
  text: PlansText;
}) {
  return (
    <>
      <legend className="sr-only">{text("review.lineOf", { name: line.name, weight })}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span aria-hidden className="font-medium">
          {line.name} · {weight} %
        </span>
        {state !== "buy" && (
          <StatusBadge status={state} tones={LINE_TONES}>
            {text(`lineStates.${state}`)}
          </StatusBadge>
        )}
      </div>
    </>
  );
}

/** The shares of a line: the server's proposal until typed; whole only (PERS-681 M2). */
function SharesField({
  id,
  line,
  typed,
  shown,
  set,
  page,
}: {
  id: string;
  line: Line;
  typed: Typed;
  shown: Shown;
  set: (patch: Partial<Typed>) => void;
  page: ServicePage;
}) {
  const text = useTranslations("investments.plans.review");
  const { format } = page.say;
  return (
    <Field
      label={text("quantityOf", { name: line.name })}
      htmlFor={id}
      error={typed.touched && !wholeShares(typed.quantity, format) ? text("wholeShares") : undefined}
    >
      <Input
        id={id}
        inputMode="numeric"
        numeric
        value={typed.touched ? typed.quantity : typedDecimal(shown.quantity, format)}
        onChange={(event) => set({ quantity: event.target.value, touched: true })}
      />
    </Field>
  );
}

function ReviewLine({
  id,
  line,
  typed,
  shown,
  currency,
  set,
  page,
}: {
  id: string;
  line: Line;
  typed: Typed;
  shown: Shown;
  currency: string;
  set: (patch: Partial<Typed>) => void;
  page: ServicePage;
}) {
  const text = useTranslations("investments.plans");
  const { format } = page.say;
  const weight = formatDecimalText(line.weight, format, { min: 0, max: 2 });
  const state = typed.unitPrice === "" ? "price_missing" : shown.state;
  // A line with 0 shares buys nothing: no fee (the server refuses one, `invalid`).
  const none = noShares(typed.touched ? typed.quantity : typedDecimal(shown.quantity, format), format);
  return (
    <fieldset
      data-testid="review-line"
      className="col-span-full flex flex-col gap-2 border-t border-line pt-3"
    >
      <LineHead line={line} state={state} weight={weight} text={text} />
      <CloseOf line={line} text={text} page={page} />
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <MoneyField
          id={`${id}-price`}
          label={text("review.unitPriceOf", { name: line.name })}
          value={typed.unitPrice}
          onChange={(unitPrice) => set({ unitPrice })}
          currency={line.priceCurrency ?? currency}
        />
        <SharesField id={`${id}-quantity`} line={line} typed={typed} shown={shown} set={set} page={page} />
        <MoneyField
          id={`${id}-fee`}
          label={text("review.feeOf", { name: line.name })}
          hint={text(none ? "review.feeNone" : "review.feeHint")}
          value={none ? "" : typed.fee}
          disabled={none}
          onChange={(fee) => set({ fee })}
          currency={line.priceCurrency ?? currency}
        />
      </div>
      <span data-testid="review-spent" className="text-sm">
        {text("review.spent", {
          quantity: quantityText(shown.quantity, null, format),
          spent: amountText(shown.spent, currency, format),
        })}
      </span>
    </fieldset>
  );
}

/** Budget, spent and carry to the next execution: the server's preview. */
function Totals({ run, preview, page }: { run: Run; preview: RunPreview | null; page: ServicePage }) {
  const text = useTranslations("investments.plans.review");
  const money = (value: string | null | undefined) =>
    value == null ? "…" : amountText(value, run.currency, page.say.format);
  const rows = [
    ["budget", money(preview?.budget ?? run.budget)],
    ["spentTotal", money(preview?.spent)],
    ["carry", money(preview?.carryOut)],
  ] as const;
  return (
    <dl
      data-testid="review-totals"
      aria-live="polite"
      className="col-span-full grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm max-sm:grid-cols-1"
    >
      {rows.map(([key, value]) => (
        <div key={key} data-testid={`review-${key}`} className="flex flex-col">
          <dt className="text-muted">{text(key)}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** No cash for the purchases: a deposit first, on the day of the execution (P2 A). */
function NoCash({ onDeposit }: { onDeposit: () => void }) {
  const text = useTranslations("investments.plans");
  return (
    <div className="col-span-full flex flex-col items-start gap-2">
      <p className="text-sm text-muted">{text("noCash")}</p>
      <Button size="sm" onClick={onDeposit}>
        {text("recordDeposit")}
      </Button>
    </div>
  );
}

/** The day of the purchases: the latest close of the lines, or the due date. */
const dayOf = (run: Run) =>
  run.lines.reduce(
    (max, line) => (line.priceOn !== null && line.priceOn > max ? line.priceOn : max),
    run.dueOn,
  );

function useConfirm(page: ServicePage, plan: Plan, run: Run, onClose: () => void) {
  const text = useTranslations("investments.plans");
  const errorText = useErrorText();
  const ref = { accountId: page.id, planId: plan.id, runId: run.id };
  const [day, setDay] = useState(() => dayOf(run));
  const [typed, setTyped] = useState(() => typedOf(run, page));
  const [refused, setRefused] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = usePreview(ref, run, typed, page.say.format);
  const set = (index: number) => (patch: Partial<Typed>) =>
    setTyped((current) => current.map((line, place) => (place === index ? { ...line, ...patch } : line)));
  const { format } = page.say;
  const sharesOf = (line: Typed) =>
    line.touched ? line.quantity : typedDecimal(preview.shown(line.assetId).quantity, format);
  // Shares are whole, and shares need a price; a line with no price is confirmed with 0 (PERS-720).
  const blocked = typed.some((line) => {
    const quantity = sharesOf(line);
    return !wholeShares(quantity, format) || (line.unitPrice.trim() === "" && !noShares(quantity, format));
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked) return;
    startTransition(async () => {
      const lines = typed.map((line) => {
        const quantity = sharesOf(line);
        return {
          assetId: line.assetId,
          unitPrice: line.unitPrice,
          fee: noShares(quantity, format) ? "" : line.fee,
          quantity,
        };
      });
      const result = await confirmRun(ref, day, lines);
      if (!result.ok) {
        setRefused(result.error);
        return;
      }
      notify(text("confirmed"));
      onClose();
    });
  };
  const code = refused ?? preview.refused;
  const error = code === null ? null : code === "not_editable" ? text("review.changed") : errorText(code);
  return {
    day,
    setDay,
    typed,
    set,
    blocked,
    pending,
    onSubmit,
    preview,
    error,
    noCash: refused === "negative_cash",
  };
}

export function ReviewRunDialog({
  page,
  plan,
  run,
  onClose,
  onDeposit,
}: {
  page: ServicePage;
  plan: Plan;
  run: Run;
  onClose: () => void;
  /** «Record a deposit» on the day of the purchases: the portfolio has not the cash for them. */
  onDeposit: (day: string) => void;
}) {
  const text = useTranslations("investments.plans");
  const id = useId();
  const form = useConfirm(page, plan, run, onClose);
  return (
    <FormDialog
      onClose={onClose}
      title={text("review.title", { name: plan.name, date: formatDate(run.dueOn, "long", page.say.locale) })}
      description={text("review.description")}
      width={520}
      className="grid grid-cols-1 gap-3"
      onSubmit={form.onSubmit}
      error={form.error}
      pending={form.pending || form.blocked}
      cancelLabel={text("form.cancel")}
      submitLabel={text("review.submit")}
    >
      <DateField
        id={`${id}-on`}
        label={text("review.on")}
        value={form.day}
        onChange={form.setDay}
        max={page.say.todayOn}
      />
      {run.lines.map((line, index) => (
        <ReviewLine
          key={line.assetId}
          id={`${id}-${index}`}
          line={line}
          typed={form.typed[index]}
          shown={form.preview.shown(line.assetId)}
          currency={run.currency}
          set={form.set(index)}
          page={page}
        />
      ))}
      <Totals run={run} preview={form.preview.preview} page={page} />
      {form.blocked && (
        <p data-testid="review-blocked" className="text-sm text-warn">
          {text("review.priceMissing")}
        </p>
      )}
      {form.noCash && <NoCash onDeposit={() => onDeposit(form.day)} />}
    </FormDialog>
  );
}

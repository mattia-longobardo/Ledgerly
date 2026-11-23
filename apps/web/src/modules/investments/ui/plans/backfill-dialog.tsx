"use client";

// «Record the past instalments» of a plan that started before today (R5d, step 2; §11.3.3, P4): the
// server lists the past due dates with nothing recorded, oldest first and at most 60, each with the
// purchase at its close when the registry has one (`GET …/plans/{planId}/backfill`). The person
// corrects the rows, types the price the registry lacks, drops a row, and records them all together.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { plans } from "@ledgerly/api-contract/investments";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatDate } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { notify } from "@ledgerly/ui/toast";
import { backfillPlan, type BackfillRow } from "../../plan-calls";
import { FORM_GRID, useErrorText, useInvestmentResult } from "../dialog-kit";
import type { ServicePage } from "../service/service-view";
import { type Plan, typedDecimal } from "./plan-words";

type PastRuns = RouteOutput<typeof plans.listPastRuns>;

interface Row extends BackfillRow {
  /** The registry had no close for it: the person types the price. */
  unpriced: boolean;
}

/** The server's proposal of each past due date, as the form shows it. */
function rowsOf(past: PastRuns, page: ServicePage): Row[] {
  const { format } = page.say;
  return past.runs.map((run) => ({
    dueOn: run.dueOn,
    on: run.proposal?.on ?? run.priceOn ?? run.dueOn,
    quantity: typedDecimal(run.proposal?.quantity ?? null, format),
    unitPrice: typedDecimal(run.proposal?.unitPrice ?? run.price, format),
    fee: typedDecimal(run.proposal?.fee ?? null, format),
    unpriced: run.price === null,
  }));
}

/** The figures of a row in the asset's currency. */
const MONEY = ["unitPrice", "fee"] as const;

function InstalmentRow({
  id,
  row,
  page,
  currency,
  onChange,
  onRemove,
}: {
  id: string;
  row: Row;
  page: ServicePage;
  currency: string;
  onChange: (row: Row) => void;
  onRemove: () => void;
}) {
  const text = useTranslations("investments.plans.backfill");
  const own = `${id}-${row.dueOn}`;
  const date = formatDate(row.dueOn, "long", page.say.locale);
  return (
    <fieldset
      data-testid="backfill-row"
      className={`${FORM_GRID} col-span-full rounded-md border border-border p-3`}
    >
      <legend className="px-1 text-sm font-medium">{text("row", { date })}</legend>
      {row.unpriced && <p className="col-span-full text-sm text-warn">{text("noPrice")}</p>}
      <DateField
        id={`${own}-on`}
        label={text("on")}
        value={row.on}
        max={page.say.todayOn}
        onChange={(day) => onChange({ ...row, on: day })}
      />
      <NumberField
        id={`${own}-quantity`}
        label={text("quantity")}
        value={row.quantity}
        onChange={(quantity) => onChange({ ...row, quantity })}
      />
      {MONEY.map((key) => (
        <MoneyField
          key={key}
          id={`${own}-${key}`}
          label={text(key)}
          value={row[key]}
          onChange={(typed) => onChange({ ...row, [key]: typed })}
          currency={currency}
        />
      ))}
      <div className="col-span-full">
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {text("remove", { date })}
        </Button>
      </div>
    </fieldset>
  );
}

function useBackfill(page: ServicePage, plan: Plan, past: PastRuns, onClose: () => void) {
  const text = useTranslations("investments.plans");
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const [rows, setRows] = useState(() => rowsOf(past, page));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      if (!report(await backfillPlan(page.id, plan.id, rows))) return;
      notify(text("backfill.done", { count: rows.length }));
      onClose();
    });
  };
  return {
    pending,
    error,
    onSubmit,
    rows,
    change: (changed: Row) => setRows(rows.map((one) => (one.dueOn === changed.dueOn ? changed : one))),
    remove: (dueOn: string) => setRows(rows.filter((one) => one.dueOn !== dueOn)),
  };
}

function BackfillForm({
  page,
  plan,
  past,
  onClose,
  failed = false,
}: {
  page: ServicePage;
  plan: Plan;
  past: PastRuns;
  onClose: () => void;
  failed?: boolean;
}) {
  const text = useTranslations("investments.plans");
  const errorText = useErrorText();
  const id = useId();
  const form = useBackfill(page, plan, past, onClose);
  return (
    <FormDialog
      onClose={onClose}
      title={text("backfill.title", { name: plan.name })}
      description={text("backfill.description", { max: plans.MAX_BACKFILL_RUNS })}
      width={520}
      className={FORM_GRID}
      onSubmit={form.onSubmit}
      error={form.error ?? (failed ? errorText("failed") : null)}
      pending={form.pending || form.rows.length === 0}
      cancelLabel={text("form.cancel")}
      submitLabel={text("backfill.submit", { count: form.rows.length })}
    >
      {form.rows.length === 0 && !failed && (
        <p className="col-span-full text-sm text-muted">{text("backfill.none")}</p>
      )}
      {form.rows.map((row) => (
        <InstalmentRow
          key={row.dueOn}
          id={id}
          row={row}
          page={page}
          currency={past.currency}
          onChange={form.change}
          onRemove={() => form.remove(row.dueOn)}
        />
      ))}
      {past.more && (
        <p data-testid="backfill-more" className="col-span-full text-sm text-muted">
          {text("backfill.more", { max: plans.MAX_BACKFILL_RUNS })}
        </p>
      )}
    </FormDialog>
  );
}

/** The form once its due dates are read; a read that failed says so on the form, with no row. */
export function BackfillDialog({
  page,
  plan,
  onClose,
}: {
  page: ServicePage;
  plan: Plan;
  onClose: () => void;
}) {
  const read = useApi(plans.listPastRuns, { params: { accountId: page.id, planId: plan.id } });
  if (read.data) return <BackfillForm page={page} plan={plan} past={read.data} onClose={onClose} />;
  if (!read.error) return null;
  const none = { planId: plan.id, currency: plan.currency, runs: [], more: false };
  return <BackfillForm page={page} plan={plan} past={none} onClose={onClose} failed />;
}

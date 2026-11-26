"use client";

// One payslip typed by hand (R5g, ST-21), from `GET /payroll/manual-payslips/{id}`: its kind, its
// four base amounts, the other fields it has and its PDF, with Edit and Delete. It never opens a
// review: a review needs a document, and this one may have none.
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { ConfirmDialog } from "@ledgerly/ui/form-dialog";
import { useRouter } from "@ledgerly/ui/router";
import { Stat, StatGrid } from "@ledgerly/ui/stat";
import { notify } from "@ledgerly/ui/toast";
import { deleteManualPayslipAction } from "../manual-calls";
import { KindBadge, useFieldLabel } from "./labels";
import { ManualDialog } from "./manual-dialog";
import { openOriginal, originalLink } from "./original";
import { type Catalogue, type Format, kindBadge, type ManualPayslip, moneyOf, registerHref } from "./present";

function Heading({ payslip, format, onEdit, onDelete }: { payslip: ManualPayslip; format: Format; onEdit: () => void; onDelete: () => void }) {
  const text = useTranslations("payroll.manual");
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="flex flex-wrap items-center gap-2 text-title font-semibold tracking-title">
          {payslip.period ? formatDate(payslip.period, "monthYear", format.locale) : String(payslip.year)}
          <KindBadge badge={kindBadge(payslip)} />
          <Badge tone="neutral">{text("byHand")}</Badge>
        </h1>
        <p className="text-muted">
          {payslip.paidOn ? `${text("paidOn")} ${formatDate(payslip.paidOn, "long", format.locale)}` : text("notPaid")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onEdit}>
          {text("edit")}
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete}>
          {text("delete")}
        </Button>
      </div>
    </div>
  );
}

/** The four base amounts, the other fields it has — the catalogue's order, then any a pack no longer offers — and its PDF. */
function Figures({ payslip, catalogue, format }: { payslip: ManualPayslip; catalogue: Catalogue; format: Format }) {
  const text = useTranslations("payroll.manual");
  const label = useFieldLabel();
  const keys = [
    ...catalogue.map((field) => field.key).filter((key) => key in payslip.fields),
    ...Object.keys(payslip.fields).filter((key) => !catalogue.some((field) => field.key === key)),
  ];
  const document = payslip.document;
  return (
    <>
      <Card>
        <h2 className="sr-only">{text("amounts")}</h2>
        <StatGrid columns={5}>
          <Stat label={text("gross")} value={moneyOf(payslip.gross, format)} />
          <Stat label={text("taxes")} value={moneyOf(payslip.taxes, format)} />
          <Stat label={text("contributions")} value={moneyOf(payslip.contributions, format)} />
          <Stat label={text("net")} value={moneyOf(payslip.net, format)} tone="pos" />
        </StatGrid>
      </Card>
      {keys.length > 0 && (
        <Card padded={false}>
          <CardHeader title={text("fields")} />
          <dl className="grid grid-cols-2 gap-3 px-4 pb-4 @3xl:grid-cols-3" data-testid="manual-fields">
            {keys.map((key) => (
              <Stat key={key} label={label(key)} value={moneyOf(payslip.fields[key], format)} />
            ))}
          </dl>
        </Card>
      )}
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{text("document")}</h2>
        {document?.hasOriginal ? (
          <button
            type="button"
            onClick={() => openOriginal(() => originalLink(document.id))}
            className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent hover:underline"
          >
            {document.fileName}
          </button>
        ) : (
          <span className="text-sm text-muted">{document?.fileName ?? text("noDocument")}</span>
        )}
      </Card>
    </>
  );
}

export function ManualView({
  payslip,
  catalogue,
  format,
}: {
  payslip: ManualPayslip;
  catalogue: Catalogue;
  format: Format;
}) {
  const text = useTranslations("payroll.manual");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const result = await deleteManualPayslipAction(payslip.id);
      if (!result.ok) {
        notify(text(result.error === "not_found" ? "errors.not_found" : "errors.failed"), "error");
        return;
      }
      notify(text("deleted"));
      router.push(registerHref(payslip.year));
    });
  }

  return (
    <>
      <Heading payslip={payslip} format={format} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} />
      <Figures payslip={payslip} catalogue={catalogue} format={format} />
      {editing && (
        <ManualDialog
          payslip={payslip}
          catalogue={catalogue}
          format={format}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title={text("deleteTitle")}
          description={text("deleteBody")}
          cancelLabel={text("cancel")}
          confirmLabel={text("delete")}
          onConfirm={onDelete}
          pending={pending}
        />
      )}
    </>
  );
}

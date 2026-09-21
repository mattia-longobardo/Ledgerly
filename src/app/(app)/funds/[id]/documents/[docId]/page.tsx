import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { POSITION_FIELDS } from "@/modules/funds/parse/cometa-position";
import { previewOperations } from "@/modules/funds/pension/imports";
import { requirePensionFund } from "@/modules/funds/pension/service";
import {
  ApplyDocumentButton,
  DocumentActions,
  type PositionFieldView,
  PositionReview,
} from "@/modules/funds/ui/pension-forms";
import { quarterLabel } from "@/modules/funds/ui/pension-present";
import { FundError } from "@/modules/funds/service";
import { AWAITING_REVIEW, IN_FLIGHT } from "@/modules/imports/rules";
import { getDocument, listEvidence } from "@/modules/imports/service";
import { AutoRefresh } from "@/modules/payroll/ui/auto-refresh";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { parseCents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funds.pension.review"))("title") };
}

const UUID = /^[0-9a-f-]{36}$/;

/**
 * The review of a Cometa document (spec §9.3 step 4, plan F6 §3.6.10): the statement beside its
 * page, or the export's operations with what the fund already knows of each — before "Apply".
 */
export default async function CometaDocumentPage({ params }: PageProps<"/funds/[id]/documents/[docId]">) {
  const ctx = await requireSession();
  const t = await getTranslations("funds.pension");
  const tr = await getTranslations("funds.pension.review");
  const { id, docId } = await params;
  if (!UUID.test(id) || !UUID.test(docId)) notFound();
  try {
    await requirePensionFund(ctx, id);
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
  const document = await getDocument(ctx, docId);
  if (!document || (document.kind !== "cometa_operations" && document.kind !== "cometa_position")) notFound();

  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  const editable = document.state === "needs_review" || document.state === "verified";
  const appliable = AWAITING_REVIEW.includes(document.state);
  const base = `/funds/${id}`;

  const header = (
    <>
      <AutoRefresh active={IN_FLIGHT.includes(document.state)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="flex items-center gap-2 text-title font-semibold tracking-[-0.02em]">
            {t(`documents.kinds.${document.kind}` as "documents.kinds.cometa_operations")}
            <Badge
              tone={document.state === "applied" ? "pos" : document.state === "failed" ? "neg" : "neutral"}
            >
              {t(`documentStates.${document.state}` as "documentStates.applied")}
            </Badge>
          </h1>
          <p className="truncate text-muted">
            {tr("subtitle", {
              file: document.fileName,
              date: formatDate(civilDateIn(document.receivedAt, ctx.timeZone), "long", ctx.locale),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentActions
            fundId={id}
            documentId={document.id}
            canDelete={document.state !== "applied" && document.state !== "superseded"}
            labels={{ retry: tr("retry"), delete: tr("delete"), deleted: tr("deleted") }}
          />
          {appliable && (
            <ApplyDocumentButton
              fundId={id}
              documentId={document.id}
              kind={document.kind}
              label={tr("apply")}
              toast={tr("applied")}
            />
          )}
        </div>
      </div>
      {IN_FLIGHT.includes(document.state) && (
        <p className="rounded-card border border-border bg-card px-3 py-2 text-sm">{tr("states.reading")}</p>
      )}
      {document.state === "failed" && (
        <p className="rounded-card border border-neg/40 bg-neg-bg px-3 py-2 text-sm text-neg">
          {tr("states.failed", { error: t(`errors.${document.error ?? "failed"}` as "errors.failed") })}
        </p>
      )}
      {document.state === "applied" && (
        <p className="rounded-card border border-pos/40 bg-pos-bg px-3 py-2 text-sm text-pos">
          {tr("states.applied")}
        </p>
      )}
    </>
  );

  if (document.kind === "cometa_position") {
    const evidence = await listEvidence(ctx, document.id);
    const byField = new Map(evidence.map((row) => [row.field, row]));
    const fields: PositionFieldView[] = POSITION_FIELDS.flatMap((field) => {
      const row = byField.get(field);
      if (!row) return [];
      const value = row.verification === "corrected" ? row.correctedValue : row.value;
      const unit = field === "valuationDate" ? ("date" as const) : ("eur" as const);
      const shown =
        value === null
          ? NULL_DISPLAY
          : unit === "date"
            ? formatDate(value, "long", ctx.locale)
            : money(parseCents(value));
      return [
        {
          field,
          label: tr(`fields.${field}` as "fields.value"),
          value: shown,
          input:
            value === null
              ? ""
              : unit === "date"
                ? value
                : formatAmountInput(parseCents(value), ctx.numberFormat),
          unit,
          page: row.page,
          bbox: (row.bbox as [number, number, number, number] | null) ?? null,
          verification: row.verification,
          original:
            row.verification === "corrected" && row.value !== null
              ? unit === "date"
                ? formatDate(row.value, "long", ctx.locale)
                : money(parseCents(row.value))
              : null,
          sourceLabel: row.sourceLabel,
        },
      ];
    });
    return (
      <Page title={tr("title")} parent={{ href: base as Route, label: tr("back") }}>
        {header}
        <PositionReview
          fundId={id}
          documentId={document.id}
          fileName={document.fileName}
          originalUrl={document.storageKey ? `${base}/documents/${document.id}/original` : null}
          fields={fields}
          editable={editable}
        />
      </Page>
    );
  }

  const preview = document.storageKey ? await previewOperations(ctx, id, document.id) : null;
  const added = preview?.rows.filter((row) => row.state === "new").length ?? 0;
  return (
    <Page title={tr("title")} parent={{ href: base as Route, label: tr("back") }}>
      {header}
      <Card padded={false} data-testid="operations-preview">
        <CardHeader
          title={tr("preview.title")}
          actions={
            preview && (
              <span className="text-sm text-muted">
                {tr("preview.hint", { count: preview.rows.length, added })}
              </span>
            )
          }
        />
        {!preview || preview.rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{tr("preview.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{tr("preview.competence")}</Th>
                <Th>{tr("preview.type")}</Th>
                <Th>{tr("preview.date")}</Th>
                <Th align="right">{tr("preview.worker")}</Th>
                <Th align="right">{tr("preview.employer")}</Th>
                <Th align="right">{tr("preview.tfr")}</Th>
                <Th align="right">{tr("preview.fees")}</Th>
                <Th align="right">{tr("preview.net")}</Th>
                <Th align="right">{tr("preview.units")}</Th>
                <Th>{t("documents.state")}</Th>
              </THead>
              <TBody>
                {preview.rows.map(({ operation, state }) => (
                  <Tr key={operation.originKey} data-testid="preview-row">
                    <Td>
                      {operation.competenceYear && operation.competenceQuarter
                        ? quarterLabel(operation.competenceYear, operation.competenceQuarter)
                        : NULL_DISPLAY}
                    </Td>
                    <Td muted className="text-sm">
                      <span className="flex flex-col">
                        <span>{operation.originalType}</span>
                        <span>{t(`classes.${operation.classification}`)}</span>
                      </span>
                    </Td>
                    <Td muted>{formatDate(operation.operationDate, "long", ctx.locale)}</Td>
                    <Td align="right">{money(operation.workerCents)}</Td>
                    <Td align="right">{money(operation.employerCents)}</Td>
                    <Td align="right">{money(operation.tfrCents)}</Td>
                    <Td align="right" className="text-neg">
                      {operation.feesCents === 0n ? NULL_DISPLAY : money(-operation.feesCents)}
                    </Td>
                    <Td align="right" className="font-semibold">
                      {money(operation.netCents)}
                    </Td>
                    <Td align="right" muted>
                      {operation.movements.map((movement) => movement.units).join(" + ") || NULL_DISPLAY}
                    </Td>
                    <Td>
                      <Badge tone={state === "new" ? "accent" : state === "changed" ? "warn" : "neutral"}>
                        {tr(`preview.state.${state}`)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="px-4 pb-4 text-sm text-muted">{tr("preview.enrollmentNote")}</p>
      </Card>
    </Page>
  );
}

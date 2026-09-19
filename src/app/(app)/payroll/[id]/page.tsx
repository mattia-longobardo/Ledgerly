import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IN_FLIGHT } from "@/modules/imports/rules";
import { reviewView } from "@/modules/payroll/queries";
import { AutoRefresh } from "@/modules/payroll/ui/auto-refresh";
import { fieldGroups, STATE_TONE } from "@/modules/payroll/ui/present";
import { ReviewActions } from "@/modules/payroll/ui/review-actions";
import { ReviewWorkspace } from "@/modules/payroll/ui/review-workspace";
import { requireSession } from "@/platform/auth/session";
import { llmFallbackAvailable } from "@/platform/settings/service";
import { isFieldName, llmFillable } from "@/modules/payroll/fields";
import { addMonths, civilDateIn } from "@/platform/dates";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { parseCents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("review.title") };
}

const CHECK_TONE = { passed: "pos", failed: "neg", skipped: "neutral" } as const;
const BANNER: Partial<Record<string, "reading" | "needsOcr" | "failed" | "rejected" | "applied" | "superseded" | "verified">> = {
  received: "reading",
  scanning: "reading",
  extracting: "reading",
  needs_ocr: "needsOcr",
  failed: "failed",
  rejected: "rejected",
  applied: "applied",
  superseded: "superseded",
  verified: "verified",
};

/** Review payslip (spec §7.8, design "Review parsed payslip"). */
export default async function ReviewPayslipPage({ params }: PageProps<"/payroll/[id]">) {
  const ctx = await requireSession();
  const t = await getTranslations("payroll");
  const { id } = await params;
  const view = /^[0-9a-f-]{36}$/.test(id) ? await reviewView(ctx, id) : null;
  if (!view) notFound();
  const { document } = view;
  const blanks = view.evidence.some(
    (row) => isFieldName(row.field) && llmFillable(row.field) && row.value === null && row.origin === "printed",
  );
  const llm = blanks && document.state === "needs_review" && (await llmFallbackAvailable());
  const money = (decimal: string | undefined) =>
    decimal && /^-?\d+(\.\d{1,2})?$/.test(decimal) ? formatMoney(parseCents(decimal), ctx.numberFormat) : NULL_DISPLAY;
  const hours = (decimal: string) => formatAmountInput(parseCents(decimal), ctx.numberFormat);
  const banner = BANNER[document.state];
  const editable = document.state === "needs_review" || document.state === "verified";
  const groups = fieldGroups(view.evidence, ctx);
  const period = view.identity?.period ?? null;
  const events =
    view.payslip?.active === true
      ? view.appliedEvents
      : period
        ? view.assembled.events.map((event) => ({ ...event, usagePeriod: addMonths(period, -1) }))
        : [];

  return (
    <Page title={t("review.title")} parent={{ href: "/payroll", label: t("review.back") }}>
      <AutoRefresh active={IN_FLIGHT.includes(document.state)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="flex items-center gap-2 text-title font-semibold tracking-[-0.02em]">
            {view.assembled.values.periodLabel ?? t("review.title")}
            <Badge tone={STATE_TONE[document.state]}>{t(`states.${document.state}`)}</Badge>
          </h1>
          <p className="truncate text-muted">
            {t("review.subtitle", {
              file: document.fileName,
              date: formatDate(civilDateIn(document.receivedAt, ctx.timeZone), "long", ctx.locale),
            })}
          </p>
        </div>
        <ReviewActions documentId={document.id} state={document.state} blocking={view.blocking} llm={llm} />
      </div>

      {banner && (
        <p
          data-testid="review-banner"
          className={cn(
            "rounded-card border px-3 py-2 text-sm",
            banner === "failed" || banner === "needsOcr"
              ? "border-neg/30 bg-neg-bg text-neg"
              : banner === "applied" || banner === "verified"
                ? "border-pos/30 bg-pos-bg text-pos"
                : "border-border bg-card text-muted",
          )}
        >
          {t(`review.${banner}`, { error: document.error ?? "" })}
        </p>
      )}

      {view.evidence.length > 0 && (
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Card className="flex flex-col gap-2">
            <h2 className="font-semibold">{t("review.checks.title")}</h2>
            <ul className="flex flex-col gap-1.5" data-testid="checks">
              {view.assembled.checks.map((check) => (
                <li key={check.id} data-check={check.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{t(`review.checks.names.${check.id}`)}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {check.status === "failed" && check.expected !== undefined && (
                      <span>
                        {t("review.checks.expectedActual", {
                          expected: check.id.startsWith("leave") ? hours(check.expected) : money(check.expected),
                          actual: check.id.startsWith("leave") ? hours(check.actual ?? "0") : money(check.actual),
                        })}
                      </span>
                    )}
                    {check.status === "skipped" && check.reason && <span>{t(`review.checks.reasons.${check.reason}` as never)}</span>}
                    <Badge tone={check.status === "failed" && check.severity === "warning" ? "warn" : CHECK_TONE[check.status]}>
                      {t(`review.checks.${check.status}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-2">
            <h2 className="font-semibold">{t("review.warnings.title")}</h2>
            {view.warnings.length === 0 ? (
              <p className="text-sm text-muted">{NULL_DISPLAY}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm" data-testid="warnings">
                {view.warnings.map((warning, index) => (
                  <li key={index} data-warning={warning.code} className="rounded-[6px] bg-warn-bg px-2 py-1 text-warn">
                    {t(`review.warnings.${warning.code}`, {
                      code: warning.detail?.code ?? "",
                      hours: warning.detail?.hours ? hours(warning.detail.hours) : "",
                      monthField: money(warning.detail?.monthField),
                      contributionLine: money(warning.detail?.contributionLine),
                    })}
                    {warning.code === "rectification" && warning.detail?.documentId && (
                      <>
                        {" "}
                        <Link
                          href={`/payroll/${warning.detail.documentId}` as Route}
                          className="font-medium underline"
                        >
                          {t("register.open")}
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {view.evidence.length > 0 && (
        <ReviewWorkspace
          documentId={document.id}
          fileName={document.fileName}
          originalUrl={document.storageKey ? `/payroll/${document.id}/original` : null}
          groups={groups}
          editable={editable}
        />
      )}
      {view.evidence.length === 0 && document.storageKey && !IN_FLIGHT.includes(document.state) && (
        <a href={`/payroll/${document.id}/original`} target="_blank" rel="noopener" className="text-sm text-accent hover:underline">
          {t("review.viewer.open")}
        </a>
      )}

      {period && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">{t("review.leave.title")}</h2>
          <p className="text-sm text-muted">
            {t("review.leave.snapshot", {
              period: formatDate(period, "monthYear", ctx.locale),
              usage: formatDate(addMonths(period, -1), "monthYear", ctx.locale),
            })}
          </p>
          {events.length === 0 ? (
            <p className="text-sm">{t("review.leave.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="leave-events">
              {events.map((event, index) => (
                <li key={index}>
                  {t("review.leave.event", {
                    hours: hours(event.hours),
                    kind: t(`review.leave.kinds.${event.kind}`),
                    month: formatDate(event.usagePeriod, "monthYear", ctx.locale),
                  })}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view.lines.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <h2 className="px-4 pt-3 pb-2 font-semibold">{t("review.lines.title")}</h2>
          <Table>
            <THead>
              <Th>{t("review.lines.code")}</Th>
              <Th>{t("review.lines.description")}</Th>
              <Th align="right">{t("review.lines.quantity")}</Th>
              <Th align="right">{t("review.lines.earnings")}</Th>
              <Th align="right">{t("review.lines.deductions")}</Th>
              <Th align="right">{t("review.lines.statistical")}</Th>
              <Th>{t("review.lines.role")}</Th>
            </THead>
            <TBody>
              {view.lines.map((line) => (
                <Tr key={line.position}>
                  <Td className="tabular-nums">{line.code}</Td>
                  <Td>{line.description}</Td>
                  <Td align="right">{line.quantity ?? ""}</Td>
                  <Td align="right">{line.earningsCents === null ? "" : formatMoney(line.earningsCents, ctx.numberFormat)}</Td>
                  <Td align="right">{line.deductionsCents === null ? "" : formatMoney(line.deductionsCents, ctx.numberFormat)}</Td>
                  <Td align="right" muted>
                    {line.statisticalCents === null ? "" : formatMoney(line.statisticalCents, ctx.numberFormat)}
                  </Td>
                  <Td>
                    <Badge tone={line.role === "other" ? "warn" : "neutral"}>{t(`roles.${line.role}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </Page>
  );
}

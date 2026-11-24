"use client";

// One payslip's review (spec §7.8, design "Review parsed payslip"), read from `/api/v1` (rewrite plan
// R3): the heading with its state and actions, the banner of the state, the checks and the warnings,
// the values beside the PDF, the leave it accounts for and its body lines. Every figure is a field of
// `GET /payroll/payslips/{id}`; the screen formats it. While the document is read, the review reads
// its route again (audit UI-PAY-1).
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { payroll } from "@ledgerly/api-contract/payroll";
import { addMonths, civilDateIn } from "@ledgerly/format/dates";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { usePolling } from "@ledgerly/ui/data";
import { Link } from "@ledgerly/ui/router";
import { StatusBadge } from "@ledgerly/ui/status-badge";
import { KindBadge } from "./labels";
import {
  type DocumentState,
  fieldGroups,
  type Format,
  hoursOf,
  kindBadge,
  moneyOf,
  type Review,
  STATE_TONE,
} from "./present";
import { openOriginal, originalLink } from "./original";
import { ReviewActions } from "./review-actions";
import { ReviewLines } from "./review-lines";
import { ReviewWorkspace } from "./review-workspace";

type Banner = "reading" | "needsOcr" | "failed" | "rejected" | "applied" | "superseded" | "verified";

const CHECK_TONE = { passed: "pos", failed: "neg", skipped: "neutral" } as const;
const BANNER: Partial<Record<DocumentState, Banner>> = {
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
const FOLLOWED = [payroll.getPayslip, payroll.getPayroll];

interface Props {
  view: Review;
  format: Format;
}

function ReviewHeading({ view, format }: Props) {
  const text = useTranslations("payroll");
  const { document } = view;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="flex items-center gap-2 text-title font-semibold tracking-title">
          {view.periodLabel ?? text("review.title")}
          <StatusBadge status={document.state} tones={STATE_TONE}>
            {text(`states.${document.state}`)}
          </StatusBadge>
          {view.payslip && <KindBadge badge={kindBadge(view.payslip)} />}
          {view.payslip?.source === "manual" && <Badge tone="neutral">{text("register.byHand")}</Badge>}
        </h1>
        <p className="truncate text-muted">
          {text("review.subtitle", {
            file: document.fileName,
            date: formatDate(civilDateIn(new Date(document.receivedAt), format.timeZone), "long", format.locale),
          })}
        </p>
      </div>
      <ReviewActions
        documentId={document.id}
        fileName={document.fileName}
        state={document.state}
        blocking={view.blocking}
        llm={view.llmFill}
      />
    </div>
  );
}

function StateBanner({ banner, error }: { banner: Banner; error: string | null }) {
  const text = useTranslations("payroll");
  return (
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
      {text(`review.${banner}`, { error: error ?? "" })}
    </p>
  );
}

/** Why a check was skipped, in words; a reason with no words of its own says nothing, as before. */
const SKIP_REASONS = ["extra_month", "year_end_adjustment", "missing", "single_source", "blank", "no_history"] as const;

function SkipReason({ reason }: { reason: string | null }) {
  const text = useTranslations("payroll.review.checks.reasons");
  const known = SKIP_REASONS.find((one) => one === reason);
  return known ? <span>{text(known)}</span> : null;
}

/** A figure of a check: hours for the leave checks, money for the others. */
function checkFigure(id: string, value: string | null, format: Format): string {
  return id.startsWith("leave") ? hoursOf(value ?? "0", format) : moneyOf(value, format);
}

function Checks({ view, format }: Props) {
  const text = useTranslations("payroll");
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-semibold">{text("review.checks.title")}</h2>
      <ul className="flex flex-col gap-1.5" data-testid="checks">
        {view.checks.map((check) => (
          <li key={check.id} data-check={check.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{text(`review.checks.names.${check.id}`)}</span>
            <span className="flex items-center gap-2 text-muted">
              {check.status === "failed" && check.expected !== null && (
                <span>
                  {text("review.checks.expectedActual", {
                    expected: checkFigure(check.id, check.expected, format),
                    actual: checkFigure(check.id, check.actual, format),
                  })}
                </span>
              )}
              {check.status === "skipped" && <SkipReason reason={check.reason} />}
              <Badge tone={check.status === "failed" && check.severity === "warning" ? "warn" : CHECK_TONE[check.status]}>
                {text(`review.checks.${check.status}`)}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Warnings({ view, format }: Props) {
  const text = useTranslations("payroll");
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-semibold">{text("review.warnings.title")}</h2>
      {view.warnings.length === 0 ? (
        <p className="text-sm text-muted">{NULL_DISPLAY}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm" data-testid="warnings">
          {view.warnings.map((warning, index) => (
            <li key={index} data-warning={warning.code} className="rounded-[6px] bg-warn-bg px-2 py-1 text-warn">
              {text(`review.warnings.${warning.code}`, {
                code: warning.detail.code ?? "",
                hours: warning.detail.hours ? hoursOf(warning.detail.hours, format) : "",
                monthField: moneyOf(warning.detail.monthField, format),
                contributionLine: moneyOf(warning.detail.contributionLine, format),
              })}
              {warning.code === "rectification" && warning.detail.documentId && (
                <>
                  {" "}
                  <Link href={`/payroll/${warning.detail.documentId}`} className="font-medium underline">
                    {text("register.open")}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The leave the payslip accounts for, in the month it was used: stored once applied, foreseen before. */
function Leave({ view, format }: Props) {
  const text = useTranslations("payroll");
  const period = view.payslip?.period ?? null;
  if (!period) return null;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-semibold">{text("review.leave.title")}</h2>
      <p className="text-sm text-muted">
        {text("review.leave.snapshot", {
          period: formatDate(period, "monthYear", format.locale),
          usage: formatDate(addMonths(period, -1), "monthYear", format.locale),
        })}
      </p>
      {view.leaveEvents.length === 0 ? (
        <p className="text-sm">{text("review.leave.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" data-testid="leave-events">
          {view.leaveEvents.map((event, index) => (
            <li key={index}>
              {text("review.leave.event", {
                hours: hoursOf(event.hours, format),
                kind: text(`review.leave.kinds.${event.kind}`),
                month: formatDate(event.usagePeriod, "monthYear", format.locale),
              })}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The values beside the PDF; with no value read, only the way to the original. */
function Values({ view, format }: Props) {
  const text = useTranslations("payroll");
  const { document } = view;
  // One function per payslip: the viewer loads again only when it changes, not at each poll.
  const original = useMemo(
    () => (document.hasOriginal ? () => originalLink(document.id) : null),
    [document.id, document.hasOriginal],
  );
  if (view.fields.length > 0)
    return (
      <ReviewWorkspace
        documentId={document.id}
        fileName={document.fileName}
        original={original}
        groups={fieldGroups(view.fields, format)}
        editable={document.state === "needs_review" || document.state === "verified"}
      />
    );
  if (!original) return null;
  return (
    <button
      type="button"
      onClick={() => openOriginal(original)}
      className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent hover:underline"
    >
      {text("review.viewer.open")}
    </button>
  );
}

export function ReviewBody({ view, format }: Props) {
  const banner = BANNER[view.document.state];
  const reading = banner === "reading";
  usePolling(reading, FOLLOWED);
  return (
    <>
      <ReviewHeading view={view} format={format} />
      {banner && <StateBanner banner={banner} error={view.document.error} />}
      {view.fields.length > 0 && (
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Checks view={view} format={format} />
          <Warnings view={view} format={format} />
        </div>
      )}
      {!(reading && view.fields.length === 0) && <Values view={view} format={format} />}
      <Leave view={view} format={format} />
      <ReviewLines view={view} format={format} />
    </>
  );
}
